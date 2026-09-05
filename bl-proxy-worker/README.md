# bl-proxy-worker
Bricklink 价格代理 CF Worker（KV 30 分钟缓存 + Cookie 预热 + 抓取解析）

## 架构
```
Cloudflare Worker (bl-proxy.你的域.workers.dev)
  ├─ 查 KV：bl:<P>:<colorID>:N → 命中且 <30min → 返缓存
  ├─ miss → Cookie 预热 + 抓 BL catalogPG.asp → 解析 → 写回 KV → 返回
```

## 部署步骤
```bash
cd bl-proxy-worker

# 1. 创建 KV 命名空间，把返回的 id 填到 wrangler.toml
npx wrangler kv namespace create BL_CACHE

# 2. 登录/部署
npx wrangler login
npx wrangler deploy
```

## 测试
```bash
curl "https://bl-proxy.你的域.workers.dev/api/price?P=3001&colorID=7"
curl "https://bl-proxy.你的域.workers.dev/api/price?P=3001&colorID=5"
```

## 前端接入
把 `frontend/js/api.js` 里的 `BL_PRICE_SERVER` 配成 Worker 地址：
```js
const BL_PRICE_SERVER = 'https://bl-proxy.你的域.workers.dev';
```
`fetchBLPriceFromServer` 会调用 `/api/price?P=...&colorID=...`，响应结构与
`server_bricklink_price.py` 一致，前端无需改动解析。

## 局限（务必知悉）
普通 Worker 的 `fetch()` 无法执行 AWS WAF 的 JS 挑战脚本，从数据中心 IP 直接抓
`catalogPG.asp` 大概率拿到 HTTP 202 挑战页。Worker 会把此类情况返回
`waf_challenge`（HTTP 502）。若实测仍被挑战，须改用 **Cloudflare Browser
Rendering**（付费）或 **Bricklink 官方 Open API**（推荐，无反爬）。