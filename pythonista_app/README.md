# 独立 B 原型：Safari/快捷指令版 BLP 抓价

这份原型验证一个可行性命题：**抓价系统「B」能否做成不依赖主展示 PWA「A」的独立实体，且在 iPhone 上单独完成抓价。**

结论先行：**可以，载体用「快捷指令 + Safari 网页 JS」，而不是做成 PWA webview。** 原因见下节。

---

## 为什么不用「主屏幕 PWA」当 B 的载体

| 载体 | 能否独立抓价 | 原因 |
|---|---|---|
| 主屏幕 PWA (standalone webview) | ❌ | 受限网页容器：撞 CORS、无脚本/书签入口、无分享到快捷指令 |
| 快捷指令「运行 JavaScript」+ Safari | ✅ | 跑在 Safari 真实内核，WAF 已由浏览器通过，无内核问题 |
| Pythonista + WKWebView | ✅ | 内置 Safari 内核过挑战，但要写较多原生 objc 代码 |

「B 独立抓价」的关键是**必须在 Safari/WKWebView 内核里跑 JS**，快捷指令正好满足，且和 A 完全无关。

---

## 原型构成

- `extract-price-on-safari.js` —— 核心代码：解析当前价格页，返回与 `BL-price.json` 兼容的 JSON。
- 本文件 —— 组装成快捷指令「独立 B」的步骤。

---

## 在 iPhone 上组装「独立 B」快捷指令

1. 快捷指令 App → 新建快捷指令，命名为 `B-抓价`。
2. 添加动作 **「运行 JavaScript on Safari Web Page」**。
3. 把 `extract-price-on-safari.js` 内容粘进该动作的脚本区。
4. 在它**前面**加 **「打开 URL」**：输入一个待抓价格页 URL（例如 `https://www.bricklink.com/catalogPG.asp?P=3001&colorID=86`）。这样每次手动改 URL 就能测单个零件。
5. 在 JS 动作**后面**加 **「获取剪贴板」/「读取文本」→「将文本保存到文件」**：把 JS 的输出（JSON 文本）存到「文件 App」某个目录（例如 `iCloud Drive/快速抓价/result.json`）。
6. 跑起来：Safari 打开一个价格页 → 分享 → 快捷指令 → 选 `B-抓价` → 会有输出文件。

> 要点：**JS 动作只对「当前 Safari 页面」生效**。所以批量（读 Gitee 清单 → 逐页取价）需要在快捷指令里用「重复」+「打开 URL」循环，或由你手动逐页点分享。一次一页，适合小批量/抽查。

---

## 在 Mac/PC 浏览器直接验证（最快的可行性测试）

不装任何东西，用浏览器验证 JS 本身是否正确：

1. 打开一个真实价格页，例如 `https://www.bricklink.com/catalogPG.asp?P=3001&colorID=86`。
2. 按 **F12** 打开开发者工具 → **Console**（控制台）。
3. 粘贴以下代码回车：

```js
// 临时把提取函数定义进控制台
var fn = function(page){ return extractPriceGuide(page); };
// 粘贴之前先载入 extract-price-on-safari.js 顶部 的 extractPriceGuide 函数体
// （可直接把该 JS 前 60 行复制进来），然后：
runExtract();
```

4. 应返回类似：
```json
{"url":"...","part_num":"3001","color_id":"86",
 "last_6_months":{"currency":"USD","min":...,"avg":...,"qty_avg":...,"max":...},
 "current_for_sale":{...}}
```

能打出这一行，就证明**「独立 B」的核心抓价逻辑在浏览器里成立**，剩下的只是把它组装进快捷指令而已。

---

## 与现有 BLP.py 的字段兼容性

`extract-price-on-safari.js` 返回的 `last_6_months` / `current_for_sale` 结构，
和 `BLP.py` 的 `build_record()` 写入 `BL-price.json` 的字段完全一致
（`currency/min/avg/qty_avg/max`）。因此提取结果可直接并入主价格库。

---

## 完整独立 B：端到端流程

目录里的文件共同构成一套可独立运行的抓价闭环（不依赖展示 PWA «A»）：

```
┌───────────────┐  ①读清单   ┌────────────────────┐
│ Supabase 系统库 │ ────────▶ │                    │
└───────────────┘            │  run-batch.mjs (Node主控)   │
                            │   ②逐个抓价格页      │
┌───────────────┐  ①合并    │   ③extract 提取      │
│ Gitee 价格表   │ ◀──────── │   ④写回+推送Gitee    │
│ BL-price.json│            └────────────────────┘
└───────────────┘
```

### 文件组成
| 文件 | 作用 | 状态 |
|---|---|---|
| `extract-price-on-safari.js` | 价格页→`min/avg/qty_avg/max` 提取器 | ✅ 已验证 |
| `run-batch.mjs` | 端到端主控：读Supabase+颜色映射→增量→抓价→合并→推送 | ✅ 逻辑可用（网络段须你本机验）|
| `README.md` | 本说明 | — |

### 用 run-batch.mjs（推荐，Mac/PC 一次跑完）
```bash
cd blp-shortcuts
node run-batch.mjs --dry-run    # 先看增量（读Supabase+颜色映射，标色正确性）
node run-batch.mjs --max 20     # 小批量试跑
node run-batch.mjs --max 370    # 全量
```
- 它会：读 Supabase `parts` 表 → 用 `colors.csv`+`bl_colors.json` 把 RB颜色ID映射成 BL颜色ID → 与 `BL-price.json` 求差集得待抓 → 逐个 `fetch` 价格页 → `extract` 提取 → 合并写回并推 Gitee。
- **WAF 兜底**：`fetch` 直连大概率遇到 HTTP 202（BL 挑战）。此时脚本暂停并提示用浏览器打开 URL 手动过挑战，回车后继续；或 `SKIP_BLOCKED=1` 跳过错败。
  > 提示：若想少遇到 202，建议用 `BLP.py`（Playwright 持久化，已验证能过挑战拿到价）作为抓取引擎，`run-batch` 或样式类似即可。run-batch 是"无浏览器依赖"的轻量参考实现。

### 用快捷指令（纯手机 Safari，单页/小批量）
1. 新建快捷指令，依次加：**打开URL** → **运行 JavaScript on Safari Web Page**（粘贴 `extract-price-on-safari.js`）→ **获取文本→存储到文件**。
2. Safari 打开价格页 → 分享 → 运行该快捷指令 → 得到当前页价格 JSON。
3. 适合抽查/少量；批量需「重复」动作或逐页。

### 颜色映射（关键，务必正确）
系统库 `parts.color_id` 是 **RB 内部颜色ID**，而价格页 `colorID` 是 **BL 颜色ID**。
`run-batch.mjs` 已实现 `RB颜色ID → RB颜色名(colors.csv) → BL颜色ID(bl_colors.json)`，
和 `BLP.py` 的 `rb2bl` 完全一致。**别跳过这步**，否则价格会挂错颜色。

---

## 建议的落地顺序（完整独立 B）
1. 在 Mac/PC 上 `node run-batch.mjs --dry-run`——确认能读到 Supabase 系统库、颜色映射正确、增量数量合理。
2. `--max 20` 小批量试，核对 `BL-price.json` 里新增记录的颜色与价格是否正确。
3. 全量 `--max 370`（或分几轮），最终 `BL-price.json` 补齐，推送 Gitee。
4. «A»（展示 PWA）照旧读该 JSON 即可，无需改动。

> 若 `run-batch` 在 Mac 直连 Supabase/BL 仍有网络问题（如沙箱 TLS 限制），用 `BLP.py`（Playwright）抓取引擎更稳——两者只是"抓取引擎"不同，提取/合并/推送逻辑共用同一套。