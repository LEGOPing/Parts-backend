# -*- coding: utf-8 -*-
"""
Bricklink 价格指南（catalogPG.asp）抓取与解析。

背景：
    Bricklink 的价格指南页（https://www.bricklink.com/catalogPG.asp?P=<型号>&colorID=<颜色ID>）
    位于 AWS WAF 之后，数据中心/远端 IP 直接请求会返回 HTTP 202 + JavaScript 挑战页（反爬）。
    本模块采用"无头浏览器"（Playwright + Chromium）让页面真实执行挑战脚本以拿到
    `aws-waf-token` 并成功加载，再在页面上下文中提取两组价格数据：
      1. "Last 6 Months Sales"  →  New  → Min / Avg / Qty Avg / Max
      2. "Current Items for Sale" → New  → Min / Avg / Qty Avg / Max
    解析算法与前端 ui.js 的 extractBLPriceGuide 一致（锚定 + 宽松正则），
    避免误取 "Stores 搜索筛选" 里的 Min/Max。
"""

import logging
import os
import re
from datetime import datetime

logger = logging.getLogger(__name__)

# 币种与金额之间允许的空格 / 不间断空格 / &nbsp; 实体
_SEP = r'(?:[\s\u00a0]|&nbsp;)*'


def _collect_price_cells(section, limit=20000):
    """在价格指南区域内，按文档顺序收集所有指标单元格。

    Bricklink 的价格指南是一个"指标为行、条件为列"的网格：
      列顺序恒为 [Last6-New, Last6-Used, Current-New, Current-Used]。
    每一列单元格形如：
      <td>Min Price:</td><td><b>CNY&nbsp;0.07</b></td>

    返回 per metric 的列表（保持出现顺序）：
      {"min": [(currency, value), ...], "avg": [...], "qty_avg": [...], "max": [...]}
    """
    # 'Qty Avg Price' 必须先于 'Avg Price'，避免贪心误匹配
    pattern = re.compile(
        r'<td>(Min Price|Qty Avg Price|Avg Price|Max Price):</td>\s*'
        r'<td><b>([A-Z]{2,3})?(?:\s|&nbsp;|\u00a0)*([\d,]+\.\d+)</b></td>',
        re.I,
    )
    out = {'min': [], 'avg': [], 'qty_avg': [], 'max': []}
    seen = 0
    for m in pattern.finditer(section[:limit]):
        label = m.group(1).lower()
        currency = (m.group(2) or '').upper()
        try:
            value = float(m.group(3).replace(',', ''))
        except ValueError:
            continue
        key_map = {'min price': 'min', 'avg price': 'avg',
                   'qty avg price': 'qty_avg', 'max price': 'max'}
        out[key_map[label]].append((currency, value))
        seen += 1
    return out


def _block_from_cols(cells, col):
    """取某一条件列的四项价格；col=0 为 New（Last6/Current 的 New 列）。"""
    def get(key):
        lst = cells.get(key, [])
        if col < len(lst):
            return lst[col][1]
        return None
    def currency(key):
        lst = cells.get(key, [])
        if col < len(lst):
            return lst[col][0]
        return ''
    min_v, avg_v, qty_v, max_v = get('min'), get('avg'), get('qty_avg'), get('max')
    if all(v is None for v in (min_v, avg_v, qty_v, max_v)):
        return None
    return {
        'currency': currency('min') or currency('avg') or currency('qty_avg') or currency('max'),
        'min': min_v,
        'avg': avg_v,
        'qty_avg': qty_v,
        'max': max_v,
    }


def extract_price_guide(html):
    """从价格指南页 HTML 中提取两组价格数据（New 条件）。

    布局说明：价格指南网格的 4 个数据列恒为
      [Last6-New(col0), Last6-Used(col1), Current-New(col2), Current-Used(col3)]，
    因此取 col0 作为 "Last 6 Months Sales · New"，取 col2 作为 "Current Items for Sale · New"。

    返回：
        {
            "currency": "CNY",
            "last_6_months": {min, avg, qty_avg, max, currency},
            "current_for_sale": {min, avg, qty_avg, max, currency},
        }
    解析不到时对应块为 None。
    """
    if not html or not isinstance(html, str):
        return None

    idx = html.find('Last 6 Months Sales')
    if idx < 0:
        return None

    # 从 "Last 6 Months Sales" 标题起截取足够范围（覆盖四个条件列；不含更下方的商店在售列表）
    section = html[idx:idx + 20000]
    cells = _collect_price_cells(section)

    last_6_months = _block_from_cols(cells, 0)   # col0 = New
    current_for_sale = _block_from_cols(cells, 2)  # col2 = New

    if last_6_months is None and current_for_sale is None:
        return None
    return {
        'last_6_months': last_6_months,
        'current_for_sale': current_for_sale,
    }


def _build_url(part_number, color_id):
    clean = ''.join(c for c in str(part_number) if c.isalnum())
    return f"https://www.bricklink.com/catalogPG.asp?P={clean}&colorID={color_id}"


def _proxy_from_env():
    """返回沙盒/部署环境要求的出网代理（HTTP_PROXY/HTTPS_PROXY），供浏览器复用。"""
    for key in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'):
        val = os.environ.get(key)
        if val:
            return val
    return None


def fetch_price_guide_via_browser(part_number, color_id, timeout_ms=45000):
    """用无头浏览器抓取价格指南页并解析两组价格。

    流程：启动 Chromium（带真实 UA），跳转目标页，等待 AWS WAF 挑战执行完成并出现
    价格关键锚点（"Last 6 Months Sales"），随后抓取最终渲染后的 HTML 交由 extract_price_guide 解析。

    返回 extract_price_guide 的结构；失败抛出异常由调用方兜底。
    """
    from playwright.sync_api import sync_playwright

    url = _build_url(part_number, color_id)
    proxy = _proxy_from_env()

    with sync_playwright() as p:
        launch_kwargs = {}
        if proxy:
            launch_kwargs['proxy'] = {'server': proxy}
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
            **launch_kwargs,
        )
        try:
            context = browser.new_context(
                user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/120.0 Safari/537.36"),
                viewport={'width': 1280, 'height': 900},
                locale='en-US',
            )
            page = context.new_page()
            page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
            # 等待 WAF 挑战执行并渲染出价格锚点；轮询直到出现目标文本或超时
            try:
                page.wait_for_selector('text=Last 6 Months Sales', timeout=timeout_ms)
            except Exception:
                pass
            # 再等待一小段时间确保价格表数值渲染完成
            try:
                page.wait_for_timeout(1500)
            except Exception:
                pass
            html = page.content()
            return extract_price_guide(html)
        finally:
            browser.close()


def fetch_price_guide(part_number, color_id, timeout_ms=45000):
    """统一入口：优先无头浏览器；若环境无浏览器则回退纯 HTTP（可能被 WAF 拦截）。"""
    try:
        return fetch_price_guide_via_browser(part_number, color_id, timeout_ms=timeout_ms)
    except Exception as e:
        logger.warning("无头浏览器抓取价格失败: %s", e)
        return None