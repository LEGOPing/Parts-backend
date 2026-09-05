# -*- coding: utf-8 -*-
"""
AWS Lambda 无头浏览器抓取 Bricklink 价格指南（Python + Playwright headless-shell）。

复用 app/bricklink_price 的抓取与解析逻辑，本次以 API Gateway(REST/HTTP API) 的
Proxy 事件标准 handler 形式暴露：GET /api/price?P=<part>&colorID=<color>。

打包约定（见 build.sh）：
  - chromium headless-shell 打到 zip 内 pw-browsers 目录；
  - Lambda 环境变量 PLAYWRIGHT_BROWSERS_PATH 指向 zip 内该目录；
  - BL_HEADLESS_SHELL=1 让底层用 headless=True 启动 headless-shell。
  - handler 会扫描 pw-browsers 自动定位 headless_shell 可执行文件并设到 BL_CHROME。
"""
import json
import logging
import os
import re
from datetime import datetime

from app.bricklink_price import fetch_price_guide_via_browser

logger = logging.getLogger(__name__)

# API 网关返回结构需要的 CORS
_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
}


def _clean_part(part):
    return re.sub(r'[^A-Za-z0-9]', '', part or '')


def _locate_headless_shell():
    """在 zip 内的 pw-browsers 目录里定位 headless_shell 可执行文件路径。"""
    base = os.environ.get('PLAYWRIGHT_BROWSERS_PATH') or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'pw-browsers')
    for root, _, files in os.walk(base):
        if 'headless_shell' in files:
            p = os.path.join(root, 'headless_shell')
            if os.path.exists(p):
                return p
    return None


def _json(code, obj):
    return {
        'statusCode': code,
        'headers': _CORS,
        'body': json.dumps(obj, ensure_ascii=False),
    }


def lambda_handler(event, context):
    q = event.get('queryStringParameters') or {}
    part = _clean_part(q.get('P') or q.get('part') or q.get('part_number') or '')
    color = str(q.get('colorID') or q.get('color') or q.get('color_id') or '')
    if not part or not color:
        return _json(400, {'ok': False, 'error': '缺少参数 P / colorID'})

    # Lambda 冷启动环境：定位并设置 headless-shell 可执行路径
    shell = _locate_headless_shell()
    if shell:
        os.environ['BL_CHROME'] = shell
        os.environ['BL_HEADLESS_SHELL'] = '1'
        logger.info('use headless-shell: %s', shell)
    else:
        logger.warning('未在 pw-browsers 中找到 headless_shell，Playwright 将尝试默认浏览器')

    try:
        data = fetch_price_guide_via_browser(part, color, timeout_ms=60000)
        if not data:
            return _json(200, {'ok': False, 'error': 'bricklink 解析无数据(可能被风控拦截)'})
        last6 = data.get('last_6_months')
        cur = data.get('current_for_sale')
        currency = (last6 and last6.get('currency')) or (cur and cur.get('currency')) or ''
        body = {
            'ok': True,
            'part_num': part,
            'color_id': color,
            'currency': currency,
            'last_6_months': last6,
            'current_for_sale': cur,
            'updated_at': datetime.now().replace(microsecond=0).isoformat(),
            'source': 'bricklink-live-aws-lambda',
        }
        return _json(200, body)
    except Exception as e:
        logger.exception('抓取失败 %s color=%s', part, color)
        return _json(200, {'ok': False, 'error': 'bricklink 抓取异常: %s' % str(e)[:200]})