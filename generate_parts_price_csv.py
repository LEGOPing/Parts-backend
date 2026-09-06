#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
根据 BL-parts.csv 与 bl-colors.json 生成 "ITEMID + Color ID + Price" 的 CSV。

输入：
    BL-parts.csv     列含 ITEMID(型号) 与 COLOR(颜色名)
    bl-colors.json   [{"id": ColorID, "name": 颜色名}, ...]
价格来源（按优先级）：
    1. 本地已有缓存 BL-price.json（key = "{ITEMID}:{colorID}"，取 6 个月新件均价）
    2. 缓存缺失时，若环境有无头浏览器（Playwright+Chromium），则实时抓取 Bricklink
       价格指南页（与 generate_bl_price.py 同源逻辑）补全。

输出：
    BL-parts-price.csv，仅三列：ITEMID, Color ID, Price
    支持断点续跑（--resume）与限量测试（--limit）。

用法：
    python3 generate_parts_price_csv.py                  # 全量（可能需要很久）
    python3 generate_parts_price_csv.py --limit 50       # 只处理前 50 个去重组合（测试）
    python3 generate_parts_price_csv.py --resume         # 跳过已写出的行，接着跑
"""

import argparse
import json
import logging
import os
import re
import time
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

PARTS_CSV   = os.path.join(BASE_DIR, "BL-parts.csv")
COLORS_JSON = os.path.join(BASE_DIR, "bl-colors.json")
CACHE_JSON  = os.path.join(BASE_DIR, "BL-price.json")
OUT_CSV     = os.path.join(BASE_DIR, "BL-parts-price.csv")


def norm(s):
    """宽松归一化：仅保留小写字母数字，用于颜色名匹配。"""
    return re.sub(r'[^a-z0-9]', '', str(s or '').strip().lower())


def load_colors_name_to_id(path):
    """bl-colors.json -> {归一化颜色名: ColorID}"""
    data = json.load(open(path, encoding='utf-8'))
    m = {}
    for rec in data:
        name = rec.get('name')
        if name is None:
            continue
        m[norm(name)] = rec.get('id')
    return m


def load_parts_targets(parts_path, name2id):
    """BL-parts.csv -> 去重后的目标列表 [(ITEMID, ColorID, 原颜色名)]，跳过无法匹配颜色的行。"""
    targets = []
    seen = set()
    skipped = 0
    with open(parts_path, encoding='utf-8') as f:
        header = f.readline().strip().split(',')
        idx = {name.strip().upper(): i for i, name in enumerate(header)}
        p_col = idx.get('ITEMID')
        c_col = idx.get('COLOR', idx.get('NAME'))
        if p_col is None or c_col is None:
            raise SystemExit(f'BL-parts.csv 缺少 ITEMID/COLOR 列，实际表头: {header}')
        for line in f:
            cells = line.rstrip('\n').split(',')
            if len(cells) <= max(p_col, c_col):
                continue
            pid = cells[p_col].strip()
            color = cells[c_col].strip()
            if not pid or not color:
                continue
            cid = name2id.get(norm(color))
            if cid is None:
                skipped += 1
                continue
            key = f"{re.sub(r'[^a-zA-Z0-9]', '', pid)}:{cid}"
            if key in seen:
                continue
            seen.add(key)
            targets.append((pid, cid, color, key))
    logger.info('去重目标 %d 个，无法匹配颜色的行 %d 条', len(targets), skipped)
    return targets


def price_from_cache(rec):
    """从缓存记录取价格：优先 6 个月新件均价，其次在售价均价。"""
    l6 = rec.get('last_6_months') or {}
    cs = rec.get('current_for_sale') or {}
    for block in (l6, cs):
        avg = block.get('avg')
        if avg is not None:
            return avg
    return None


def load_cache(cache_path):
    """BL-price.json -> {key: 价格}"""
    if not os.path.exists(cache_path):
        return {}
    data = json.load(open(cache_path, encoding='utf-8'))
    out = {}
    for r in data.get('records', []):
        v = price_from_cache(r)
        out[r.get('key')] = v
    return out


def load_done(out_path):
    """读取已写出的 (ITEMID, ColorID)，用于断点续跑。"""
    done = set()
    if not os.path.exists(out_path):
        return done
    with open(out_path, encoding='utf-8') as f:
        header = f.readline()
        for line in f:
            cells = line.rstrip('\n').split(',')
            if len(cells) >= 2:
                done.add(f"{cells[0].strip()}:{cells[1].strip()}")
    return done


def write_headers(out_path):
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('ITEMID,Color ID,Price\n')


def append_rows(out_path, rows):
    with open(out_path, 'a', encoding='utf-8', newline='') as f:
        for pid, cid, price in rows:
            pc = '' if price is None else str(price)
            f.write(f"{pid},{cid},{pc}\n")


def scrape_prices(targets, write):
    """用无头浏览器顺序抓取缺失价格（复用 Bricklink 价格指南页逻辑）。"""
    from app.bricklink_price import _proxy_from_env, extract_price_guide
    from playwright.sync_api import sync_playwright

    proxy = _proxy_from_env()
    with sync_playwright() as p:
        kw = {'proxy': {'server': proxy}} if proxy else {}
        full_chrome = os.environ.get('BL_CHROME')
        launch_kw = dict(args=['--no-sandbox', '--disable-setuid-sandbox',
                               '--disable-blink-features=AutomationControlled'])
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
                viewport={'width': 1280, 'height': 900}, locale='en-US')
            page = ctx.new_page()
            # 预热以完成 AWS WAF 挑战，复用 context 内 token
            try:
                page.goto("https://www.bricklink.com/catalogPG.asp?P=3001&colorID=7",
                          wait_until='domcontentloaded', timeout=45000)
                page.wait_for_timeout(1500)
            except Exception as e:
                logger.warning('预热失败（继续）: %s', str(e)[:80])
            ok, fail = 0, 0
            for i, t in enumerate(targets, 1):
                pid, cid, color, key = t
                url = f"https://www.bricklink.com/catalogPG.asp?P={re.sub(r'[^a-zA-Z0-9]','',pid)}&colorID={cid}"
                price = None
                try:
                    page.goto(url, wait_until='domcontentloaded', timeout=30000)
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
                    if data:
                        l6 = data.get('last_6_months') or {}
                        cs = data.get('current_for_sale') or {}
                        for blk in (l6, cs):
                            if blk.get('avg') is not None:
                                price = blk['avg']
                                break
                except Exception as e:
                    logger.warning('[%d/%d] %s 错误: %s', i, len(targets), key, str(e)[:80])
                if price is not None:
                    write([(pid, cid, price)])
                    ok += 1
                else:
                    fail += 1
                    logger.warning('[%d/%d] %s 无价格（写入空值）', i, len(targets), key)
                    write([(pid, cid, None)])
                if i % 15 == 0:
                    logger.info('——检查点：已处理 %d/%d，成功 %d ——', i, len(targets), ok)
            logger.info('抓取完成：成功 %d / 失败 %d', ok, fail)
        finally:
            browser.close()
            time.sleep(0.2)


def main():
    parser = argparse.ArgumentParser(description='由 BL 零件表 + 颜色表生成 零件/颜色/价格 CSV')
    parser.add_argument('--parts', default=PARTS_CSV)
    parser.add_argument('--colors', default=COLORS_JSON)
    parser.add_argument('--cache', default=CACHE_JSON)
    parser.add_argument('--out', default=OUT_CSV)
    parser.add_argument('--limit', type=int, default=0, help='只处理前 N 个去重组合')
    parser.add_argument('--resume', action='store_true', help='跳过已写出的组合')
    parser.add_argument('--no-scrape', action='store_true', help='仅用本地缓存，不联网抓')
    args = parser.parse_args()

    if not os.path.exists(args.parts):
        raise SystemExit(f'缺少输入文件: {args.parts}')
    if not os.path.exists(args.colors):
        # 兼容本地原始抓图文件命名
        alt = os.path.join(BASE_DIR, 'raw_bl_colors.json')
        if os.path.exists(alt):
            args.colors = alt
        else:
            raise SystemExit(f'缺少输入文件: {args.colors}')

    name2id = load_colors_name_to_id(args.colors)
    targets = load_parts_targets(args.parts, name2id)
    if args.limit and args.limit > 0:
        targets = targets[:args.limit]

    cache = load_cache(args.cache)
    new_file = not os.path.exists(args.out)
    done = set() if (args.resume and not new_file) else set()

    if new_file:
        write_headers(args.out)

    # 第一遍：直接用缓存价格的组合，立即写出
    locally = 0
    pending = []
    for t in targets:
        pid, cid, color, key = t
        done_key = f"{pid}:{cid}"
        if done_key in done:
            continue
        v = cache.get(key)
        if v is not None:
            append_rows(args.out, [(pid, cid, v)])
            done_key and done.add(done_key)
            locally += 1
        else:
            pending.append(t)
    logger.info('本地缓存命中 %d 条；待抓取 %d 条', locally, len(pending))

    need_scrape = pending and not args.no_scrape
    if need_scrape:
        no_browser = False
        try:
            import playwright  # noqa
        except Exception:
            no_browser = True
        if no_browser:
            logger.warning('未安装 playwright/浏览器，待抓取部分写成空价格。'
                           '请在有浏览器的机器上运行本脚本（无 --no-scrape）以补全')
        else:
            scrape_prices(pending, lambda rows: append_rows(args.out, rows))
            need_scrape = False

    if not need_scrape and pending:
        # 无浏览器或 --no-scrape：把未缓存组合写成空价格（占位）
        append_rows(args.out, [(p, c, None) for p, c, _, _ in pending])
        logger.info('已将 %d 条无价组合以空值占位写入', len(pending))

    logger.info('完成，输出: %s', os.path.abspath(args.out))


if __name__ == '__main__':
    main()