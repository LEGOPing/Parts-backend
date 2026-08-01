#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按 RB/parts.csv 的 part_num 批量抓取 Bricklink 零件重量，生成独立文件供系统使用。

特点：
- 断点续传：每抓一个立即写入 weights.json，重跑自动跳过已抓取的 part_num
- 反爬规避：随机间隔 2-4 秒、真实 Safari headers、单零件失败重试 3 次
- 失败记录：抓取失败/未找到的 part_num 记录到 weights_failed.json，可用 --retry-failed 单独重试
- 进度显示：实时显示进度、成功率、预估剩余时间

用法：
    # 全量抓取（默认从 parts.csv 第一个未处理的开始）
    python3 fetch_weights.py

    # 指定间隔（秒），默认 2-4 秒随机
    python3 fetch_weights.py --min-delay 3 --max-delay 6

    # 限制本次最多抓取 N 个（用于试跑）
    python3 fetch_weights.py --limit 10

    # 仅重试之前失败的 part_num
    python3 fetch_weights.py --retry-failed

    # 指定起始 part_num（跳过之前的，已废弃，建议用断点续传）
    python3 fetch_weights.py --start 3001

输出文件（位于 RB/ 目录）：
- weights.json        主结果，格式 {"part_num": weight_grams, ...}
- weights_failed.json 失败记录，格式 {"part_num": {"error": "...", "attempts": N}, ...}
"""

import argparse
import csv
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

# 路径配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RB_DIR = os.path.join(BASE_DIR, "RB")
PARTS_CSV = os.path.join(RB_DIR, "parts.csv")
WEIGHTS_JSON = os.path.join(RB_DIR, "weights.json")
FAILED_JSON = os.path.join(RB_DIR, "weights_failed.json")

# Bricklink 配置
BRICKLINK_URL_TMPL = "https://www.bricklink.com/v2/catalog/catalogitem.page?P={part}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive",
}

# 跳过前缀：这些类型零件在 Bricklink 上没有重量数据，直接跳过不抓取
SKIP_PREFIXES = ("Sticker Sheet", "Trading Card", "Pen")


def should_skip_by_name(name):
    """判断零件名称是否应跳过（无重量数据的类型）"""
    if not name:
        return False
    return name.startswith(SKIP_PREFIXES)


def log(msg):
    """带时间戳的日志输出"""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_json(path, default):
    """加载 JSON 文件，不存在则返回默认值"""
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return default


def save_json(path, data):
    """原子写入 JSON 文件（先写临时文件再重命名，避免中断时损坏）"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def extract_weight_from_html(html):
    """从 Bricklink HTML 内容中提取单个零件重量（克）。

    算法与 app/routes/parts.py 的 _extract_weight_from_html 一致，
    已在生产环境验证可用。
    """
    patterns = ["Weight：", "Weight:", "weight：", "weight:"]
    for pattern in patterns:
        idx = html.find(pattern)
        if idx != -1:
            segment = html[idx:idx + 100]
            m = re.search(r"(\d+(?:\.\d+)?)", segment)
            if m:
                try:
                    w = float(m.group(1))
                    if w > 0:
                        return round(w, 4)
                except ValueError:
                    pass
    # 回退：查找 "数字 g" 模式
    m = re.search(r"(\d+(?:\.\d+)?)\s*g", html)
    if m:
        try:
            w = float(m.group(1))
            if w > 0:
                return round(w, 4)
        except ValueError:
            pass
    return None


def fetch_weight(part_num, max_attempts=3):
    """从 Bricklink 抓取单个零件重量，返回 (weight, error)。

    weight 为 None 时表示抓取失败或未找到，error 描述失败原因。
    """
    clean_num = "".join(c for c in part_num if c.isalnum())
    if not clean_num:
        return None, "零件型号无效"

    url = BRICKLINK_URL_TMPL.format(part=clean_num)
    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status != 200:
                    last_error = f"HTTP {resp.status}"
                    continue
                data = resp.read()
                try:
                    html = data.decode("utf-8")
                except UnicodeDecodeError:
                    html = data.decode("latin-1", errors="ignore")
            weight = extract_weight_from_html(html)
            if weight is not None:
                return weight, None
            last_error = "未在页面中找到重量数据"
            # 页面正常但没重量，没必要重试
            break
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code}"
            if e.code == 404:
                return None, "Bricklink 上未找到该零件"
        except Exception as e:
            last_error = str(e)
        # 重试前等待（退避）
        if attempt < max_attempts:
            time.sleep(random.uniform(1, 2))
    return None, last_error or "查询失败"


def read_parts(csv_path):
    """从 parts.csv 读取所有 (part_num, name)，保持顺序"""
    parts = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            pn = (row.get("part_num") or "").strip()
            name = (row.get("name") or "").strip()
            if pn:
                parts.append((pn, name))
    return parts


def format_eta(seconds):
    """格式化剩余时间"""
    if seconds < 0 or seconds > 3600 * 24 * 365:
        return "--"
    if seconds < 60:
        return f"{int(seconds)}s"
    if seconds < 3600:
        return f"{int(seconds / 60)}m{int(seconds % 60)}s"
    hours = seconds / 3600
    if hours < 24:
        return f"{hours:.1f}h"
    return f"{hours / 24:.1f}d"


def main():
    parser = argparse.ArgumentParser(description="批量抓取 Bricklink 零件重量")
    parser.add_argument("--min-delay", type=float, default=2.0, help="最小间隔秒数（默认 2.0）")
    parser.add_argument("--max-delay", type=float, default=4.0, help="最大间隔秒数（默认 4.0）")
    parser.add_argument("--limit", type=int, default=0, help="本次最多抓取数量（0=不限）")
    parser.add_argument("--start", type=str, default="", help="起始 part_num（包含），跳过之前的")
    parser.add_argument("--retry-failed", action="store_true", help="仅重试 weights_failed.json 中的记录")
    args = parser.parse_args()

    if args.min_delay < 0 or args.max_delay < args.min_delay:
        log("错误：--min-delay 不能为负，且 --max-delay 不能小于 --min-delay")
        sys.exit(1)

    # 加载已有结果与失败记录（断点续传基础）
    weights = load_json(WEIGHTS_JSON, {})
    failed = load_json(FAILED_JSON, {})
    log(f"已加载结果：{len(weights)} 个；失败记录：{len(failed)} 个")

    if args.retry_failed:
        # 仅重试失败记录（name 信息不可用，不按名称跳过）
        todo = [(pn, "") for pn in failed.keys()]
        log(f"重试模式：共 {len(todo)} 个失败零件待重试")
        if not todo:
            log("没有失败记录可重试，退出")
            return
        retry_mode = True
    else:
        # 正常模式：从 parts.csv 读取所有 (part_num, name)
        all_parts = read_parts(PARTS_CSV)
        log(f"parts.csv 共 {len(all_parts)} 个零件")

        # 起始 part_num 过滤
        if args.start:
            try:
                idx = next(i for i, (pn, _) in enumerate(all_parts) if pn == args.start)
                all_parts = all_parts[idx:]
                log(f"从 {args.start} 开始，剩余 {len(all_parts)} 个")
            except StopIteration:
                log(f"警告：起始 part_num {args.start} 未找到，从头开始")

        # 过滤已成功的（断点续传）+ 跳过无重量类型
        todo = []
        skipped_no_weight = 0
        already_done = 0
        skipped_parts = set()
        for pn, name in all_parts:
            if pn in weights:
                already_done += 1
            elif should_skip_by_name(name):
                skipped_no_weight += 1
                skipped_parts.add(pn)
            else:
                todo.append((pn, name))
        log(f"待抓取：{len(todo)} 个（已成功 {already_done} 个，跳过 {skipped_no_weight} 个无重量类型）")

        # 清理 failed.json 中已被跳过类型的历史记录
        if skipped_parts:
            removed = [pn for pn in list(failed.keys()) if pn in skipped_parts]
            for pn in removed:
                failed.pop(pn, None)
            if removed:
                log(f"已从失败记录中清理 {len(removed)} 个无重量类型零件")
                save_json(FAILED_JSON, failed)

        retry_mode = False

        if not todo:
            log("全部已抓取完成，如需重试失败项请用 --retry-failed")
            return

    # limit 限制
    if args.limit > 0:
        todo = todo[:args.limit]
        log(f"本次限制抓取 {len(todo)} 个")

    success = 0
    fail = 0
    total = len(todo)
    start_time = time.time()

    for i, (part_num, name) in enumerate(todo, 1):
        # 抓取前等待（第一个不等待）
        if i > 1:
            delay = random.uniform(args.min_delay, args.max_delay)
            time.sleep(delay)

        weight, error = fetch_weight(part_num)

        if weight is not None:
            weights[part_num] = weight
            if part_num in failed:
                failed.pop(part_num, None)
            success += 1
            log(f"[{i}/{total}] ✓ {part_num} = {weight}g")
        else:
            # 失败：记录到 failed，attempts 累加
            prev = failed.get(part_num, {})
            attempts = prev.get("attempts", 0) + 1
            failed[part_num] = {"error": error, "attempts": attempts, "last": datetime.now().isoformat()}
            fail += 1
            log(f"[{i}/{total}] ✗ {part_num} - {error}")

        # 每抓一个立即落盘（断点续传关键）
        save_json(WEIGHTS_JSON, weights)
        save_json(FAILED_JSON, failed)

        # 进度与 ETA（每 10 个显示一次详细进度）
        if i % 10 == 0 or i == total:
            elapsed = time.time() - start_time
            done = i
            avg = elapsed / done if done else 0
            remain = (total - done) * avg
            rate = success / done * 100 if done else 0
            log(f"进度 {done}/{total} ({done/total*100:.1f}%) | 成功 {success} 失败 {fail} | 成功率 {rate:.1f}% | 平均 {avg:.1f}s/个 | 剩余 {format_eta(remain)}")

    elapsed = time.time() - start_time
    log("=" * 60)
    log(f"完成：共 {total} 个 | 成功 {success} | 失败 {fail} | 用时 {format_eta(elapsed)}")
    log(f"结果文件：{WEIGHTS_JSON}")
    log(f"失败记录：{FAILED_JSON}")
    if fail > 0:
        log(f"提示：可用 `python3 {os.path.basename(__file__)} --retry-failed` 重试失败项")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\n用户中断，已保存当前进度，下次运行会自动续传")
        sys.exit(130)
