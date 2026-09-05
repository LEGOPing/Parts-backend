#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 BL-price.json（Bricklink 离线价格库）推送到 Gitee parts-rb 仓库，供前端读取。

用法：
    python3 push_bl_price_to_gitee.py            # 推送当前 BL-price.json
    python3 push_bl_price_to_gitee.py --dry-run  # 仅模拟，不实际推送

配置：Gitee 仓库 legoping/parts-rb，分支 main，token 默认用 DEFAULT_GITEE_TOKEN，
也可用环境变量 GITEE_TOKEN 覆盖。
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

GITEE_API = "https://gitee.com/api/v5/repos/legoping/parts-rb/contents"
GITEE_BRANCH = "main"
DEFAULT_GITEE_TOKEN = "5e8fe75044a023e2c992c1b5d11c95f0"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRICE_JSON = os.path.join(BASE_DIR, "BL-price.json")


def log(msg):
    from datetime import datetime
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def gitee_request(method, path, payload=None):
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
    url = f"{GITEE_API}/{filename}?ref={GITEE_BRANCH}&access_token={token}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            if isinstance(data, dict):
                return data.get("sha")
            return None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        body = e.read().decode("utf-8", errors="ignore")
        log(f"获取 SHA 失败: HTTP {e.code} {body[:200]}")
        return None
    except Exception as e:
        log(f"获取 SHA 异常: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(description="推送 BL-price.json 到 Gitee parts-rb")
    parser.add_argument("--dry-run", action="store_true", help="仅模拟，不实际推送")
    args = parser.parse_args()

    token = os.environ.get("GITEE_TOKEN") or DEFAULT_GITEE_TOKEN
    if not token:
        log("错误：未找到 Gitee Token")
        sys.exit(1)

    if not os.path.exists(PRICE_JSON):
        log(f"错误：文件不存在 {PRICE_JSON}")
        sys.exit(1)

    with open(PRICE_JSON, "rb") as f:
        raw = f.read()
    content_b64 = base64.b64encode(raw).decode("ascii")

    try:
        data = json.loads(raw)
        gen = data.get("generated_at", "")
        n = len(data.get("records", []))
        log(f"本地 BL-price.json: {n} 条记录, 生成于 {gen}, {len(raw)} 字节")
    except json.JSONDecodeError:
        log("警告：BL-price.json 不是有效 JSON，仍将推送原始内容")

    if args.dry_run:
        log("【模拟模式】不会实际推送")
        log(f"目标: {GITEE_API}/BL-price.json (分支 {GITEE_BRANCH})")
        return

    log("查询 Gitee 上现有文件...")
    sha = get_file_sha(token, "BL-price.json")
    method = "PUT" if sha else "POST"
    log("文件已存在，将更新" if sha else "文件不存在，将创建")

    payload = {
        "access_token": token,
        "content": content_b64,
        "message": f"feat: 更新 Bricklink 离线价格库 ({n} 条) [skip ci]",
        "branch": GITEE_BRANCH,
    }
    if sha:
        payload["sha"] = sha

    log(f"推送中 ({method})...")
    status, resp = gitee_request(method, "BL-price.json", payload)
    if status in (200, 201):
        commit = resp.get("commit", {})
        log(f"✓ 推送成功！commit={str(commit.get('sha', '?'))[:8]}")
        log("  访问: https://gitee.com/legoping/parts-rb/raw/main/BL-price.json")
    else:
        log(f"✗ 推送失败: HTTP {status} {resp.get('message', resp)}")
        sys.exit(1)


if __name__ == "__main__":
    main()