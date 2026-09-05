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
import stat
from datetime import datetime

from app.bricklink_price import fetch_price_guide_via_browser

logger = logging.getLogger(__name__)

# API 网关返回结构需要的 CORS
_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
}

# S3/控制台上传解压可能丢失可执行位及依赖共享库，这里统一准备。
# 依赖库若打包在 zip 的 libs/ 下，则让动态链接器优先加载它们。
_PW_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pw-browsers')
_LIBS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'libs')


def _prepare_runtime():
    if os.path.isdir(_LIBS_DIR):
        os.environ['LD_LIBRARY_PATH'] = '%s:%s' % (_LIBS_DIR, os.environ.get('LD_LIBRARY_PATH', ''))
    os.environ['PLAYWRIGHT_BROWSERS_PATH'] = _PW_DIR


def _clean_part(part):
    return re.sub(r'[^A-Za-z0-9]', '', part or '')


def _locate_headless_shell():
    """在 zip 内的 pw-browsers 目录里定位 headless_shell 可执行文件路径，并恢复可执行位。"""
    base = os.environ.get('PLAYWRIGHT_BROWSERS_PATH') or _PW_DIR
    for root, _, files in os.walk(base):
        if 'headless_shell' not in files:
            continue
        p = os.path.join(root, 'headless_shell')
        try:
            st = os.stat(p)
            os.chmod(p, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        except OSError:
            logger.warning('无法恢复 headless_shell 可执行位: %s', p)
        return p
    return None


def _json(code, obj):
    return {
        'statusCode': code,
        'headers': _CORS,
        'body': json.dumps(obj, ensure_ascii=False),
    }


def lambda_handler(event, context):
    # 冷启动：优先准备 LD_LIBRARY_PATH（libs/）和 PLAYWRIGHT_BROWSERS_PATH
    _prepare_runtime()
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