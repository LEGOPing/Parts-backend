#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 part_aliases.csv 推送到 Gitee 的 parts-rb 仓库（供前端加载 RB 数据库时导入
rb_aliases 离线表。别名解析基于 RB 离线库，不依赖 Supabase，可在系统外编辑本 CSV）。

用法：
    python3 push_part_aliases_to_gitee.py             # 推送当前 part_aliases.csv
    python3 push_part_aliases_to_gitee.py --dry-run   # 仅模拟，不实际推送

配置：Gitee 仓库 legoping/parts-rb，分支 main，token 默认使用 frontend/js/api.js 中的
DEFAULT_GITEE_TOKEN。也可通过环境变量 GITEE_TOKEN 覆盖。
"""

import argparse
import base64
import csv
import json
import os
import sys
import urllib.error
import urllib.request

# Gitee 配置（与 frontend/js/api.js 一致）
GITEE_API = "https://gitee.com/api/v5/repos/legoping/parts-rb/contents"
GITEE_BRANCH = "main"
DEFAULT_GITEE_TOKEN = "5e8fe75044a023e2c992c1b5d11c95f0"

# 本地文件路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PART_ALIASES_CSV = os.path.join(BASE_DIR, "part_aliases.csv")
CSV_REMOTE_NAME = "part_aliases.csv"


def log(msg):
    from datetime import datetime
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def gitee_request(method, path, payload=None):
    """调用 Gitee API，返回 (status_code, response_json)"""
    url = f"{GITEE_API}/{path}"
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json;charset=utf-8")
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
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
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
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


def validate_csv(path):
    """校验 CSV 表头与行结构，返回行数"""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = [h.strip() for h in (reader.fieldnames or [])]
        if "alias_part_num" not in headers or "rb_part_num" not in headers:
            raise ValueError(f"CSV 缺少必填表头 alias_part_num / rb_part_num，当前表头: {headers}")
        rows = [r for r in reader if (r.get("alias_part_num") or "").strip()]
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description="推送 part_aliases.csv 到 Gitee parts-rb 仓库")
    parser.add_argument("--dry-run", action="store_true", help="仅模拟，不实际推送")
    args = parser.parse_args()

    token = os.environ.get("GITEE_TOKEN") or DEFAULT_GITEE_TOKEN
    if not token:
        log("错误：未找到 Gitee Token，请设置环境变量 GITEE_TOKEN")
        sys.exit(1)

    if not os.path.exists(PART_ALIASES_CSV):
        log(f"错误：文件不存在 {PART_ALIASES_CSV}")
        sys.exit(1)

    try:
        row_count = validate_csv(PART_ALIASES_CSV)
    except ValueError as e:
        log(f"错误：CSV 校验失败: {e}")
        sys.exit(1)

    with open(PART_ALIASES_CSV, "rb") as f:
        raw = f.read()
    content_b64 = base64.b64encode(raw).decode("ascii")
    log(f"本地 part_aliases.csv: {row_count} 行数据, {len(raw)} 字节")

    if args.dry_run:
        log("【模拟模式】不会实际推送")
        log(f"目标: {GITEE_API}/{CSV_REMOTE_NAME} (分支 {GITEE_BRANCH})")
        return

    log("查询 Gitee 上现有文件...")
    sha = get_file_sha(token, CSV_REMOTE_NAME)
    if sha:
        log(f"文件已存在 (sha={sha[:8]}...)，将更新")
    else:
        log("文件不存在，将创建")

    payload = {
        "access_token": token,
        "content": content_b64,
        "message": f"feat: 更新零件别名表 ({row_count} 条) [skip ci]",
        "branch": GITEE_BRANCH,
    }
    if sha:
        payload["sha"] = sha

    method = "PUT" if sha else "POST"
    log(f"推送中 ({method} {GITEE_API}/{CSV_REMOTE_NAME})...")
    status, resp = gitee_request(method, CSV_REMOTE_NAME, payload)

    if status in (200, 201):
        commit = resp.get("commit", {})
        log(f"✓ 推送成功！commit={commit.get('sha', '?')[:8]}")
        log(f"  访问地址: https://gitee.com/legoping/parts-rb/raw/main/{CSV_REMOTE_NAME}")
    else:
        log(f"✗ 推送失败: HTTP {status}")
        log(f"  {resp.get('message', resp)}")
        sys.exit(1)


if __name__ == "__main__":
    main()