#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 RB inventory_parts.csv 去重后分片推送到 Gitee 的 parts-rb 仓库（供前端 fetchRBFile 分片合并读取）。

背景：
    原始 inventory_parts.csv 约 132MB（150 万行），Gitee contents API 单文件最多返回 10MiB，
    导致前端"更新RB"只能读到前 10MiB 数据（约 12.6 万行），大量零件（如 3004/13）缺失。
    本脚本按 (part_num, color_id) 去重后数据仅约 9.2MB（10.3 万行，覆盖全部零件颜色组合），
    再切分为多个 <8MB 的分片文件推送到 Gitee，前端依次下载各分片合并后导入，即可完整读取。

用法：
    python3 push_inventory_parts_to_gitee.py                      # 自动从 Gitee 拉取完整 CSV 并分片推送
    python3 push_inventory_parts_to_gitee.py --source file.csv    # 使用本地完整 CSV
    python3 push_inventory_parts_to_gitee.py --dry-run            # 仅模拟，不实际推送

配置：Gitee 仓库 legoping/parts-rb，分支 main，token 默认使用 frontend/js/api.js 中的 DEFAULT_GITEE_TOKEN。
也可通过环境变量 GITEE_TOKEN 覆盖。
"""

import argparse
import base64
import csv
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime

# Gitee 配置（与 frontend/js/api.js 一致）
GITEE_API = "https://gitee.com/api/v5/repos/legoping/parts-rb/contents"
GITEE_BRANCH = "main"
DEFAULT_GITEE_TOKEN = "5e8fe75044a023e2c992c1b5d11c95f0"

# 分片配置：每个分片目标小于 8MB（Gitee contents API 截断阈值约 10MiB，留出安全余量）
MAX_SHARD_BYTES = 7 * 1024 * 1024

# 分片文件名模板（与前端 frontend/js/api.js 保持一致）
SHARD_BASE = "inventory_parts_"
SHARD_SUFFIX = ".csv"
MANIFEST = "inventory_parts_shards.json"


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def gitee_request(method, path, payload=None):
    """调用 Gitee API，返回 (status_code, response_json)"""
    url = f"{GITEE_API}/{path}"
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json;charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"message": body}


def get_file_sha(token, filename):
    """获取 Gitee 上现有文件的 SHA（用于更新），不存在返回 None"""
    url = f"{GITEE_API}/{filename}?ref={GITEE_BRANCH}&access_token={token}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            if isinstance(data, dict):
                return data.get("sha")
            log(f"获取 SHA 返回异常类型: {type(data).__name__}")
            return None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        body = e.read().decode("utf-8", errors="ignore")
        log(f"获取文件 SHA 失败: HTTP {e.code} {body[:200]}")
        return None
    except Exception as e:
        log(f"获取文件 SHA 异常: {e}")
        return None


def download_full_csv_from_gitee():
    """通过 git sparse checkout 从 Gitee 拉取完整的 inventory_parts.csv（contents API 会截断，raw 需登录）"""
    tmpdir = tempfile.mkdtemp(prefix="rb_inventory_")
    try:
        log("通过 git sparse checkout 拉取完整 inventory_parts.csv ...")
        repo_url = f"https://gitee.com/legoping/parts-rb.git"
        subprocess.run(
            ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", repo_url, "repo"],
            cwd=tmpdir, check=True, capture_output=True
        )
        subprocess.run(
            ["git", "sparse-checkout", "set", "inventory_parts.csv"],
            cwd=os.path.join(tmpdir, "repo"), check=True, capture_output=True
        )
        csv_path = os.path.join(tmpdir, "repo", "inventory_parts.csv")
        if not os.path.exists(csv_path):
            raise FileNotFoundError("sparse checkout 未获取到 inventory_parts.csv")
        log(f"完整文件已就绪: {csv_path} ({os.path.getsize(csv_path)} 字节)")
        return csv_path
    except Exception as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
        log(f"✗ 从 Gitee 拉取完整 CSV 失败: {e}")
        raise


def dedup_and_split(csv_path):
    """按 (part_num, color_id) 去重，再切分为 <8MB 的分片（每个分片都带表头）"""
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        if not header:
            raise ValueError("CSV 无表头")

        seen = set()
        dedup_rows = []
        total_rows = 0
        for r in reader:
            total_rows += 1
            key = (r["part_num"], r["color_id"])
            if key not in seen:
                seen.add(key)
                dedup_rows.append(r)

    # 序列化为文本（使用 csv 模块保证引号/逗号正确转义）
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=header)
    writer.writeheader()
    for r in dedup_rows:
        writer.writerow(r)
    full_text = buf.getvalue()

    header_line = ",".join(header) + "\n"
    header_bytes = len(header_line.encode("utf-8"))

    # 逐行切分，保证每个分片（含表头）< MAX_SHARD_BYTES
    # 注意：full_text 首行是原始表头（与 header_line 重复），需跳过，仅切分数据行
    all_lines = full_text.splitlines(keepends=True)
    data_lines = all_lines[1:] if all_lines else []

    shards = []
    current = [header_line]
    current_size = header_bytes
    for line in data_lines:
        line_size = len(line.encode("utf-8"))
        if current_size + line_size > MAX_SHARD_BYTES and len(current) > 1:
            shards.append("".join(current))
            current = [header_line]
            current_size = header_bytes
        current.append(line)
        current_size += line_size
    if current:
        shards.append("".join(current))

    return header, dedup_rows, total_rows, shards


def main():
    parser = argparse.ArgumentParser(description="去重分片推送 inventory_parts.csv 到 Gitee parts-rb 仓库")
    parser.add_argument("--source", help="本地完整 inventory_parts.csv 路径（默认自动从 Gitee 拉取）")
    parser.add_argument("--dry-run", action="store_true", help="仅模拟，不实际推送")
    args = parser.parse_args()

    token = os.environ.get("GITEE_TOKEN") or DEFAULT_GITEE_TOKEN
    if not token:
        log("错误：未找到 Gitee Token，请设置环境变量 GITEE_TOKEN")
        sys.exit(1)

    # 1. 获取完整 CSV
    temp_csv = None
    if args.source:
        csv_path = args.source
        if not os.path.exists(csv_path):
            log(f"错误：文件不存在 {csv_path}")
            sys.exit(1)
        log(f"使用本地文件: {csv_path}")
    else:
        csv_path = download_full_csv_from_gitee()
        temp_csv = csv_path

    try:
        # 2. 去重 + 分片
        log("按 (part_num, color_id) 去重并分片...")
        header, dedup_rows, total_rows, shards = dedup_and_split(csv_path)
        log(f"原始行数: {total_rows} -> 去重后: {len(dedup_rows)} 行")
        for i, s in enumerate(shards):
            log(f"  分片 {i}: {len(s.encode('utf-8'))} 字节 ({s.count(chr(10))} 行)")

        manifest = {
            "count": len(shards),
            "files": [f"{SHARD_BASE}{i}{SHARD_SUFFIX}" for i in range(len(shards))],
            "rows": len(dedup_rows),
            "source_rows": total_rows,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }
        log(f"清单: {json.dumps(manifest)}")

        if args.dry_run:
            log("【模拟模式】不会实际推送")
            for i, s in enumerate(shards):
                fname = f"{SHARD_BASE}{i}{SHARD_SUFFIX}"
                log(f"  将推送 {fname} ({len(s.encode('utf-8'))} 字节)")
            log(f"  将推送 {MANIFEST}")
            return

        # 3. 推送分片（PUT 更新 / POST 创建）
        for i, s in enumerate(shards):
            fname = f"{SHARD_BASE}{i}{SHARD_SUFFIX}"
            content_b64 = base64.b64encode(s.encode("utf-8")).decode("ascii")
            sha = get_file_sha(token, fname)
            payload = {
                "access_token": token,
                "content": content_b64,
                "message": f"feat: 更新库存分片 {fname} ({len(dedup_rows)} 条去重数据) [skip ci]",
                "branch": GITEE_BRANCH,
            }
            if sha:
                payload["sha"] = sha
            method = "PUT" if sha else "POST"
            log(f"推送 {fname} ({method}) ...")
            status, resp = gitee_request(method, fname, payload)
            if status in (200, 201):
                commit = resp.get("commit", {})
                log(f"  ✓ {fname} 推送成功 commit={str(commit.get('sha', '?'))[:8]}")
            else:
                log(f"  ✗ {fname} 推送失败: HTTP {status} {resp.get('message', resp)}")
                sys.exit(1)

        # 4. 推送清单
        manifest_b64 = base64.b64encode(json.dumps(manifest, ensure_ascii=False).encode("utf-8")).decode("ascii")
        sha = get_file_sha(token, MANIFEST)
        payload = {
            "access_token": token,
            "content": manifest_b64,
            "message": f"feat: 更新库存分片清单 ({manifest['count']} 片, {manifest['rows']} 条) [skip ci]",
            "branch": GITEE_BRANCH,
        }
        if sha:
            payload["sha"] = sha
        method = "PUT" if sha else "POST"
        log(f"推送 {MANIFEST} ({method}) ...")
        status, resp = gitee_request(method, MANIFEST, payload)
        if status in (200, 201):
            commit = resp.get("commit", {})
            log(f"  ✓ {MANIFEST} 推送成功 commit={str(commit.get('sha', '?'))[:8]}")
        else:
            log(f"  ✗ {MANIFEST} 推送失败: HTTP {status} {resp.get('message', resp)}")
            sys.exit(1)

        log("✓ 全部推送完成！")
        for i in range(len(shards)):
            log(f"  https://gitee.com/legoping/parts-rb/raw/main/{SHARD_BASE}{i}{SHARD_SUFFIX}")
    finally:
        if temp_csv and os.path.exists(temp_csv):
            parent = os.path.dirname(temp_csv)
            shutil.rmtree(parent, ignore_errors=True)


if __name__ == "__main__":
    main()
