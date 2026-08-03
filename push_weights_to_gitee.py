#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 RB/weights.json 推送到 Gitee 的 parts-rb 仓库（供前端 fetchRBFile 读取）。

用法：
    python3 push_weights_to_gitee.py            # 推送当前 weights.json
    python3 push_weights_to_gitee.py --dry-run  # 仅模拟，不实际推送

配置：Gitee 仓库 legoping/parts-rb，分支 main，token 默认使用 frontend/js/api.js 中的 DEFAULT_GITEE_TOKEN。
也可通过环境变量 GITEE_TOKEN 覆盖。
"""

import argparse
import base64
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
WEIGHTS_JSON = os.path.join(BASE_DIR, "RB", "weights.json")


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
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json;charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
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
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            # Gitee API 正常返回 dict 含 sha；异常可能返回 list
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


def main():
    parser = argparse.ArgumentParser(description="推送 weights.json 到 Gitee parts-rb 仓库")
    parser.add_argument("--dry-run", action="store_true", help="仅模拟，不实际推送")
    args = parser.parse_args()

    token = os.environ.get("GITEE_TOKEN") or DEFAULT_GITEE_TOKEN
    if not token:
        log("错误：未找到 Gitee Token，请设置环境变量 GITEE_TOKEN")
        sys.exit(1)

    # 读取本地 weights.json
    if not os.path.exists(WEIGHTS_JSON):
        log(f"错误：文件不存在 {WEIGHTS_JSON}")
        sys.exit(1)

    with open(WEIGHTS_JSON, "rb") as f:
        raw = f.read()
    content_b64 = base64.b64encode(raw).decode("ascii")

    try:
        data = json.loads(raw)
        log(f"本地 weights.json: {len(data)} 条记录, {len(raw)} 字节")
    except json.JSONDecodeError:
        log("警告：weights.json 不是有效 JSON，仍将推送原始内容")

    if args.dry_run:
        log("【模拟模式】不会实际推送")
        log(f"目标: {GITEE_API}/weights.json (分支 {GITEE_BRANCH})")
        return

    # 1. 获取现有文件 SHA
    log("查询 Gitee 上现有文件...")
    sha = get_file_sha(token, "weights.json")
    if sha:
        log(f"文件已存在 (sha={sha[:8]}...)，将更新")
    else:
        log("文件不存在，将创建")

    # 2. 构建请求体
    payload = {
        "access_token": token,
        "content": content_b64,
        "message": f"feat: 更新零件重量缓存 ({len(data)} 条) [skip ci]",
        "branch": GITEE_BRANCH,
    }
    if sha:
        payload["sha"] = sha

    # 3. 推送
    method = "PUT" if sha else "POST"
    log(f"推送中 ({method} {GITEE_API}/weights.json)...")
    status, resp = gitee_request(method, "weights.json", payload)

    if status in (200, 201):
        commit = resp.get("commit", {})
        log(f"✓ 推送成功！commit={commit.get('sha', '?')[:8]}")
        log(f"  访问地址: https://gitee.com/legoping/parts-rb/raw/main/weights.json")
    else:
        log(f"✗ 推送失败: HTTP {status}")
        log(f"  {resp.get('message', resp)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
