#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""临时下载服务：以 UTF-8 正确编码返回文件，避免浏览器中文乱码。"""
import http.server
import socketserver

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".py": "text/x-python; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
    }

with socketserver.TCPServer(("0.0.0.0", 8778), Handler) as httpd:
    httpd.serve_forever()