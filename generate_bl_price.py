#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
离线生成 Bricklink 价格库 BL-price.json（解决 Bricklink AWS WAF 反爬）。

背景：
    Bricklink 价格指南页（catalogPG.asp）在远端/数据中心 IP 直连时返回 HTTP 202 + JS
    挑战页。纯前端/公共 CORS 代理无法绕过，因此这里用无头浏览器（Playwright + Chromium）
    在设备端真实执行 WAF 挑战并抓取价格，生成离线价格库，推送到 Gitee parts-rb，
    前端启动时读取到本地 IndexedDB（rb_prices），右滑图片即可秒出价格（无需联网抓）。

流程：
    1. 读本地 inventory_parts.csv 统计去重后的 (part_num, color_id) 及其累计数量。
    2. colors.csv(RB 颜色 id→name) + bl_colors.json(BL 颜色名→id) 把 RB 颜色解析成 BL 颜色ID。
    3. 用一个浏览器上下文顺序导航（复用已解出的 aws-waf-token），抓取并按锚点解析两组价格。
    4. 增量写入 BL-price.json（含 generated_at 生成日期），支持断点续跑（--resume）。

用法：
    python3 generate_bl_price.py --top 1000          # 按累计数量取前 N 去重零件生成
    python3 generate_bl_price.py --max 50            # 只生成 N 条（测试用）
    python3 generate_bl_price.py --resume            # 跳过已存在于 BL-price.json 的 key

输出：BL-price.json
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime

from app.bricklink_price import _proxy_from_env, extract_price_guide

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

OUTPUT_JSON = os.path.join(BASE_DIR, "BL-price.json")
INVENTORY_CSV = os.path.join(BASE_DIR, ".alias_analysis", "inventory_parts.csv")
COLORS_CSV = os.path.join(BASE_DIR, "raw_colors.csv")       # RB 颜色表（id,name,...）
BL_COLORS_JSON = os.path.join(BASE_DIR, "raw_bl_colors.json")  # BL 颜色表（id,name,...）


def norm(s):
    return re.sub(r'[^a-z0-9]', '', str(s or '').strip().lower())


_GITEE_API = "https://gitee.com/api/v5/repos/legoping/parts-rb/contents"


def _gitee_download(path, dest):
    """若本地缺文件则从 Gitee parts-rb 下载（Base64 解码）。"""
    if os.path.exists(dest):
        return
    import base64
    import urllib.request
    url = f"{_GITEE_API}/{path}?ref=main"
    with urllib.request.urlopen(url, timeout=60) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    os.makedirs(os.path.dirname(dest) or '.', exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(base64.b64decode(data['content']))
    logger.info('已从 Gitee 下载 %s -> %s', path, dest)


def load_bl_color_id_map():
    _gitee_download('bl_colors.json', BL_COLORS_JSON)
    data = json.load(open(BL_COLORS_JSON, encoding='utf-8'))
    m = {}
    for rec in data:
        name = rec.get('name')
        if name is None:
            continue
        m[norm(name)] = rec.get('id')
    return m


def load_rb_color_name_map():
    # colors.csv: 第一行可能是表头。id,name,...
    _gitee_download('colors.csv', COLORS_CSV)
    m = {}
    with open(COLORS_CSV, encoding='utf-8') as f:
        header = f.readline().strip().split(',')
        id_col = header.index('id')
        name_col = header.index('name')
        for line in f:
            parts = line.rstrip('\n').split(',')
            if len(parts) <= max(id_col, name_col):
                continue
            cid = parts[id_col]
            name = parts[name_col]
            m[str(cid)] = name
    return m


def load_inventory_targets(bl_cid_map, rb_cname_map):
    """统计去重 (part_num, color_id) 及累计数量，解析出 BL 目标。"""
    tallies = {}
    with open(INVENTORY_CSV, encoding='utf-8') as f:
        header = f.readline().strip().split(',')
        idx = {name: i for i, name in enumerate(header)}
        p_col = idx['part_num']
        c_col = idx['color_id']
        q_col = idx.get('quantity', p_col)
        for line in f:
            cells = line.rstrip('\n').split(',')
            if len(cells) <= max(p_col, c_col, q_col):
                continue
            p = cells[p_col]
            c = cells[c_col]
            try:
                q = int(cells[q_col] or 0)
            except ValueError:
                q = 1
            tallies[(p, c)] = tallies.get((p, c), 0) + q

    targets = []
    for (rb_part, rb_color), qty in tallies.items():
        bl_cid = None
        rb_name = rb_cname_map.get(str(rb_color))
        if rb_name is not None:
            bl_cid = bl_cid_map.get(norm(rb_name))
        if bl_cid is None:
            continue  # 无法确定 BL 颜色ID，跳过
        bl_part = re.sub(r'[^a-zA-Z0-9]', '', str(rb_part))
        if not bl_part:
            continue
        key = f"{bl_part}:{bl_cid}"
        targets.append({
            'key': key,
            'part_num': bl_part,
            'color_id': bl_cid,
            'qty': qty,
        })
    return targets


def build_record(target, data, generated_at):
    l6 = data.get('last_6_months')
    cs = data.get('current_for_sale')
    cur = ''
    if l6:
        cur = l6.get('currency') or ''
    if not cur and cs:
        cur = cs.get('currency') or ''
    return {
        'key': target['key'],
        'part_num': target['part_num'],
        'color_id': target['color_id'],
        'currency': cur,
        'last_6_months': l6,
        'current_for_sale': cs,
        'source': 'offline',
        'saved_at': generated_at,
    }


def main():
    parser = argparse.ArgumentParser(description='生成 Bricklink 离线价格库 BL-price.json')
    parser.add_argument('--top', type=int, default=0, help='按累计数量取前 N 去重零件')
    parser.add_argument('--max', type=int, default=0, help='最多生成 N 条（测试用）')
    parser.add_argument('--resume', action='store_true', help='跳过 BL-price.json 中已有的 key')
    parser.add_argument('--color', type=str, default='', help='仅生成指定 BL 颜色ID（测试用）')
    args = parser.parse_args()

    if not os.path.exists(INVENTORY_CSV):
        blob = os.path.join(BASE_DIR, 'RB')
        from datetime import datetime as _dt
        sys.exit(f'缺少 {INVENTORY_CSV}，请先准备库存文件')

    # 已存在的记录（用于断点续跑）
    existing = {}
    if args.resume and os.path.exists(OUTPUT_JSON):
        prev = json.load(open(OUTPUT_JSON, encoding='utf-8'))
        for r in prev.get('records', []):
            existing[r['key']] = r

    bl_cid_map = load_bl_color_id_map()
    rb_cname_map = load_rb_color_name_map()
    all_targets = load_inventory_targets(bl_cid_map, rb_cname_map)

    # 排序：数量多者优先（最常用的零件先有离线价）
    all_targets.sort(key=lambda t: -t['qty'])
    if args.top:
        all_targets = all_targets[:args.top]
    if args.color:
        all_targets = [t for t in all_targets if str(t['color_id']) == args.color]
    logger.info('去重目标 %d 个（示例: %s）', len(all_targets),
                ', '.join(t['key'] for t in all_targets[:3]))

    todo = [t for t in all_targets if t['key'] not in existing]
    if args.max:
        todo = todo[:args.max]
    logger.info('待抓取 %d 条（已有 %d）', len(todo), len(existing))

    generated_at = datetime.now().replace(microsecond=0).isoformat()
    records = list(existing.values())
    # 记录颜色覆盖进度
    succeeded, failed = 0, 0

    proxy = _proxy_from_env()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        kw = {}
        if proxy:
            kw['proxy'] = {'server': proxy}
        # 沙箱无 headless-shell 组件时可设 BL_CHROME 指向完整 chromium 二进制，
        # 以 --headless=new 运行，等价于无头模式（向后兼容原 headless=True 路径）。
        full_chrome = os.environ.get('BL_CHROME')
        launch_kw = dict(
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        )
        if full_chrome and os.path.exists(full_chrome):
            launch_kw['executable_path'] = full_chrome
            launch_kw['headless'] = False
            launch_kw['args'].append('--headless=new')
        else:
            launch_kw['headless'] = True
        browser = p.chromium.launch(**launch_kw, **kw)
        try:
            ctx = browser.new_context(
                user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/120.0 Safari/537.36"),
                viewport={'width': 1280, 'height': 900},
                locale='en-US',
            )
            page = ctx.new_page()
            # 预热：先访问一个稳定页完成 AWS WAF 挑战以建立 aws-waf-token，
            # 之后同 context 内 cookie/localStorage 复用，后续零件页加载会明显更快。
            try:
                warm = "https://www.bricklink.com/catalogPG.asp?P=3001&colorID=7"
                page.goto(warm, wait_until='domcontentloaded', timeout=45000)
                try:
                    page.wait_for_selector('text=Last 6 Months Sales', timeout=45000)
                except Exception:
                    pass
                try:
                    page.wait_for_timeout(1500)
                except Exception:
                    pass
            except Exception as e:
                logger.warning('预热挑战失败（继续）: %s', str(e)[:80])
            def checkpoint():
                payload = {
                    'generated_at': generated_at,
                    'updated_at': datetime.now().replace(microsecond=0).isoformat(),
                    'count': len(records),
                    'source': 'rebrickable offline',
                    'records': records,
                }
                with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
                    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
            for i, t in enumerate(todo, 1):
                url = (f"https://www.bricklink.com/catalogPG.asp"
                       f"?P={t['part_num']}&colorID={t['color_id']}")
                try:
                    page.goto(url, wait_until='domcontentloaded', timeout=30000)
                    # 轮询等待价格数据真正渲染（单一锚点出现不代表挑战已结算），
                    # 最多尝试 N 次，每次等待后解析，拿到数据即跳出。
                    data = None
                    for _ in range(3):
                        try:
                            page.wait_for_selector('text=Last 6 Months Sales', timeout=30000)
                            page.wait_for_timeout(1200)
                        except Exception:
                            pass
                        data = extract_price_guide(page.content())
                        if data and (data.get('last_6_months') or data.get('current_for_sale')):
                            break
                    if data and (data.get('last_6_months') or data.get('current_for_sale')):
                        records.append(build_record(t, data, generated_at))
                        succeeded += 1
                        logger.info('[%d/%d] %s OK  min=%s avg=%s',
                                    i, len(todo), t['key'],
                                    data['last_6_months'].get('min') if data.get('last_6_months') else '-',
                                    data['last_6_months'].get('avg') if data.get('last_6_months') else '-')
                    else:
                        failed += 1
                        logger.warning('[%d/%d] %s 解析无数据', i, len(todo), t['key'])
                except Exception as e:
                    failed += 1
                    logger.warning('[%d/%d] %s 错误: %s', i, len(todo), t['key'], str(e)[:80])
                if i % 15 == 0:
                    checkpoint()
                    logger.info('——检查点 %d 条已写入 %s ——', len(records), OUTPUT_JSON)
        finally:
            browser.close()

    # 写回 BL-price.json（含生成日期，保留历史记录便于前端提示时效）
    # records 可能含重复 key（resume 的历史 + 本次新增同 key），全部保留，前端按 key 取最新
    payload = {
        'generated_at': generated_at,
        'updated_at': generated_at,
        'count': len(records),
        'source': 'rebrickable offline',
        'records': records,
    }
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    logger.info('完成：成功 %d / 失败 %d / 已有 %d / 共 %d 条，已写入 %s',
                succeeded, failed, len(existing), len(records), OUTPUT_JSON)


if __name__ == '__main__':
    main()