# BL-price 增量价格库策划文档

> 对应脚本：`pythonista_proto.py`（v6，跑在 iPhone Pythonista 上）
> 价格库实体：`parts-rb/BL-price.json`
> 系统数据库：Supabase `tfxydlkpxkdxpxyoqrkz`

---

## 一、背景与目标

### 1.1 为什么需要这个系统

RB 零件管理系统（前端）在"库存视图"里需要实时参考每个 (零件型号, 颜色) 的 Bricklink 价格，用于估算库存价值、对比买入成本、制定出售策略。

**但 Bricklink 没有开放 API**，所有价格必须从 Web 端抓取。且：

- Bricklink 有 WAF（Web Application Firewall），纯 HTTP 请求会被 Cloudflare/UAM 拦截返回 403
- 价格是静态的（半年才明显变化），没必要每次前端渲染都去 BL 页面抓
- 前端跑在浏览器里容易被拦截 + Cookie 池管理成本高

所以采用 **iPhone + Pythonista + WKWebView** 做爬虫宿主——真·WebKit、Cookie/Session 跟随系统、天然过 WAF，每天/每两天跑一次就行。

### 1.2 核心目标

| # | 目标 | 说明 |
|---|------|------|
| 1 | **增量抓取** | 只抓"系统库新增的"和"价格超过 N 天过期的"零件，不全量跑 |
| 2 | **闭环推送** | 抓完自动合并进价格库并回写 Gitee，前端直接读 JSON |
| 3 | **防呆保护** | 绝不能用少量数据（如手动自测的 2 条）覆盖远端完整价格库 |
| 4 | **口径对齐** | pythonista 统计的零件种类数 = 系统设置页显示的 701（前端 IndexedDB 统计口径） |
| 5 | **可诊断** | 日志里打印每个过滤点掉了多少行，便于定位数据在哪丢的 |

---

## 二、整体架构

### 2.1 数据流图

```
┌──────────────────────────────────────────────────────────────────────┐
│                         iPhone Pythonista                             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                   pythonista_proto.py                         │  │
│  │                                                                │  │
│  │  ① 拉系统零件                      ┌─────────────────────────┐ │  │
│  │     Supabase boxes + parts         │  Supabase Postgres      │ │  │
│  │     (逐 box 带 box_id 过滤)  ───▶  │  RLS 保护，必须带 box_id│ │  │
│  │                                    └─────────────────────────┘ │  │
│  │                                                                │  │
│  │  ② 拉颜色映射                                              │  │
│  │     RB colors.csv         ───▶  parts-rb (Gitee)               │  │
│  │     BL bl_colors.json     ───▶  parts-rb (Gitee)               │  │
│  │                                                                │  │
│  │  ③ 拉现有价格库 (BL-price.json) ───▶  parts-rb (Gitee)         │  │
│  │                                                                │  │
│  │  ④ 计算增量 todo                                               │  │
│  │     系统零件 - 已有 key = 新增                                  │  │
│  │     已有 key 且 saved_at > 30d = 过期重抓                      │  │
│  │                                                                │  │
│  │  ⑤ 逐页抓价格                                                  │  │
│  │     WKWebView 打开 BL catalogPG 页面                           │  │
│  │     JS 注入 extractPriceGuide() 解析                          │  │
│  │                                                                │  │
│  │  ⑥ 合并 + 回写                                                 │  │
│  │     先 backup 远端 old_*.json                                  │  │
│  │     条数校验 (本地 ≥ 远端 才推送)                               │  │
│  │     Gitee PUT BL-price.json                                   │  │
│  │                                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│           ▲                              ▲                            │
│           │                              │                            │
│    本地落盘:                        远端价格库:                      │
│    progress.log                     parts-rb / BL-price.json          │
│    result.json                      (698 条，全库)                    │
│    price_backups/                   ↓                                │
│      old_*.json (远端快照)          前端直接 fetch 读                 │
│      result_*.json (本地历史)                                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 三类数据源

| 数据源 | 位置 | 用途 | 访问方式 |
|--------|------|------|----------|
| **系统库** | Supabase Postgres | 全部零件清单（part_num + RB color_id） | PostgREST REST API（匿名 Key） |
| **颜色映射** | parts-rb Gitee | RB 颜色 → BL 颜色的 id 转换 | raw.githubusercontent / Gitee raw |
| **价格库** | parts-rb Gitee | 已抓过的 (part, BL_color) 价格 | REST v5 contents（含 access_token） |

### 2.3 输出实体

**BL-price.json 结构**（parts-rb 仓库）：

```jsonc
{
  "generated_at": "2026-09-22T16:36:54",
  "updated_at":   "2026-09-22T16:36:54",
  "count":        700,
  "source":       "bl-webview",
  "records": [
    {
      "key":             "3001:85",          // 去重主键 = 归一化零件号:BL颜色id
      "part_num":        "3001",
      "color_id":        "85",                // BL 颜色 id（字符串）
      "currency":        "CNY",
      "last_6_months":   { "min": 2.5, "avg": 3.2, "qty_avg": 3.0, "max": 4.0 },
      "current_for_sale":{ "min": 2.0, "avg": 2.8, "qty_avg": 2.6, "max": 3.5 },
      "source":           "bl-webview",
      "saved_at":         "2026-09-22T16:36:54"
    },
    ...
  ]
}
```

---

## 三、模块详解

### 3.1 配置参数区（`pythonista_proto.py` 顶部）

```python
# ---- 抓取参数 ----
MAX_FETCH_PER_RUN = 0     # 本轮最多抓多少条；0 = 不限量
MAX_AGE_DAYS     = 30     # 已有价格超过该天数即视为过期
MAX_WAIT  = 90            # 单页最长等待价格段出现（秒）
POLL_STEP = 3             # 每次轮询间隔（秒）
JS_TO     = 8             # 单次 JS 调用超时（秒）

# ---- 手动自测模式 ----
# ⚠ 调试完务必清空 MANUAL_PARTS = []，否则会覆盖价格库！
MANUAL_PARTS = []         # 例：[('3001','85')]  ← 调试完立即清空

# ---- Gitee parts-rb ----
GITEE_OWNER   = "legoping"
GITEE_REPO    = "parts-rb"
GITEE_BRANCH  = "main"
GITEE_TOKEN   = os.environ.get("GITEE_TOKEN", "5e8fe750...")
PRICE_JSON    = "BL-price.json"
COLORS_CSV    = "colors.csv"
BL_COLORS_JSON= "bl_colors.json"

# ---- Supabase ----
SUPABASE_ANON = os.environ.get("SUPABASE_ANON_KEY", "eyJhbGciOi...")

# ---- 输出路径 ----
OUT_JSON = "result.json"       # 本地结果副本
LOG_FILE = "progress.log"      # 实时日志
OLD_DIR  = "price_backups"     # 推送前自动备份远端旧版的目录
```

### 3.2 模块划分

| # | 区段 | 函数 | 职责 |
|---|------|------|------|
| 0 | 通用 | `_ts`, `log`, `norm`, `_http_read`, `gitee_raw` | 时间戳、日志、颜色名归一化、HTTP 读（带 429 退避）、Gitee raw 拉取 |
| 1 | 数据加载 | `load_bl_colors`, `load_rb_color_names`, `supabase_query`, **`load_system_parts`** | 拉 2 份颜色表、Supabase REST、逐 box 去重 |
| 2 | 价格库读取 | `load_existing_price` | 拉远端 BL-price.json |
| 3 | Gitee 回写 | `gitee_push_file`, `save_local`, **`backup_remote_price`**, `full_payload` | PUT 文件、本地落盘（带版本化备份）、**推送前远端快照** |
| 4 | 抽取 | `EXTRACT_JS`（JS 注入脚本）, `_eval_js_timed`, `_poll_price`, `_start_load`, `_wait_nav`, `_fetch_one` | 打开 BL 页面、等导航、注入 JS 提取价格段 |
| 5 | 主流程 | **`_is_stale`**, **`_build_todo`**, `_upsert`, **`_run_closed_loop`**, `_worker`, `_run_manual`, `_close_ui` | 过期判断、**增量计算**、逐页抓取、**回写** |
| 6 | 入口 | `main` | 创建 WKWebView → full_modal → 后台 worker |

### 3.3 核心函数详解

#### `load_system_parts()` — 最容易踩坑的地方

**为什么不直接 `SELECT * FROM parts`？**

```
Supabase parts 表有 RLS（Row Level Security），匿名角色必须带 box_id 条件才能看到完整数据：
  全表扫 → 594 条（RLS 过滤掉 107 条）
  逐 box 查 → 824 行 → 去重 701 条（跟前端 IndexedDB 统计一致）
```

**为什么 `color_id` 为空也要计入？**

```
前端 loadStats:
  partColorSet.add(pn + '\0' + (color_id ?? ''))
                                    ↑ 空也计入 → 701  ✓
pythonista 旧版:
  if not cid: continue               ↑ 跳过 → 594  ✗
```

**为什么 `color_id=0` 要特别处理？**

```
RB colors.csv:
  -1, [Unknown]       ← 特殊值
   0, Black           ← Black！完全有效！对应 BL id=11
   1, Blue
  ...

Python 陷阱: str(0 or '') == ''  ← 把 0 也变成空了！
正确写法:    str(x) if x is not None else ''
```

函数内建诊断桶会打印 color_id 分布：

```
color_id 分布: None=20  0(Black有效)=85  -1(Unknown)=3  正数=690  空串=22
```

#### `_build_todo()` — 增量计算核心

```python
todo = []
for (rb_part, rb_color) in 系统库:
    bl_part = 归一化零件号   # re.sub(r'[^a-zA-Z0-9]', '', part)
    bl_cid  = rb2bl[rb_color]  # 颜色映射
    key = f'{bl_part}:{bl_cid}'
    
    if key 已在价格库中 且 saved_at 未过期:
        跳过
    else:
        加入 todo 列表
```

还会打印两类诊断：
- **颜色映射跳过数**：系统库 N 条 → 可转 BL key 的 M 条（颜色没对应 BL 色的会掉）
- **价格库孤儿数**：⚠ N 条 key 在 Supabase 里已不存在（历史残留，暂不清理）

#### `_run_closed_loop()` — 主闭环流程

```
1. _build_todo()                    计算待抓列表
2. for (part, bl_cid, key) in todo:
      _fetch_one()                  逐页打开 BL 页面抓价格
      _upsert()                     合并进 _results
      每 5 条 save_local()          断点续传
3. save_local(_results)             最终本地副本
4. 条数校验（安全拦截）             ⚠ 关键防线
5. backup_remote_price()            远端快照保存
6. gitee_push_file()                PUT BL-price.json
```

**条数校验逻辑（核心防线）：**

```python
if local_count < remote_count:
    log('⚠ 安全拦截：本地 N 条 < 远端 M 条，拒绝覆盖！')
    return  # 不推送
```

这正是为了防止本次事故：手动自测 `MANUAL_PARTS = [('3001','86'), ('3002','86')]` → 本地 2 条 < 远端 698 条 → 拦截住，不会覆盖。

#### `_fetch_one()` — WKWebView 抓取流程

```
1. _start_load(webview, BL catalogPG URL)
2. _wait_nav(webview)                 等 readyState=complete 且 URL 匹配目标零件
3. _poll_price(webview)               注入 EXTRACT_JS，轮询 90 秒
4. 解析返回 JSON                       { last_6_months: {...}, current_for_sale: {...} }
5. 组装 rec = { key, part_num, color_id, ..., saved_at }
```

EXTRACT_JS 的 JS 注入脚本用正则从 BL 页面 HTML 中提取价格段表格，兼容 Bricklink 页面格式变更。

#### `backup_remote_price()` — 推送前远端快照

每次推 Gitee 前先 `gitee_raw(BL-price.json)` 下载远端当前版本，存到：

```
price_backups/old_20260922_163654.json   ← 推送前的完整快照
```

**就算推送真的搞砸了**，iPhone Pythonista 文件 App → price_backups → 复制最近一份 old_*.json 回来，直接就能恢复。

#### `save_local()` — 本地落盘带版本化

写 `result.json` 前若已存在旧版，自动挪到 `price_backups/result_时间戳.json`：

```python
if os.path.exists(target):
    bak = f'price_backups/result_{ts}.json'
    os.rename(target, bak)
```

---

## 四、安全机制汇总

| # | 防线 | 位置 | 防护什么 |
|---|------|------|----------|
| 1 | **MANUAL_PARTS 警告注释** | 顶部常量区 | 提醒调试完立即清空 `[]` |
| 2 | **条数校验保护** | `_run_closed_loop` 推送前 | 本地 N < 远端 M → 拦截（核心防线） |
| 3 | **远端快照备份** | `backup_remote_price` | 推送前下载 old_*.json 到本地 |
| 4 | **本地版本化** | `save_local` | result.json 旧版自动归档 |
| 5 | **RLS 规避** | `load_system_parts` 逐 box | Supabase 匿名访问必须带 box_id |
| 6 | **color_id=0 保留** | 颜色值处理 | 不让 `str(0 or '')` 吞掉 Black |
| 7 | **color_id 空计入** | 去重集合 | 与前端 loadStats 口径对齐 |

---

## 五、运行方式与日志

### 5.1 两种运行模式

| 模式 | 触发条件 | Supabase | 抓取目标 | 推 Gitee |
|------|----------|----------|----------|----------|
| **闭环模式** | `MANUAL_PARTS = []`（默认） | ✅ 读系统库 | 增量 todo 列表 | ✅ 推 |
| **手动自测** | `MANUAL_PARTS` 非空 | ❌ 不读 | 直接指定的零件 | ❌ 只写本地 |

### 5.2 运行步骤

1. iPhone 打开 Pythonista
2. 打开 `pythonista_proto.py`
3. 运行三角按钮 → 自动 full_modal 全屏展示 WebView → 跑完自动关闭
4. 挡屏或中途想看进度 → 切换到"文件 App" → Pythonista 文件夹 → 看 `progress.log` / `result.json`

### 5.3 典型日志输出

```
[16:36:36] === 启动：增量价格闭环（独立 B / iPhone）===
[16:36:36] 提示：full_modal 挡屏时到文件 App 看 progress.log / result.json 实时进度。
[16:36:37] === 数据准备 ===
[16:36:38] RB颜色->BL颜色 映射 147 条（RB总 275 色，其中 128 色无 BL 对应，SKIP 会掉这部分）
[16:36:39]   Supabase boxes: 39 个
[16:36:52]   逐 box 累计原始行数: 824
[16:36:52]   color_id 分布: None=20  0(Black有效)=85  -1(Unknown)=3  正数=690  空串=22
[16:36:52]   去重 (part_num, color_id): 701 条（跳过 part_num 空=0）
[16:36:52] 系统库去重零件组合 701 条
[16:36:52]   其中可转为 BL key: 594 条（跳过：107 条颜色无 BL 映射）
[16:36:54] 现有价格 key 700 条
[16:36:54]   ⚠ 价格库中有 106 条 key 在 Supabase 里已不存在（历史残留，暂保留不清理）
[16:36:54] 待抓组合合计 0 条（新增 + 过期重抓）
[16:36:54] === 无待抓零件（无新增且无过期），最多只写一份本地副本 ===
[16:36:54]   result.json 旧版已备份为 price_backups/result_20260922_163654.json
[16:36:54]   已写 result.json（当前 700 条）
```

---

## 六、已知问题与改进方向

| # | 问题 | 现状 | 改进方向 |
|---|------|------|----------|
| 1 | **RB 颜色到 BL 颜色映射只有 53%** | RB 275 色 → BL 可映射 147 色，128 色没对应 BL 色 | 考虑：① 补全 bl_colors.json 缺失条目 ② 透明/闪光色用替代色 |
| 2 | **颜色库 106 条历史残留** | Supabase 里这些零件已不存在，但价格库里还留着 | 下次跑加清理策略：本地 N < 远端 M 时只拦截推送，也可以定期清理 orphan |
| 3 | **Supabase parts RLS 规则** | 匿名必须带 box_id 才能拿全量 | 前端 / 后端协作：改 Supabase RLS 为允许 anon 全表读 parts（若安全允许） |
| 4 | **WKWebView 在 iPhone 上偶尔闪退** | 脚本中已用全局 `_webview` 引用防止 GC，仍偶发 | 可以加 `@objc_util.retain_globals` 或换用 SFSafariViewController |
| 5 | **Gitee 有 1 req/s 限频** | `gitee_push_file` 已加 429 退避重试（指数，最多 6 次） | 抓量大时考虑本地批量合并后一次性 PUT，减少 Gitee 交互次数 |
| 6 | **BL 价格段 JS 解析** | 正则从 HTML 里提取，BL 改 DOM 结构就会失效 | 可以改用 `?viewApi=` 参数或等官方 API |

---

## 七、事故复盘（2026-09-22）

### 7.1 发生了什么

| 时间 | Commit | BL-price.json | 说明 |
|------|--------|---------------|------|
| 14:10 | `350c92e4` | **698 条**（正确） | pythonista 自动上传 |
| 14:12~14:18 | `035d3986` ~ `7743883e` | **2 条** | pythonista 连续 6 次自动上传，每次只有 2 条 |
| 15:52 | `7b186957` | 2 条 | 手动救了一次，但马上又被覆盖 |
| 15:53 | `691bb2a2` | **2 条** | 又被 pythonista 覆盖 |

### 7.2 根因

`MANUAL_PARTS = [('3001','86'), ('3002','86')]` —— iPhone 上调试完没有清空回 `[]`。pythonista 跑闭环模式时：

1. 闭环模式判断 `MANUAL_PARTS` 为空 → 正常走增量逻辑
2. 但某次运行可能因为 Supabase 临时 RLS/网络问题，`load_system_parts()` 只拿到了少量数据
3. 本地 2 条直接 PUT 覆盖远端 698 条
4. Gitee 上没有自动备份，直接覆盖

### 7.3 防护措施（已全部实现）

| # | 措施 | 状态 |
|---|------|------|
| 1 | `MANUAL_PARTS` 加醒目 ⚠ 注释，提醒调试完必须清空 | ✅ |
| 2 | 推送前 **条数校验**：本地 N < 远端 M → 拒绝覆盖（核心防线） | ✅ |
| 3 | `backup_remote_price()`：推送前自动下载远端快照到 `price_backups/old_*.json` | ✅ |
| 4 | `save_local()` 版本化：`result.json` 旧版自动归档 | ✅ |
| 5 | Gitee 上恢复价格库到正确版本 `350c92e4` | ✅ |
| 6 | Supabase 查询改为逐 box（绕过 RLS） | ✅ |
| 7 | `color_id=0`（Black）正确保留，`color_id` 空也计入去重 | ✅ |
| 8 | 全流程加详细诊断日志 | ✅ |

### 7.4 教训

> **自动定时爬虫 = 自动自动自动覆盖器**。
> 任何会被定时触发的脚本，"推送前校验本地数据量 ≥ 远端" 是底线防线，怎么强调都不为过。
> Gitee/GitHub 不做内容级备份，**自己做**。

---

## 八、价格库恢复操作手册

**当前价格库损坏时的恢复步骤：**

1. Gitee parts-rb → 浏览 commit history → 找到最近正确版本
2. 用 API 下载该 commit 的 BL-price.json：
   ```bash
   curl -H "Authorization: Bearer <GITEE_TOKEN>" \
     "https://gitee.com/api/v5/repos/legoping/parts-rb/contents/BL-price.json?ref=<SHA>"
   ```
3. Pythonista 本地 price_backups/old_*.json 也可以直接用
4. 恢复后立即推送：
   ```python
   # 本地已有正确数据时，直接运行：
   import subprocess, os
   os.system("curl -H 'apikey: ...' -H 'Authorization: Bearer ...' -X PUT ...")
   ```
5. 运行一次 pythonista_proto.py（MANUAL_PARTS = []）验证增量逻辑正常

---

*文档对应脚本版本：commit `0d9b3898916c`*
*文档生成时间：2026-09-22*
