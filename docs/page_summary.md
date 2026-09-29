# 乐高零件管理系统 - 页面规划方案总结

---

## 一、页面架构设计

### 1.1 整体布局结构

系统采用 **三区域垂直布局**（AA-BB-CC 模式），适配移动端和桌面端：

| 区域 | 位置 | 功能 | 样式特点 |
|------|------|------|----------|
| **AA区域** | 顶部 | Logo + 标题 | 黄色背景（#F2CD37），Logo 92x92px |
| **BB区域** | 中部 | 导航标签页 | 高度 84px，横向排列 4 个按钮 |
| **CC区域** | 底部 | 内容区域 | 白色卡片容器，自适应高度 |

### 1.2 标题栏（AA区域）

```
┌─────────────────────────────────────┐
│  [LOGO]  顺德乐高玩具专卖店-零件库   │
└─────────────────────────────────────┘
```

- Logo 图片：`icons/LOGO.JPEG`，固定 92x92px
- 标题文案：「顺德乐高玩具专卖店-零件库」
- 字体大小：18px，加粗

### 1.3 标签页导航（BB区域）

四个核心功能模块通过标签页切换：

```
┌──────────────────────────────────────────────────┐
│  [仓库管理]  [零件管理]  [零件搜索]  [系统设置]   │
└──────────────────────────────────────────────────┘
```

| 标签 | CSS 类 | 默认状态 | 说明 |
|------|--------|---------|------|
| 仓库管理 | `.repo-btn` | active | 默认激活，进入显示仓库列表 |
| 零件管理 | `.part-btn` | - | 选中盒子后进入，显示零件列表 |
| 零件搜索 | `.search-btn` | - | 全局搜索零件库存 |
| 系统设置 | `.settings-btn` | - | 数据/缓存/统计/RB 管理 |

切换逻辑由 `switchTab(tabName, btn)` 实现，切换时自动加载对应数据（仓库列表 / 零件列表 / 清空搜索 / 统计信息）。

---

## 二、功能模块页面规划

### 2.1 仓库管理页面（repositories-tab）

**布局结构**：
```
┌─────────────────────────────────────┐
│  仓库列表  共 N 个仓库   [添加仓库]  │  ← repository-header
├─────────────────────────────────────┤
│ [仓库1] [仓库2] [仓库3] ...          │  ← repository-list (横向滚动)
├─────────────────────────────────────┤
│  ▼ 仓库名 - 盒子管理  共 N 个盒子   │  ← box-management (选中仓库后)
│  [添加盒子] [盒子转仓]              │
├─────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐            │
│ │盒子1│ │盒子2│ │盒子3│ ...        │  ← box-grid (3列网格)
│ │ 2P  │ │ 5P  │ │ 3P  │            │
│ └─────┘ └─────┘ └─────┘            │
└─────────────────────────────────────┘
```

**交互特性**：
- 点击仓库卡片 → 选中并加载盒子列表（`selectRepository`）
- 长按仓库卡片 → 内联编辑仓库名称（`startEditRepository`）
- 盒子卡片显示零件数量（X P，P 为零件总数）
- 点击"添加仓库" → 弹出输入框创建仓库（`addRepository`）
- 点击"添加盒子" → 弹出输入框创建盒子（`addBox`）
- 点击盒子卡片 → 切换到零件管理标签页

**盒子转仓**（`toggleBoxTransferMode` / `toggleTransferBoxSelection` / `showTransferTargetPicker` / `performBoxTransfer`）：
- 点击"盒子转仓"进入转仓模式，勾选要转移的盒子（临时盒子不可转仓）
- 选择目标仓库（排除当前仓库与临时仓库）
- 转移时处理 ID 冲突：若目标仓库已占用相同 `box_number`，自动分配下一个可用编号（`numKey` 统一处理 Supabase int8 字符串返回）
- 转仓成功后自动打开目标仓库展示结果

**自动清理机制**（`loadRepositories` 中）：
- 按仓库名去重，重复仓库的盒子自动转移到第一个同名仓库后删除
- 自动清理"待定盒子"仓库
- 自动创建"临时仓库"（用于转盒暂存）

### 2.2 零件管理页面（parts-tab）

**布局结构**：
```
┌─────────────────────────────────────┐
│  盒子名_零件管理  共 N 种零件        │  ← part-header
├─────────────────────────────────────┤
│ [返回] [批量导入] [零件转盒] [添加零件] │  ← part-action-buttons
├─────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐│
│ │零件型号  │ │零件型号  │ │零件型号  ││  ← part-grid
│ │[图片]   │ │[图片]   │ │[图片]   ││
│ │零件名称  │ │零件名称  │ │零件名称  ││
│ │颜色名称  │ │颜色名称  │ │颜色名称  ││
│ │新  数量 │ │旧  数量 │ │新  数量 ││
│ └─────────┘ └─────────┘ └─────────┘│
└─────────────────────────────────────┘
```

**操作按钮**：
| 按钮 | 功能 | 状态 |
|------|------|------|
| 返回 | 返回仓库管理页面 | ✅ 已实现 |
| 批量导入 | CSV 文件导入零件 | ✅ 已实现 |
| 零件转盒 | 转移零件到其他盒子 | ⚠️ 开发中（alert 提示） |
| 添加零件 | 弹出添加零件面板 | ✅ 已实现 |

**交互特性**：
- 点击零件卡片 → 显示零件详情弹窗（`showPartDetail`）
- 零件图片从 Gitee Parts-img 加载（通过 `getPartImageUrl` 查询 RB 库）
- 零件名称/型号联想基于本地 RB_Database（`searchPartsByNumber` / `getPartNameSuggestions`）
- **左右滑动切换盒子**：在零件管理页水平滑动（阈值 60px）切换上一个/下一个盒子（`initPartsSwipeGesture` / `switchBox`），带滑动动画与序号显示（`updateBoxSequence`）
- **称重计算**：添加零件面板中通过"称重计算"按钮打开计算器（`showWeightCalculator`），从 Bricklink 查询单个重量（`fetchPartWeightForCalculator`，支持离线/缓存/在线来源），根据总重量自动计算数量并填入（`calculateWeightQuantity`）

### 2.3 零件搜索页面（search-tab）

**布局结构**（搜索/重置按钮位于标题右侧，搜索在最右）：
```
┌─────────────────────────────────────┐
│  零件搜索              [重置] [搜索] │  ← search-header
├─────────────────────────────────────┤
│ 型号: [________]  名称: [________]   │  ← filter-row 1
│ 颜色ID: [____] [选色]  状态: [▼全部] │  ← filter-row 2
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │11215  零件名称                  │ │  ← search-results
│ │        黑色  [新]        数量    │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │3001   零件名称                  │ │
│ │        红色  [旧]        数量    │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**搜索条件**：
| 条件 | 类型 | 说明 |
|------|------|------|
| 型号 | 模糊匹配 | `part_num.toLowerCase().includes(q)` |
| 名称 | 模糊匹配 | `name.toLowerCase().includes(q)` |
| 颜色ID | 精确匹配 | Supabase `color_id=eq.xxx` |
| 状态 | 精确匹配 | 新品 / 旧品 / 全部（`is_new` 字段） |

**颜色选择器**：
- 点击"选色"按钮 → 弹出颜色网格（`showSearchColorPicker`）
- 颜色列表从 RB_Database 的 `rb_colors` 表加载（`loadSearchColorGrid`）
- 支持搜索过滤颜色（`filterColors`）

**搜索执行**：
- `handleAdvancedSearch()` → 调用 `searchParts(params)` → Supabase REST 查询
- 搜索结果在 `renderSearchResults` 中渲染卡片
- 每个结果卡片显示：型号、名称、颜色（带色块）、新旧标签、数量

### 2.4 系统设置页面（settings-tab）

**布局结构**：
```
┌─────────────────────────────────────┐
│  系统设置                            │
├─────────────────────────────────────┤
│ 数据管理                            │
│ [初始化数据库][数据备份][数据恢复]    │
│ [数据同步]                          │
│ [更新RB] [导出RB]                   │
│ (RB状态提示)                        │
├─────────────────────────────────────┤
│ 缓存管理                            │
│ [清除本地缓存] [重启应用]            │
├─────────────────────────────────────┤
│ 统计信息                            │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐│
│ │  N   │ │  N   │ │  N   │ │  N   ││
│ │仓库数│ │盒子数│ │零件种│ │零件总││
│ └──────┘ └──────┘ └──────┘ └──────┘│
│ [刷新统计]                          │
├─────────────────────────────────────┤
│ 关于系统                            │
│ 版本: 3.0.0 (Supabase版)           │
│ 数据库: Supabase PostgreSQL         │
│ 静态资源: GitHub Pages + Gitee      │
│ 开发者: LEGOPing                    │
└─────────────────────────────────────┘
```

**数据管理按钮**：
| 按钮 | 功能 | 实现 |
|------|------|------|
| 初始化数据库 | 重置 Supabase 表结构 | 调用 FastAPI `/api/settings/init` |
| 数据备份 | 备份数据库到 COS + Gitee | 调用 FastAPI `/api/settings/backup` |
| 数据恢复 | 从备份文件恢复 | 调用 FastAPI `/api/settings/restore/{file}` |
| 数据同步 | 缓存当前数据到 localStorage | `syncData()` |
| 更新RB | 从 Gitee 下载 Rebrickable 数据到 IndexedDB | `updateRB()` |
| 导出RB | 导出 RB_Database 为 JSON 并上传 Gitee | `exportRB()` |

**RB 状态提示**（`showRBStatusHint`）：
- 显示本地 RB_Database 各表记录数
- 提示是否需要更新

**统计信息**（`loadStats` → `getStats`）：
- 并行查询 Supabase：仓库数、盒子数、零件种类、零件总数（`SUM(quantity)`）

---

## 三、模态框组件规划

系统设计了多个模态框组件，统一使用遮罩层 + 卡片布局：

| 模态框名称 | 触发函数 | 功能 |
|------------|----------|------|
| **添加零件面板** | `showAddPartSheet()` | 表单填写零件信息，含型号/名称联想 |
| **零件选择器** | `showPartSelector()` | 搜索并选择零件型号 |
| **颜色选择器** | `showColorPicker()` | 网格展示零件可用颜色 |
| **搜索颜色选择器** | `showSearchColorPicker()` | 搜索页专用颜色选择 |
| **零件详情** | `showPartDetail()` | 查看零件完整信息+编辑数量+删除+合并+图片管理 |
| **CSV导入** | `showCSVImporter()` | 文件选择 + 预览 + 确认导入 |
| **称重计算** | `showWeightCalculator()` | 根据总重量和单个重量计算零件数量 |
| **合并零件** | `showMergePartSelector()` | 合并相同零件（型号+颜色+状态一致） |
| **图片管理** | `manageCustomImage()` | 管理自定义零件图片（URL/本地上传） |

### 3.1 添加零件面板

```
┌─────────────────────────────────────┐
│  添加零件                    [关闭]  │
├─────────────────────────────────────┤
│ 零件型号: [________] (联想下拉)     │
│ 零件名称: [________] (自动填充)     │
│ 颜色:     [选择颜色] (网格选择)     │
│ 状态:     [新品/旧品]               │
│ 数量:     [___]                     │
├─────────────────────────────────────┤
│              [保存]                 │
└─────────────────────────────────────┘
```

**智能联想**（`initAddPartSuggestions`）：
- 输入零件型号时调用 `searchPartsByNumber` 联想
- 输入零件名称时调用 `getPartNameSuggestions` 智能分词联想
- 选择型号后自动填充名称（`matchPartNumberFromName`）
- 选中零件后加载可用颜色（`loadColorGrid` → 查询 `rb_elements`）

### 3.2 颜色选择器

```
┌─────────────────────────────────────┐
│  选择颜色           [搜索: ______]  │
├─────────────────────────────────────┤
│ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐    │
│ │ 红│ │ 蓝│ │ 绿│ │ 黄│ │ 白│ ...│  ← 颜色网格
│ └───┘ └───┘ └───┘ └───┘ └───┘    │
└─────────────────────────────────────┘
```

- 从 RB_Database 的 `rb_colors` 表加载全部颜色
- 若指定了 `partNum`，则仅显示该零件可用颜色（查询 `rb_elements`）
- 支持搜索过滤

### 3.3 零件详情弹窗

```
┌─────────────────────────────────────┐
│  零件详情              [删][并][返]  │
├─────────────────────────────────────┤
│        [零件图片]                   │
│   [删除图片] [变更图片/添加图片]     │
│ 型号: 3001                    [新]  │
│ 名称: Brick 2x4                     │
│ 颜色: 红色 (色块)    数量: [-] 5 [+]│
│ [搜索] [保存]                        │
└─────────────────────────────────────┘
```

- 支持直接编辑数量（+/- 按钮，内部 `updateQtyDisplay()` 更新显示），数量颜色分级（<10 红 / 10-50 橙 / ≥50 绿）
- 删除按钮带确认（`deletePartConfirm` → `executeDeletePart`，需密码验证）
- **合并按钮**：`showMergePartSelector` 在当前盒子中查找相同零件（型号+颜色+状态一致）合并，数量累加后删除当前零件
- **搜索按钮**：`searchFromDetail` 以当前零件型号+颜色跳转搜索页
- **图片管理**：图片区域左滑显示变更按钮（`changePartImage`），支持 URL 添加（`saveImageFromUrl`）/ 本地上传（`uploadLocalImage`）/ 删除（`deletePartDetailImage`，同时清理离线缓存与 Gitee）

### 3.4 CSV 导入流程

```
点击"批量导入"
    │
    ▼
showCSVImporter() → 文件选择器（可下载模板 downloadCSVTemplate）
    │
    ▼
processCSVFile(file) → 读取文件内容
    │
    ▼
parseCSVContent(content) → 解析 CSV
    │
    ▼
showImportConfirmation(data) → 加载颜色/名称/图片，检测重复，渲染确认表
    │
    ▼
用户选择合并/新增 → confirmCSVImport() → doConfirmCSVImport()
    │
    ▼
batchCreateParts(partsData) → Supabase 批量插入
```

**确认表特性**（`showImportConfirmation`）：
- 每个零件卡片显示：型号、名称（始终从 RB 库获取，忽略 CSV 中的 name）、颜色色块、数量、新旧标签、图片
- **重复检测**：型号+颜色+新旧状态三者一致视为重复，提示"已有 N 个"
- **合并/新增选择**：重复零件可逐条选择"合并"（数量累加）或"新增"（新建记录），默认选合并（`setImportAction`）

---

## 四、UI设计规范

### 4.1 色彩系统

| 颜色变量 | 值 | 用途 |
|----------|-----|------|
| `--primary-color` | #F2CD37 | 页面背景（乐高黄色） |
| `--secondary-color` | #2196F3 | 主按钮、选中状态 |
| `--success-color` | #4CAF50 | 成功状态、新品标签、初始化按钮 |
| `--warning-color` | #FF9800 | 警告状态、旧品标签、恢复按钮 |
| `--danger-color` | #F44336 | 删除按钮、数量高亮、清除缓存 |
| `--white-color` | #FFFFFF | 内容区背景 |
| `--black-color` | #333333 | 主文字颜色 |

### 4.2 P 单位自适应布局

系统使用 **P 单位** 进行自适应布局，基于屏幕 DPI 动态计算：

```javascript
// ui.js - calculateP()
// 1P = (8 / 25.4) × DPI，约等于 46px（在标准屏幕上）
:root {
    --P: 46px;
    --card-width: 92px;    /* 2P */
    --card-height: 64px;   /* 约 1.4P */
    --grid-width: 300px;
}
```

- 应用启动时 `calculateP()` 检测屏幕 DPI 并计算 P 值
- 用于盒子卡片、零件卡片的尺寸计算
- 确保不同设备上的视觉一致性

### 4.3 响应式设计

- **移动端**（<768px）：3 列盒子/零件网格，卡片宽度约 92px
- **桌面端**（≥768px）：自动适配，居中显示
- orientation: portrait（manifest.json 配置竖屏优先）

### 4.4 交互设计规范

| 交互类型 | 实现方式 | 适用场景 |
|----------|----------|----------|
| **点击** | `addEventListener('click')` | 导航、选择、按钮操作 |
| **长按** | `setupLongPress` (800ms 定时器) | 编辑仓库名、快速编辑零件数量 |
| **滑动** | 横向滚动容器 (`overflow-x: auto`) | 仓库列表 |
| **表单验证** | 实时错误提示 | 添加零件、CSV 导入 |
| **状态反馈** | CSS 类切换（active/selected） | 标签页切换、选中状态 |
| **联想输入** | input 事件 + 防抖 | 零件型号/名称联想 |

---

## 五、PWA特性实现

系统已实现完整的 PWA 功能：

| 特性 | 实现方式 | 文件 |
|------|----------|------|
| **离线缓存** | Service Worker (v66) | `service-worker.js` |
| **Web App Manifest** | manifest.json 配置 | `manifest.json` |
| **本地存储** | localStorage + IndexedDB | `store.js` / `rb-db.js` |
| **全局错误捕获** | `window.onerror` + `unhandledrejection` | `index.html` |
| **强制更新** | SW 版本号 + `controllerchange` 监听 | `index.html` |

### 5.1 Service Worker 更新机制

```javascript
// index.html
navigator.serviceWorker.register('service-worker.js?v=v66', {
    updateViaCache: 'none'
}).then(registration => {
    if (navigator.serviceWorker.controller) {
        // 检测到旧 SW 控制，等待新版本激活后强制刷新
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    }
});
```

### 5.2 RB_STORES 缺失保护

```javascript
// index.html - 内联回退
// 防止旧 SW 缓存导致 RB_STORES 变量丢失
if (typeof RB_STORES === 'undefined') {
    window.RB_STORES = { COLORS: 'rb_colors', ... };
}
// 全局错误捕获中检测 RB_STORES 缺失，自动硬刷新
```

---

## 六、页面状态管理

系统使用全局变量管理页面状态（`store.js`）：

```javascript
let selectedRepository = null;  // 当前选中的仓库
let selectedBox = null;         // 当前选中的盒子
let editingRepository = null;   // 正在编辑的仓库
let editingBox = null;          // 正在编辑的盒子

// localStorage 离线快照
// - 'repositories'        → 仓库列表
// - 'boxes_{repoId}'      → 某仓库的盒子列表
// - 'parts_{boxId}'       → 某盒子的零件列表
// - 'gitee_token'         → 用户自定义 Gitee Token
```

**状态切换流程**：
```
仓库管理页 → 选中仓库 → selectedRepository 赋值
    │
    ▼
点击盒子 → selectedBox 赋值 → 自动切换到零件管理页
    │
    ▼
零件管理页 → loadParts(selectedBox.id)
    │
    ▼
返回 → goBackToRepositories() → 切回仓库管理页
```

---

## 七、页面规划总结

| 维度 | 规划要点 |
|------|----------|
| **架构** | 三区域垂直布局（AA-BB-CC），标签页切换模式 |
| **导航** | 4 个核心功能模块（仓库/零件/搜索/设置） |
| **交互** | 点击选择 + 长按编辑，模态框集中处理表单 |
| **响应式** | P 单位自适应（1P=46px），移动端优先 |
| **视觉** | 乐高黄色主题，统一的卡片设计风格 |
| **PWA** | SW v66 离线缓存、强制更新机制、全局错误捕获 |
| **搜索** | 按钮（重置/搜索）位于标题右侧，搜索在最右 |
| **RB管理** | 设置页集成更新/导出 RB，启动时自动检查 |
| **扩展性** | 盒子转仓已实现；零件转盒功能入口预留（开发中） |

---

## 八、UI 函数清单（ui.js）

系统 UI 交互逻辑全部集中在 `frontend/js/ui.js`，共 81 个函数：

### 8.1 布局与导航
| 函数 | 功能 |
|------|------|
| `calculateP()` | 计算 P 单位（基于 DPI） |
| `switchTab(tabName, btn)` | 切换标签页 |
| `goBackToRepositories()` | 返回仓库管理页 |
| `showToast(msg)` | 轻量提示（滑动切换盒子时使用） |

### 8.2 仓库管理
| 函数 | 功能 |
|------|------|
| `loadRepositories()` | 加载仓库列表（含自动去重清理） |
| `selectRepository(repo)` | 选中仓库 |
| `startEditRepository` / `saveRepositoryName` | 仓库重命名 |
| `addRepository()` | 添加仓库 |
| `deleteRepositoryConfirm(id)` | 删除仓库（带确认） |

### 8.3 盒子管理
| 函数 | 功能 |
|------|------|
| `loadBoxes(repoId)` | 加载盒子列表（含去重） |
| `startEditBox` / `saveBoxName` | 盒子重命名 |
| `addBox()` | 添加盒子 |
| `deleteBoxConfirm(id)` | 删除盒子（带确认） |
| `toggleBoxTransferMode()` | 切换盒子转仓模式 |
| `toggleTransferBoxSelection(box, card)` | 勾选/取消转仓盒子 |
| `showTransferTargetPicker()` | 显示目标仓库选择器 |
| `performBoxTransfer()` | 执行盒子转仓（处理 ID 冲突重新编号） |

### 8.4 零件管理
| 函数 | 功能 |
|------|------|
| `loadParts(boxId)` | 加载零件列表 |
| `setupLongPress(element, callback)` | 长按事件绑定 |
| `showAddPartSheet()` | 显示添加零件面板 |
| `initAddPartSuggestions()` | 初始化联想输入 |
| `togglePartNewStatus(isNew)` | 切换新旧状态 |
| `saveNewPart(button)` | 保存新零件（含重复检测与合并对话框） |
| `showPartDetail(part)` | 显示零件详情（含 +/- 数量编辑、删除、合并、图片管理） |
| `deletePartConfirm` / `executeDeletePart` | 删除零件（密码验证） |
| `showMergePartSelector(currentPart)` | 合并相同零件 |
| `searchFromDetail(partNum, colorId, partName)` | 从详情跳转搜索 |

### 8.5 称重计算
| 函数 | 功能 |
|------|------|
| `showWeightCalculator()` | 显示称重计算器 |
| `fetchPartWeightForCalculator()` | 从 Bricklink 查询零件重量（离线/缓存/在线） |
| `calculateWeightQuantity()` | 根据总重量计算数量并填入 |

### 8.6 选择器
| 函数 | 功能 |
|------|------|
| `showPartSelector()` | 零件型号选择器 |
| `handlePartSearch(query)` | 零件搜索 |
| `showColorPicker()` | 颜色选择器（添加零件用） |
| `loadColorGrid(partNum)` | 加载颜色网格 |
| `filterColors(searchText)` | 过滤颜色 |
| `updateColorButtonColor(colorId)` | 更新添加零件页颜色按钮 |
| `showSearchColorPicker()` | 颜色选择器（搜索页用） |
| `loadSearchColorGrid` | 搜索页颜色网格 |
| `updateColorPickButton(colorId)` | 更新搜索页颜色按钮 |

### 8.7 搜索
| 函数 | 功能 |
|------|------|
| `handleAdvancedSearch()` | 执行高级搜索 |
| `resetSearchFilters()` | 重置搜索条件 |
| `renderSearchResults(parts)` | 渲染搜索结果 |
| `clearSearchResults()` | 清空搜索结果 |
| `updateSearchResultQuantity(partId, quantity)` | 更新搜索结果数量 |

### 8.8 零件图片管理
| 函数 | 功能 |
|------|------|
| `changePartImage(partNum, colorId)` | 变更零件图片 |
| `addCustomImage(partNum, colorId)` | 添加自定义图片（URL/本地上传） |
| `saveImageFromUrl(partNum, colorId)` | 从 URL 保存图片 |
| `uploadLocalImage(partNum, colorId)` | 本地上传图片 |
| `manageCustomImage(partNum, colorId)` | 管理自定义图片 |
| `changeCustomImage(partNum, colorId)` | 更换自定义图片 |
| `removeCustomImage(partNum, colorId)` | 移除自定义图片 |
| `deletePartDetailImage(partNum, colorId)` | 删除详情图片（离线缓存 + Gitee） |
| `refreshPartDetailWithCustomImage(partNum, colorId)` | 刷新详情自定义图片 |

### 8.9 左右滑动切换盒子
| 函数 | 功能 |
|------|------|
| `getSortedBoxes()` | 获取排序去重后的盒子列表 |
| `updateBoxSequence()` | 更新盒子序号显示 |
| `switchBox(direction)` | 切换上一个/下一个盒子 |
| `initPartsSwipeGesture()` | 初始化零件页滑动手势 |

### 8.10 CSV 导入
| 函数 | 功能 |
|------|------|
| `showCSVImporter()` | 显示 CSV 导入器 |
| `downloadCSVTemplate()` | 下载 CSV 模板 |
| `parseCSVContent` / `parseCSVLine` | 解析 CSV |
| `processCSVFile(file)` | 处理 CSV 文件 |
| `showImportConfirmation(data)` | 显示导入确认表（含重复检测） |
| `setImportAction(idx, action)` | 设置合并/新增操作 |
| `getColorBrightness(hex)` | 计算颜色亮度（用于文字颜色） |
| `confirmCSVImport()` / `doConfirmCSVImport()` | 确认导入 |

### 8.11 系统设置与 RB 管理
| 函数 | 功能 |
|------|------|
| `initializeApp()` | 应用初始化入口 |
| `loadRBOnStartup()` | 启动时检查 RB 数据 |
| `showRBStatusHint(status)` | 显示 RB 状态 |
| `initializeDatabase()` | 初始化数据库 |
| `backupData()` | 数据备份 |
| `restoreData()` | 数据恢复 |
| `updateRB()` | 更新 RB 数据 |
| `exportRB()` | 导出 RB 数据 |
| `clearCache()` | 清除缓存 |
| `reloadApp()` | 重启应用 |
| `loadStats()` | 加载统计信息 |

---

当前页面规划已完成核心功能实现，四个标签页（仓库管理、零件管理、零件搜索、系统设置）均已可用。盒子转仓、左右滑动切换盒子、称重计算、合并零件、零件图片管理、CSV 重复检测与合并导入等高级功能均已实现。仅"零件转盒"功能入口仍为开发中（alert 提示）。
