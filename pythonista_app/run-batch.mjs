#!/usr/bin/env node
/*
 * run-batch.mjs — 「完整独立 B」主控（Node 版，无需 Playwright）
 * ---------------------------------------------------------------------------
 * 端到端：读清单 → 抓价 → 提取 → 合并写回 Gitee
 *
 * 与 BLP.py 的差别：
 *   - 不依赖 Playwright / 浏览器；用 node 内置 fetch 直抓价格页。
 *   - 解析复用 /blp-shortcuts/extract-price-on-safari.js 的提取逻辑（已验证）。
 *   - 因 BL 对纯 fetch 可能返回 HTTP 202(WAF)，本脚本提供「人工兜底」：
 *     遇到 202 时可暂停，你手动在浏览器打开该 URL 通过挑战后回车继续
 *     （同一用户目录/登录态，详见 README）。也可设 SKIP_BLOCKED=1 跳过记失败。
 *
 * 用法：
 *   node run-batch.mjs                 # 读 Gitee 的 BL-price.json 算增量并抓
 *   node run-batch.mjs --max 20        # 本轮最多 20 条
 *   node run-batch.mjs --dry-run       # 只列待抓
 *   node run-batch.mjs --no-push       # 抓完不推，存本地
 * ---------------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 配置 ----
const REPO = 'legoping/parts-rb';
const BRANCH = 'main';
const RAW = `https://gitee.com/${REPO}/raw/${BRANCH}`;
const API = `https://gitee.com/api/v5/repos/${REPO}/contents`;
const G_TOKEN = process.env.GITEE_TOKEN || '5e8fe75044a023e2c992c1b5d11c95f0';
const PRICE_JSON = 'BL-price.json';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://tfxydlkpxkdpxyoqkzez.supabase.co');
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmeHlkbGtweGtkcHh5b3Fya2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTA2NzQsImV4cCI6MjEwMDc4NjY3NH0.kNMlT3YXyXVV5Y_JHmDd-0vj1o_xFUFpV_uuWTVh-JI';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const DELAY = 1000; // ms，抓取间隔

// ---- 复用提取函数（从 extract-price-on-safari.js 抽取，与浏览器一致）----
function loadExtractor() {
  const src = fs.readFileSync(path.join(__dirname, 'extract-price-on-safari.js'), 'utf8');
  const fnSrc = src.slice(src.indexOf('function extractPriceGuide'), src.indexOf('var runExtract'));
  // 转成可执行 —— 用 Function 构造函数调用
  const factory = new Function(fnSrc + '; return extractPriceGuide;');
  return factory();
}

async function giteeRaw(p) {
  const r = await fetch(`${RAW}/${p}`, { headers: { 'User-Agent': 'node-blp' } });
  if (!r.ok) throw new Error(`拉取 ${p} 失败 HTTP ${r.status}`);
  return r.text();
}

// ---- 颜色映射（RB 颜色 id→名→BL 颜色 id，与 BLP.py rb2bl 一致）----
const COLORS_CSV = 'colors.csv';
const BL_COLORS_JSON = 'bl_colors.json';

function normFn(s) { return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function loadRbColorNames() {
  const text = await giteeRaw(COLORS_CSV);
  const lines = text.split('\n');
  const header = lines[0].split(',');
  const idCol = header.findIndex(h => h.trim() === 'id');
  const nameCol = header.findIndex(h => h.trim() === 'name');
  const m = {};
  if (idCol < 0 || nameCol < 0) return m;
  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split(',');
    if (cells.length <= Math.max(idCol, nameCol)) continue;
    m[cells[idCol].trim()] = cells[nameCol].trim();
  }
  return m;
}

async function loadBlColors() {
  const t = await giteeRaw(BL_COLORS_JSON);
  const data = JSON.parse(t);
  const m = {};
  for (const rec of (Array.isArray(data) ? data : [])) {
    if (rec?.name != null) m[normFn(rec.name)] = rec.id;
  }
  return m;
}

// 从原系统库 (pn, rbcolor) 集合 + 颜色映射 → 产出 BL 待抓 key 列表
function buildTodo(invKeys, rb2bl, existing) {
  const todo = [];
  const seen = new Set();
  for (const [rbPart, rbColor] of invKeys) {
    const blPart = rbPart.replace(/[^a-zA-Z0-9]/g, '');
    if (!blPart) continue;
    const blCid = rb2bl[rbColor];
    if (blCid == null) continue;
    const k = `${blPart}:${blCid}`;
    if (existing.has(k) || seen.has(k)) continue;
    seen.add(k);
    todo.push(k);
  }
  return todo;
}

async function supabaseParts() {
  const url = `${SUPABASE_URL}/rest/v1/parts?select=part_num,color_id`;
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error(`Supabase 查询失败 HTTP ${r.status}`);
  const rows = await r.json();
  const pairs = new Set(); // 存 "pn\u0000rbcolor"
  for (const row of rows) {
    const pn = String(row.part_num ?? '').trim();
    const cid = String(row.color_id ?? '').trim();
    if (pn && cid) pairs.add(`${pn}\u0000${cid}`);
  }
  return pairs;
}

async function loadExisting() {
  try {
    const t = await giteeRaw(PRICE_JSON);
    const d = JSON.parse(t);
    const recs = Array.isArray(d) ? d : (d.records || []);
    const set = new Set(recs.map(r => r.key).filter(Boolean));
    return { recs, set };
  } catch (e) {
    if (e.message.includes('HTTP 404')) return { recs: [], set: new Set() };
    throw e;
  }
}

// 提取后的单条记录，字段与 BLP.py build_record 一致
function buildRecord(part, blCid, data, ts) {
  const l6 = (data?.last_6_months) || {};
  const cs = (data?.current_for_sale) || {};
  const currency = l6.currency || cs.currency || '';
  return {
    key: `${part.replace(/[^a-zA-Z0-9]/g, '')}:${blCid}`,
    part_num: part.replace(/[^a-zA-Z0-9]/g, ''),
    color_id: String(blCid),
    currency,
    last_6_months: data?.last_6_months ?? null,
    current_for_sale: data?.current_for_sale ?? null,
    source: 'blp-shortcuts',
    saved_at: ts,
  };
}

async function fetchPage(part, cid) {
  const clean = part.replace(/[^a-zA-Z0-9]/g, '');
  const url = `https://www.bricklink.com/catalogPG.asp?P=${clean}&colorID=${cid}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  const text = await r.text();
  return { status: r.status, url, text };
}

// 人工兜底：202 时提示，用户浏览器过挑战后回车
function ask(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

async function giteePush(path, contentB64) {
  // 获取当前 sha
  let sha = null;
  try {
    const r = await fetch(`${API}/${path}?access_token=${G_TOKEN}`);
    if (r.ok) sha = (await r.json()).sha;
  } catch (e) { /* 新建则无 sha */ }
  const body = {
    access_token: G_TOKEN,
    content: contentB64,
    message: 'feat(blp-shortcuts): 增量更新 Bricklink 价格库 [skip ci]',
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const method = sha ? 'PUT' : 'POST';
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.status;
}

const args = (() => {
  const a = { max: 0, dryRun: false, noPush: false };
  process.argv.slice(2).forEach(v => {
    const [k, val] = v.split('=');
    if (k === '--max') a.max = parseInt(val || '0', 10);
    else if (k === '--max-fetch') a.max = parseInt(val || '0', 10);
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--no-push') a.noPush = true;
  });
  return a;
})();

const extract = loadExtractor();
const ts = new Date().toISOString();

// 1. 读清单
console.log('=== 完整独立 B 主控 ===');
let sysPairs;
try { sysPairs = await supabaseParts(); }
catch (e) { console.error('Supabase 读取失败:', e.message); process.exit(1); }
console.log(`系统库去重组合: ${sysPairs.size}`);

const { recs, set: existing } = await loadExisting();
console.log(`现有价格: ${existing.size}`);

// 颜色映射 RB→BL
const rbCname = await loadRbColorNames();
const blMap = await loadBlColors();
const rb2bl = {};
for (const [rbId, rbName] of Object.entries(rbCname)) {
  const blId = blMap[normFn(rbName)];
  if (blId != null) rb2bl[rbId] = blId;
}

// 2. 增量清单
const todo = buildTodo(sysPairs, rb2bl, existing);
console.log(`增量待抓: ${todo.length}`);
if (args.dryRun) {
  todo.slice(0, 30).forEach(k => console.log('  [dry]', k));
  process.exit(0);
}

if (args.max && todo.length > args.max) {
  todo.length = args.max;
  console.log(`本轮前 ${todo.length} 条`);
}

// 3. 逐条抓取
const newRecs = [];
for (let i = 0; i < todo.length; i++) {
  const key = todo[i];
  const [part, cid] = key.split(':');
  const { status, url, text } = await fetchPage(part, cid);
  if (status === 202) {
    console.log(`[${i + 1}/${todo.length}] ${key} HTTP 202(WAF) — 需人工兜底`);
    if (process.env.SKIP_BLOCKED === '1') continue;
    console.log(`  请用浏览器打开: ${url}`);
    console.log('  通过挑战(显示价格)后按回车继续，或输入 skip 跳过:');
    const ans = await ask('  > ');
    if (ans.toLowerCase() === 'skip') continue;
    const data = extract(text);
    if (data) { newRecs.push(buildRecord(part, cid, data, ts)); console.log(`  提取: avg=${data.last_6_months?.avg}`); }
    else console.log(`  该页未能解析(可能挑战未过)，跳过一次`);
    continue;
  }
  if (status !== 200) { console.log(`[${i + 1}/${todo.length}] ${key} HTTP ${status} 跳过`); continue; }
  const data = extract(text);
  if (data && (data.last_6_months || data.current_for_sale)) {
    newRecs.push(buildRecord(part, cid, data, ts));
    console.log(`[${i + 1}/${todo.length}] ${key} avg=${data.last_6_months?.avg}`);
  } else {
    console.log(`[${i + 1}/${todo.length}] ${key} 未解析出价格，跳过`);
  }
  await new Promise(res => setTimeout(res, DELAY));
}

// 4. 合并写回
const all = recs.concat(newRecs);
const payload = {
  generated_at: ts, updated_at: ts, count: all.length, source: 'blp-shortcuts', records: all,
};
const localPath = path.join(__dirname, PRICE_JSON);
fs.writeFileSync(localPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`合并完成：新增 ${newRecs.length}，共 ${all.length} 条 → ${localPath}`);

if (args.noPush) { console.log('--no-push 未推送'); process.exit(0); }
const B64 = Buffer.from(JSON.stringify(payload)).toString('base64');
const st = await giteePush(PRICE_JSON, B64);
console.log(st === 200 || st === 201 ? `已推送 ${PRICE_JSON}（HTTP ${st}）` : `推送失败: ${st}`);