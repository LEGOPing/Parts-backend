#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
服务端按需抓取 Bricklink 公开价目页（catalogPG.asp）。

设计：不批量。前端在零件详情页右滑提出要求时调用本服务，服务端为每一次请求
独立冷启动无头浏览器（全新 Chromium context）访问 BL 价格页并解析两组价格，
这样每个零件相互隔离，触发的是单次独立的 AWS WAF 挑战。

接口：
    GET /api/price?P=<part>&colorID=<color>   # 返回价格 JSON
    GET /health                                # 健康检查

用法：
    export BL_CHROME=/path/to/chrome            # 可选：指向完整 chromium（无 headless-shell 时）
    export HTTPS_PROXY=http://user:pass@host:port   # 可选：住宅代理
    python3 server_bricklink_price.py --port 8000

返回：
    成功 {"ok": true, "part_num", "color_id", "last_6_months", "current_for_sale", "updated_at", "source"}
    失败 {"ok": false, "error": "..."}
"""
import argparse
import json
import logging
import os
import re
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from app.bricklink_price import fetch_price_guide_via_browser

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
logger = logging.getLogger('bl-price-server')

# 单次抓取超时（秒），超出返回失败
PER_REQ_TIMEOUT = 55


def _clean_part(part):
    return re.sub(r'[^A-Za-z0-9]', '', part or '')


class Handler(BaseHTTPRequestHandler):
    server_version = 'BLPrice/1.0'

    def log_message(self, fmt, *args):
        logger.info('%s %s', self.address_string(), fmt % args)

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            self._send_json(200, {'ok': True, 'service': 'bl-price-server', 'time': datetime.now().isoformat()})
            return
        if parsed.path == '/api/price':
            q = parse_qs(parsed.query)
            part = _clean_part((q.get('P') or q.get('part') or [''])[0])
            color = (q.get('colorID') or q.get('color') or [''])[0]
            if not part or not str(color):
                self._send_json(400, {'ok': False, 'error': '缺少参数 P / colorID'})
                return
            self._fetch(part, str(color))
            return
        self._send_json(404, {'ok': False, 'error': 'not found'})

    def _fetch(self, part, color_id):
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FTimeoutError
        executor = ThreadPoolExecutor(max_workers=1)

        def work():
            try:
                data = fetch_price_guide_via_browser(part, color_id, timeout_ms=PER_REQ_TIMEOUT * 1000)
                if data is None:
                    return False, {'ok': False, 'error': 'bricklink 解析无数据(可能被风控拦截)'}
                payload = {
                    'ok': True,
                    'part_num': part,
                    'color_id': str(color_id),
                    'last_6_months': data.get('last_6_months'),
                    'current_for_sale': data.get('current_for_sale'),
                    'updated_at': datetime.now().replace(microsecond=0).isoformat(),
                    'source': 'bricklink-live',
                }
                return True, payload
            except Exception as e:
                logger.warning('抓取失败 %s color=%s: %s', part, color_id, str(e)[:120])
                return False, {'ok': False, 'error': 'bricklink 抓取异常: %s' % str(e)[:100]}

        try:
            fut = executor.submit(work)
            ok, result = fut.result(timeout=PER_REQ_TIMEOUT + 10)
        except FTimeoutError:
            ok, result = False, {'ok': False, 'error': 'bricklink 抓取超时'}
        finally:
            executor.shutdown(wait=False)
        self._send_json(200, result)


def main():
    parser = argparse.ArgumentParser(description='服务端按需抓取 Bricklink 价目页')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', 8000)))
    parser.add_argument('--host', default='0.0.0.0')
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    logger.info('BL 价格服务已启动 http://%s:%s/api/price?P=3001&colorID=7', args.host, args.port)
    logger.info('BL_CHROME=%s', os.environ.get('BL_CHROME') or '(未设置，需系统装有 headless-shell)')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()