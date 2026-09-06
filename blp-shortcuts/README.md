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
（`currency/min/avg/qty_avg/max`）。因此快捷指令得到的 JSON 可直接并入主价格库。

---

## 尚未实现（原型边界）

- ❌ 快捷指令与 Gitee 的双向读写（需「获取 URL 内容」+ 手动鉴权，做法可行但此处不展开）。
- ❌ 批量逐页自动循环（快捷指令支持「重复」动作，可扩展）。
- ❌ PWA «A» 侧如何消费这些数据（与既有 `BL-price.json` 读取流程一致，无新增）。

本原型聚焦**单个可验证的可行性核心**：浏览器内 JS 提取价格。