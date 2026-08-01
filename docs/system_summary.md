# 乐高零件管理系统 - 系统架构总结

## 一、系统概述

这是一个基于 **PWA + 混合存储** 的乐高零件管理系统，专为 **iPhone/iPad** 终端优化。系统采用 **Supabase 云数据库 + 本地 IndexedDB** 双存储设计：

- **动态数据**（仓库、盒子、零件库存）存储在 **Supabase PostgreSQL**，前端通过 **原生 fetch 直连 REST API**
- **静态数据**（Rebrickable 零件基础信息 6 张表）缓存在本地 **IndexedDB**（`RB_Database`），支持离线查询
- **辅助后端**（FastAPI + CloudBase 云托管）负责数据库备份/恢复/序列重置等运维任务
- **静态资源**（颜色/零件 JSON、零件图片）托管在 **Gitee** 仓库

**系统版本**：3.0.0 (Supabase版)
**开发者**：LEGOPing
**GitHub 仓库**：https://github.com/LEGOPing/Parts-backend
**前端访问地址**：https://legoping.github.io/Parts-backend/
**后端服务地址**：https://parts-backend-1257419788.ap-shanghai.run.tcloudbase.com
**终端支持**：iPhone / iPad (iOS 15+)
**Gitee Token**：5e8fe75044a023e2c992c1b5d11c95f0（用于访问私有 parts-rb 仓库）

### 1.1 设计理念

| 数据类型 | 存储位置 | 数据来源 | 原因 |
|---------|---------|---------|------|
| 仓库/盒子/零件库存 | Supabase PostgreSQL | 用户录入 | 多设备同步、数据安全 |
| Rebrickable 基础信息(6表) | IndexedDB (`RB_Database`) | Gitee parts-rb 仓库 (CSV) | 离线查询、数据量大 |
| 颜色定义 (前端用) | 内存缓存 + Gitee JSON | Gitee Parts-json 仓库 | 轻量、带1小时缓存 |
| 零件目录 (前端用) | 内存 + Gitee JSON | Gitee Parts-json 仓库 | 轻量、按需加载 |
| 零件图片 | Gitee Parts-img 仓库 | Rebrickable 图片 | CDN 加速 |
| 数据库备份 | 腾讯云 COS + Gitee Parts-backup | FastAPI 定时任务 | 灾难恢复 |

---

## 二、架构设计

### 2.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | HTML5 + CSS3 + 原生 JavaScript | PWA 单页应用，无构建依赖 |
| **云端数据库** | Supabase PostgreSQL | 动态数据存储（仓库/盒子/零件库存/颜色） |
| **前端数据访问** | 原生 fetch → Supabase REST API | 直连，不依赖 Supabase JS SDK |
| **本地数据库** | 原生 IndexedDB API | Rebrickable 静态数据缓存（无 Dexie.js） |
| **辅助后端** | Python FastAPI + SQLAlchemy | 备份/恢复/序列重置等运维接口 |
| **后端托管** | CloudBase 云托管 (Docker) | 容器化部署，按需缩容 |
| **静态资源** | Gitee 仓库 (raw/API) | 颜色/零件 JSON、零件图片、RB CSV |
| **PWA框架** | Service Worker + Web App Manifest | 离线缓存与应用壳 |

### 2.2 无外部 CDN 依赖

前端不引入任何第三方 JS 库（无 Supabase JS SDK、无 Dexie.js），全部使用浏览器原生 API：

- `fetch` → 直连 Supabase REST API
- `indexedDB` → 原生 IndexedDB 操作 RB_Database
- `localStorage` → 缓存当前选中状态与数据快照
- `caches` (Cache Storage) → Service Worker 静态资源缓存

### 2.3 数据分层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    iPhone / iPad (iOS 15+)                          │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
               ┌─────────────┴─────────────┐
               ▼                           ▼
    ┌───────────────────────┐    ┌───────────────────────┐
    │    动态数据层           │    │    静态数据层           │
    │   (Supabase REST)     │    │   (本地 IndexedDB)     │
    │                       │    │                       │
    │  repositories         │    │  RB_Database (6表)     │
    │  - id, name           │    │  - rb_colors           │
    │                       │    │  - rb_parts            │
    │  boxes                │    │  - rb_part_categories  │
    │  - id, box_number     │    │  - rb_elements         │
    │  - name, repository_id│    │  - rb_inventory_parts  │
    │                       │    │  - rb_part_relationships│
    │  parts                │    │                       │
    │  - id, part_num, name │    │  原生 IndexedDB API    │
    │  - color_id, is_new   │    │  (rb-db.js)           │
    │  - quantity, box_id   │    │                       │
    │                       │    │                       │
    │  colors               │    │                       │
    │  - id, color_name     │    │                       │
    │  - rgb, bricklink_id  │    │                       │
    └──────────┬───────────┘    └──────────┬───────────┘
               │                            │
               │  fetch (REST)              │  IndexedDB
               └────────────┬───────────────┘
                            │
                     ┌──────▼──────┐
                     │   api.js    │ ← Supabase REST 封装
                     │   rb-db.js  │ ← IndexedDB 封装
                     │   store.js  │ ← 状态管理 + localStorage
                     └──────┬──────┘
                            │
                     ┌──────▼──────┐
                     │   ui.js     │ ← UI 交互 (56个函数)
                     └─────────────┘
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
    ┌───────────────────────┐    ┌───────────────────────┐
    │  Gitee 静态资源        │    │  FastAPI 辅助后端      │
    │  - Parts-json (JSON)  │    │  (CloudBase 云托管)    │
    │  - Parts-img  (图片)  │    │  - 备份/恢复           │
    │  - parts-rb   (CSV)   │    │  - 序列重置           │
    └───────────────────────┘    └───────────────────────┘
```

### 2.4 动态数据流向（Supabase）

#### 读写操作（需网络）
```
用户操作 (创建仓库/添加零件等)
    │
    ▼
ui.js → api.js
    │
    ▼
fetch → Supabase REST API (/rest/v1/{table})
    │
    ├── GET    → 查询 (select + filters + order)
    ├── POST   → 新增 (return=representation)
    ├── PATCH  → 更新 (filters: id=eq.xxx)
    └── DELETE → 删除 (filters: id=eq.xxx)
    │
    ▼
返回 JSON → 渲染 UI
    │
    ▼
(可选) localStorage 缓存快照 (syncData)
```

#### 请求封装核心
```javascript
// api.js - 统一请求封装
async function supabaseRequest(table, options = {}) {
    let url = `${API_BASE}/${table}`;
    const queryParams = [];
    if (options.select) queryParams.push(`select=${...}`);
    if (options.filters) { /* id=eq.xxx */ }
    if (options.order) queryParams.push(`order=${...}`);
    // ...
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: supabaseHeaders(options.headers),  // apikey + Authorization
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    return await response.json();
}
```

### 2.5 静态数据流向（Rebrickable）

#### RB 数据初始化
```
应用首次启动 / 用户点击"更新RB"
    │
    ▼
检查本地 RB_Database 是否有数据 (hasLocalRBData)
    │
    ├── 有数据 → 直接使用
    └── 无数据 → 从 Gitee parts-rb 下载 CSV
                │
                ▼
            fetchRBFile (Gitee API + Token, base64 解码)
                │
                ▼
            parseRBCSV (自定义 CSV 解析)
                │
                ▼
            convertRBData (按 schema 转换数值/布尔类型)
                │
                ▼
            importRBData → clearStore + batchInsertChunks (5000条/批)
                │
                ▼
            写入 IndexedDB RB_Database (6张表)
                │
                ▼
            (可选) 导出 rb_database.json 到 Parts-json 仓库备份
```

#### RB 数据查询（离线可用）
```
用户添加零件时搜索型号/名称
    │
    ▼
ui.js → rb-db.js
    │
    ├── searchPartsByNumber(partNum)  → 查 rb_parts
    ├── getPartNameSuggestions(text)  → 智能分词匹配 rb_parts.name
    ├── getPartImageUrl(partNum, colorId) → 查 rb_inventory_parts
    ├── getColorById(colorId)         → 查 rb_colors
    └── getPartColorCount(partNum)    → 统计 rb_elements
    │
    ▼
从本地 IndexedDB 读取 (完全离线)
    │
    ▼
渲染 UI (零件选择器/颜色选择器)
```

### 2.6 离线行为说明

| 功能 | 在线时 | 离线时 | 说明 |
|------|--------|--------|------|
| 浏览 Rebrickable 零件库 | ✅ | ✅ | 从本地 IndexedDB 读取 |
| 添加零件时的型号/名称联想 | ✅ | ✅ | 基于 rb_parts 本地搜索 |
| 添加零件时的颜色选择 | ✅ | ✅ | 基于 rb_colors / rb_elements 本地查询 |
| 零件图片显示 | ✅ | ⚠️ | 在线从 Gitee 加载，已访问过的被 SW 缓存 |
| 查看仓库/盒子/零件库存 | ✅ | ⚠️ | 显示 localStorage 缓存快照 |
| 创建/编辑/删除动态数据 | ✅ | ❌ | 需联网调用 Supabase |
| 搜索零件库存 | ✅ | ❌ | 需联网查询 Supabase parts 表 |
| 统计信息 | ✅ | ❌ | 需联网聚合查询 |

**离线模式行为**：
- Service Worker 缓存应用壳（index.html、JS、CSS、图标），保证离线可打开
- RB 基础数据完全离线可用（IndexedDB）
- 动态数据操作需联网，离线时无法写入

> 注：当前版本未实现离线写入队列（pending_ops），离线时动态数据操作会失败。

### 2.7 Service Worker 缓存策略

```javascript
// frontend/service-worker.js (v66)
const CACHE_NAME = 'lego-parts-v66';

// 缓存策略：
// 1. JS/CSS 文件 → 网络优先 (network-first)，确保更新及时
// 2. 静态资源 (图片/图标) → 缓存优先 (cache-first)
// 3. Supabase API / Gitee API → 仅网络 (network-only)，不缓存
// 4. POST/PATCH/DELETE → 仅网络

// 预缓存资源：
ASSETS_TO_CACHE = [
    './', './index.html', './manifest.json',
    './icons/icon-192x192.png', './icons/icon-512x512.png',
    './icons/LOGO.JPEG',
    './icons/blue2.png', './icons/orange2.png',
    './icons/green2.png', './icons/red2.png'
];

// SW 更新机制：skipWaiting + clients.claim，配合 index.html 中的
// controllerchange 监听强制刷新页面
```

---

## 三、数据库设计

### 3.1 Supabase 动态数据表

> 建表脚本：`init_supabase.sql`（无 RLS、无 user_id、无认证）

#### repositories（仓库表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键，自增 |
| name | VARCHAR(255) NOT NULL | 仓库名称 |

#### boxes（盒子表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键，自增 |
| box_number | INTEGER NOT NULL | 盒子编号 |
| name | VARCHAR(255) NOT NULL | 盒子名称 |
| repository_id | INTEGER REFERENCES repositories(id) ON DELETE CASCADE | 所属仓库 |

#### parts（零件库存表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键，自增 |
| part_num | VARCHAR(100) NOT NULL | 零件型号 (如 3001) |
| name | VARCHAR(255) NOT NULL | 零件名称 |
| color_id | INTEGER NOT NULL | 颜色 ID |
| is_new | BOOLEAN DEFAULT FALSE | 是否为新零件 |
| quantity | INTEGER DEFAULT 0 | 库存数量 |
| box_id | INTEGER REFERENCES boxes(id) ON DELETE CASCADE | 所属盒子 |

#### colors（颜色表，Supabase 内置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键，自增 |
| color_name | VARCHAR(255) NOT NULL | 颜色名称 |
| rgb | VARCHAR(20) | RGB 颜色值 |
| bricklink_id | INTEGER | BrickLink 颜色 ID |

> 注：Supabase 的 colors 表预置 15 种常见颜色（红/蓝/绿/黄/白/黑/灰/深灰/棕/粉/橙/紫/青/金/银）。前端实际颜色查询优先走 Gitee 的 colors.json。

### 3.2 Supabase 索引

```sql
-- repositories
CREATE INDEX idx_repositories_name ON repositories(name);

-- boxes
CREATE INDEX idx_boxes_box_number ON boxes(box_number);
CREATE INDEX idx_boxes_name ON boxes(name);
CREATE INDEX idx_boxes_repository_id ON boxes(repository_id);

-- parts
CREATE INDEX idx_parts_part_num ON parts(part_num);
CREATE INDEX idx_parts_name ON parts(name);
CREATE INDEX idx_parts_color_id ON parts(color_id);
CREATE INDEX idx_parts_box_id ON parts(box_id);

-- colors
CREATE INDEX idx_colors_color_name ON colors(color_name);
```

### 3.3 本地 IndexedDB - RB_Database

数据库名称：`RB_Database`
版本号：`1`
数据来源：Gitee parts-rb 仓库（6 个 CSV 文件，需 Token 访问）

| Object Store | 主键 | 对应 CSV | 说明 |
|--------------|------|---------|------|
| rb_colors | `id` | colors.csv | Rebrickable 颜色数据 |
| rb_parts | `part_num` | parts.csv | Rebrickable 零件基础数据 |
| rb_part_categories | `id` | part_categories.csv | 零件类别 |
| rb_elements | `element_id` | elements.csv | 元素数据（零件+颜色组合） |
| rb_inventory_parts | 自增 | inventory_parts.csv | 库存零件（含图片URL） |
| rb_part_relationships | 自增 | part_relationships.csv | 零件关系 |

#### RB 数据类型 Schema（类型转换）

```javascript
// api.js - RB_SCHEMAS 定义每个表的数值/布尔字段
const RB_SCHEMAS = {
    colors:         { numeric: ['id','num_parts','num_sets','y1','y2'], boolean: ['is_trans'] },
    parts:          { numeric: ['part_cat_id'], string: ['part_num','name','part_material'] },
    part_categories:{ numeric: ['id'], string: ['name'] },
    elements:       { numeric: ['element_id','color_id','design_id'], string: ['part_num'] },
    inventory_parts:{ numeric: ['inventory_id','color_id','quantity'], boolean: ['is_spare'], string: ['part_num','img_url'] },
    part_relationships: { string: ['rel_type','child_part_num','parent_part_num'] }
};
```

#### 管理方式
- 应用启动时 `checkRBDatabase()` 检查本地是否有数据
- 无数据时提示用户点击"更新RB"
- "更新RB"按钮：从 Gitee parts-rb 下载 CSV → 解析 → 类型转换 → 分批写入（5000条/批）
- "导出RB"按钮：导出为 `rb_database.json` 并上传到 Gitee Parts-json 仓库备份
- 大文件解码使用 `TextDecoder` 替代 `escape+decodeURIComponent`，提升 14MB+ 文件解码性能

### 3.4 网络兼容性说明

| 项目 | v2.0 (CloudBase) | v3.0 (Supabase REST) |
|------|------------------|---------------------|
| 协议 | HTTPS (云函数) | HTTPS REST API |
| IPv4 支持 | ✅ | ✅ |
| IPv6 支持 | ✅ | ✅ |
| 认证 | 云函数鉴权 | apikey + anonKey (无用户认证) |
| 网络要求 | 任何网络均可 | 任何网络均可 |

---

## 四、数据操作接口

### 4.1 动态数据接口（前端 → Supabase REST）

> 封装在 `frontend/js/api.js`

#### 仓库操作
| 方法 | 说明 |
|------|------|
| `getRepositories()` | 获取所有仓库（按 id 排序） |
| `getRepositoryById(repoId)` | 按 ID 获取仓库 |
| `createRepository(name, id?)` | 创建仓库（可指定 id） |
| `updateRepository(repoId, data)` | 更新仓库名称 |
| `deleteRepository(repoId)` | 删除仓库（级联删除盒子与零件） |

#### 盒子操作
| 方法 | 说明 |
|------|------|
| `getBoxes(repoId)` | 获取仓库下的盒子（按 box_number 排序） |
| `getBoxById(boxId)` | 按 ID 获取盒子 |
| `createBox(repositoryId, boxNumber, name)` | 创建盒子 |
| `updateBox(boxId, data)` | 更新盒子信息 |
| `deleteBox(boxId)` | 删除盒子（级联删除零件） |

#### 零件库存操作
| 方法 | 说明 |
|------|------|
| `getParts(boxId)` | 获取盒子下的零件（按 part_num 排序） |
| `getPartById(partId)` | 按 ID 获取零件 |
| `createPart(data)` | 添加零件记录 |
| `updatePart(partId, data)` | 更新零件信息 |
| `deletePart(partId)` | 删除零件记录 |
| `batchCreateParts(partsData)` | 批量添加零件 |
| `searchParts(params)` | 搜索零件（color_id/is_new 精确 + part_num/name 模糊） |
| `advancedSearchParts(params)` | 高级搜索（同上） |
| `getStats()` | 统计：仓库数/盒子数/零件种类/零件总数 |

#### 颜色/零件目录（Gitee JSON）
| 方法 | 说明 |
|------|------|
| `fetchJSONFile(fileName)` | 从 Gitee Parts-json 加载 JSON |
| `fetchAllColors()` | 获取颜色定义（1小时内存缓存） |
| `getColorName(colorId)` / `getColorInfo(colorId)` | 查询颜色信息 |
| `getPartInfo(partNum)` | 从 parts.json 查询零件信息 |
| `getPartSuggestions(query)` | 零件型号/名称联想 |

#### RB 数据云备份（Gitee Parts-json）
| 方法 | 说明 |
|------|------|
| `checkRBDatabaseOnCloud()` | 检查 Parts-json 是否存在 rb_database.json |
| `downloadRBDatabaseFromCloud()` | 下载云端 RB 备份 |
| `uploadRBDatabaseToCloud(jsonData, token)` | 上传 RB 备份（新建） |
| `updateRBDatabaseOnCloud(jsonData, sha, token)` | 更新 RB 备份（需 sha） |

### 4.2 静态数据接口（本地 IndexedDB）

> 封装在 `frontend/js/rb-db.js`

#### 数据库基础操作
| 方法 | 说明 |
|------|------|
| `openRBDatabase()` | 打开/初始化 RB_Database |
| `clearStore(storeName)` | 清空指定表 |
| `batchInsertChunks(storeName, data, chunkSize=5000)` | 分批插入 |
| `getAll(storeName)` | 获取全表数据 |
| `getByKey(storeName, key)` | 按主键查询 |
| `countRecords(storeName)` | 统计记录数 |

#### RB 查询功能
| 方法 | 说明 |
|------|------|
| `getPartByNum(partNum)` | 按型号查询零件 |
| `getPartColors(partNum)` | 查询零件可用颜色 |
| `getInventoryByPart(partNum)` | 查询零件库存记录 |
| `getColorById(colorId)` | 按 ID 查询颜色 |
| `getAllColors()` | 获取所有颜色 |
| `getCategoryById(categoryId)` | 按 ID 查询类别 |
| `searchPartsInRB(query, limit=20)` | 搜索零件（型号或名称） |
| `getPartRelationships(partNum)` | 查询零件关系 |
| `getPartImageUrl(partNum, colorId)` | 查询零件图片 URL |
| `getPartColorCount(partNum)` | 统计零件可用颜色数 |

#### RB 智能联想
| 方法 | 说明 |
|------|------|
| `getAllPartNames()` | 获取所有零件名称（带缓存） |
| `searchPartsByNumber(query, limit=30)` | 按型号联想 |
| `getPartNameSuggestions(text, wordIndex, prevWords, limit=30)` | 智能分词名称联想 |
| `matchPartNumberFromName(partName)` | 由名称反查型号 |
| `smartTokenize(text)` | 智能分词（处理 "数字 x 数字" 格式） |

#### RB 导入导出
| 方法 | 说明 |
|------|------|
| `importRBData(storeName, data, onProgress)` | 导入单表数据 |
| `importRBDatabaseFromJSON(jsonData, onProgress)` | 从 JSON 批量导入全部 6 表 |
| `exportRBDatabaseToJSON()` | 导出全部 6 表为 JSON |
| `checkRBDatabase()` | 检查数据库状态与统计 |
| `hasLocalRBData()` | 判断本地是否有数据 |
| `getRBStats()` | 获取各表记录数 |

### 4.3 辅助后端接口（FastAPI → CloudBase）

> 后端地址：`https://parts-backend-1257419788.ap-shanghai.run.tcloudbase.com`

#### 仓库管理 `/api/repositories`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/repositories/` | 创建仓库 |
| GET | `/api/repositories/` | 获取所有仓库 |
| GET | `/api/repositories/{id}` | 获取单个仓库 |
| PUT | `/api/repositories/{id}` | 更新仓库 |
| DELETE | `/api/repositories/{id}` | 删除仓库 |

#### 盒子管理 `/api/boxes`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/boxes/` | 创建盒子 |
| GET | `/api/boxes/?repository_id=` | 获取盒子列表 |
| GET/PUT/DELETE | `/api/boxes/{id}` | 单盒子操作 |

#### 零件管理 `/api/parts`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/parts/` | 创建零件 |
| GET | `/api/parts/?box_id=` | 获取零件列表 |
| POST | `/api/parts/batch` | 批量创建零件 |
| GET/PUT/DELETE | `/api/parts/{id}` | 单零件操作 |

#### 搜索 `/api/search`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/search/?part_num=&name=&color_id=` | 搜索零件 |
| GET | `/api/search/suggestions?query=` | 联想建议 |

#### 系统设置 `/api/settings`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/settings/backup` | 手动备份（COS + Gitee） |
| GET | `/api/settings/backup/{file}` | 下载备份文件 |
| POST | `/api/settings/restore/{file}` | 恢复数据库 |
| POST | `/api/settings/init` | 初始化表结构 |
| POST | `/api/settings/reset-sequences` | 重置自增序列（前端删除后调用） |

> 注：前端日常 CRUD 直连 Supabase REST API，不经过 FastAPI。FastAPI 仅用于运维操作（备份/恢复/序列重置）。

---

## 五、项目结构

```
PWA-PY/
├── frontend/                         # 前端静态文件 (GitHub Pages 部署)
│   ├── index.html                    # 主页面 (v3.0.0)
│   ├── manifest.json                 # PWA 配置
│   ├── service-worker.js             # Service Worker (v66)
│   ├── FORCE_UPDATE                  # 强制更新标记
│   ├── css/
│   │   └── style.css                 # 样式文件 (P单位: 1P=46px)
│   ├── js/
│   │   ├── api.js                    # Supabase REST + Gitee 封装
│   │   ├── store.js                  # 状态管理 + localStorage
│   │   ├── rb-db.js                  # IndexedDB RB_Database 封装
│   │   └── ui.js                     # UI 交互逻辑 (56个函数)
│   └── icons/                        # PWA 图标 + 导航按钮背景图
│
├── app/                              # FastAPI 后端 (CloudBase 云托管)
│   ├── database.py                   # SQLAlchemy 引擎 (SQLite/PostgreSQL)
│   ├── backup.py                     # 备份逻辑 (COS + Gitee + pg_dump)
│   ├── models/                       # ORM 模型
│   │   ├── repository.py
│   │   ├── box.py
│   │   └── part.py
│   ├── routes/                       # API 路由
│   │   ├── repositories.py
│   │   ├── boxes.py
│   │   ├── parts.py
│   │   ├── search.py
│   │   └── settings.py
│   └── schemas/                      # Pydantic 模型
│
├── docs/                             # 文档
│   ├── system_summary.md             # 本文档
│   └── page_summary.md               # 页面规划文档
│
├── RB/                               # Rebrickable CSV 源文件 (本地副本)
│   ├── colors.csv
│   ├── elements.csv
│   ├── inventory_parts.csv
│   ├── part_categories.csv
│   ├── part_relationships.csv
│   └── parts.csv
│
├── main.py                           # FastAPI 入口
├── Dockerfile                        # Docker 构建文件 (python:3.11-slim)
├── docker-compose.yml                # 本地 Docker Compose
├── cloudbaserc.json                  # CloudBase 云托管配置
├── requirements.txt                  # Python 依赖
├── init_supabase.sql                 # Supabase 建表脚本
├── .env                              # 环境变量 (DATABASE_URL)
├── .github/workflows/
│   └── deploy-frontend.yml           # GitHub Actions 自动部署前端
└── README.md
```

### 5.1 核心文件说明

| 文件 | 功能 |
|------|------|
| `api.js` | Supabase REST 封装 + Gitee JSON/CSV 获取 + RB 云备份 |
| `rb-db.js` | 原生 IndexedDB 封装 RB_Database，提供查询/联想/导入导出 |
| `store.js` | 全局状态管理（selectedRepository/Box）+ localStorage 缓存 |
| `ui.js` | 全部 UI 交互逻辑（56 个函数），含模态框、CSV 导入、长按编辑等 |
| `service-worker.js` | PWA 离线缓存（网络优先 JS/CSS，缓存优先静态资源） |
| `main.py` | FastAPI 入口，CORS + 路由注册 + APScheduler 每日备份 |
| `app/backup.py` | SQLite/PostgreSQL 备份 + COS 上传 + Gitee 推送 |
| `init_supabase.sql` | Supabase 建表 + 索引 + 15 种预置颜色 |

### 5.2 store.js 状态管理

```javascript
// store.js - 简单的全局状态管理
let selectedRepository = null;  // 当前选中的仓库
let selectedBox = null;         // 当前选中的盒子
let editingRepository = null;   // 正在编辑的仓库
let editingBox = null;          // 正在编辑的盒子

// localStorage 缓存（syncData 时写入）
// - 'repositories'          → 仓库列表快照
// - 'boxes_{repoId}'        → 盒子列表快照
// - 'parts_{boxId}'         → 零件列表快照
```

> 注：当前 store.js 不是数据路由层，仅做状态保持与 localStorage 离线快照。

---

## 六、部署流程

### 6.1 前端部署（GitHub Pages）
1. 代码提交到 GitHub `Parts-backend` 仓库 `main` 分支
2. GitHub Actions (`deploy-frontend.yml`) 触发
3. 使用 `JamesIves/github-pages-deploy-action@v4` 将 `frontend/` 目录部署到 `gh-pages` 分支
4. 访问地址：https://legoping.github.io/Parts-backend/

### 6.2 后端部署（CloudBase 云托管）
1. 后端代码在仓库根目录（构建目录为空，使用仓库根）
2. `Dockerfile` 基于 `python:3.11-slim`，pip 使用清华镜像源
3. `cloudbaserc.json` 配置 CloudBase 服务：
   - envId: `legopart-d3gyvl7hw36084032`
   - serviceName: `parts-backend`
   - CPU: 1核 / 内存: 256MB / 缩容到 0
   - 端口: 8000
4. 环境变量通过 CloudBase 控制台配置（DATA_DIR / DATABASE_URL / COS 配置）
5. 服务地址：https://parts-backend-1257419788.ap-shanghai.run.tcloudbase.com

### 6.3 Supabase 配置
1. 在 Supabase 控制台执行 `init_supabase.sql` 建表
2. 在 `api.js` 中配置：
   ```javascript
   const SUPABASE_URL = 'https://tfxydlkpxkdpxyoqrkez.supabase.co';
   const SUPABASE_ANON_KEY = 'sb_publishable_EPZpWFRObklmwpfXerINvQ_S-OeeIM_';
   const API_BASE = `${SUPABASE_URL}/rest/v1`;
   ```
3. 数据库连接（后端用）：`postgresql://postgres:Legopart%402026@db.tfxydlkpxkdpxyoqrkez.supabase.co:5432/postgres`

### 6.4 Gitee 仓库配置

| 仓库 | 用途 | 访问方式 |
|------|------|---------|
| `Parts-backend` (GitHub) | 前端源码 + 后端代码 | 公开 |
| `Parts-json` (Gitee) | colors.json / parts.json / rb_database.json 备份 | 公开 raw |
| `Parts-img` (Gitee) | 零件图片 | 公开 raw |
| `parts-rb` (Gitee) | Rebrickable 6 个 CSV 文件 | 私有 (需 Token) |
| `Parts-backup` (Gitee) | 数据库备份文件 | SSH 推送 |

### 6.5 iOS 安装流程
1. 在 iPhone/iPad 上用 Safari 打开 PWA 地址
2. 点击"分享"按钮 → "添加到主屏幕"
3. 首次启动：
   - 自动加载应用壳（SW 缓存）
   - 检查本地 RB_Database，无数据时提示"更新RB"
   - 用户点击"更新RB"从 Gitee 下载 Rebrickable 数据
4. 之后可离线浏览 Rebrickable 零件库，动态数据操作需联网

### 6.6 数据备份机制
- **定时备份**：APScheduler 每天 02:00 自动执行
  - PostgreSQL: `pg_dump` 备份（失败回退到 SQLAlchemy 方式）
  - 备份文件保留最近 5 份
- **备份上传**：腾讯云 COS + Gitee Parts-backup 仓库
- **手动备份**：设置页"数据备份"按钮 → 调用 FastAPI `/api/settings/backup`

---

## 七、关键技术决策

| 决策点 | 方案 | 原因 |
|--------|------|------|
| 动态数据存储 | Supabase PostgreSQL | 免费、多设备同步、REST API 直连 |
| 前端数据访问 | 原生 fetch → Supabase REST | 无 SDK 依赖、包体小、IPv4/IPv6 通用 |
| 静态数据缓存 | 原生 IndexedDB | 无 Dexie.js 依赖、iOS 原生支持 |
| RB 数据来源 | Gitee parts-rb (CSV) | 私有仓库 Token 访问、数据量大 |
| 辅助后端 | FastAPI + CloudBase 云托管 | 仅用于备份/恢复，按需缩容到 0 |
| 用户认证 | 无（anonKey 直连） | 个人单用户场景，简化使用 |
| 应用框架 | 原生 JavaScript | 无构建依赖、直接部署 |
| 前端托管 | GitHub Pages | 免费、CDN 加速、Actions 自动部署 |
| 图片托管 | Gitee Parts-img | 国内访问快 |
| 备份策略 | COS + Gitee 双备份 | 灾难恢复、异地冗余 |

### 7.1 为什么前端直连 Supabase REST（而非 JS SDK）

| 对比项 | Supabase JS SDK | 原生 fetch REST |
|--------|----------------|----------------|
| 包体积 | ~300KB (CDN) | 0 |
| 网络兼容 | HTTPS | HTTPS |
| 灵活性 | SDK 封装 | 完全可控 |
| 依赖 | 需 CDN 加载 | 无依赖 |
| 离线缓存 | 需缓存 SDK 文件 | 仅缓存自有 JS |

### 7.2 为什么保留 FastAPI 后端

前端直连 Supabase 已满足日常 CRUD，但以下场景需后端：
- **数据库备份**：需 `pg_dump` 或 SQLAlchemy 全表导出
- **备份文件管理**：上传 COS / 推送 Gitee
- **序列重置**：删除数据后重置 PostgreSQL 自增序列
- **定时任务**：APScheduler 每日自动备份

---

## 八、静态数据管理

### 8.1 Gitee JSON 数据格式

```json
// colors.json (Parts-json 仓库)
[
  { "id": 1, "name": "Black", "rgb": "#1a1a1a", "name_en": "Black" }
]
```

```json
// parts.json (Parts-json 仓库)
[
  { "part_num": "3001", "name": "Brick 2x4", "image_url": "..." }
]
```

### 8.2 RB CSV 数据格式

```
# parts.csv (parts-rb 仓库)
part_num,name,part_cat_id,part_material
3001,Brick 2x4,1,Plastic
```

CSV 解析采用自定义 `parseRBCSVLine`（支持引号转义），解析后按 `RB_SCHEMAS` 进行类型转换（数值/布尔/字符串）。

### 8.3 RB 数据刷新机制

```
应用启动 (loadRBOnStartup)
    │
    ▼
检查本地 RB_Database (hasLocalRBData)
    │
    ├── 有数据 → 显示状态提示，直接使用
    └── 无数据 → 显示"请点击更新RB"
                │
                ▼
            用户点击"更新RB"
                │
                ├── 优先尝试从 Parts-json 下载 rb_database.json (云备份)
                └── 失败则从 parts-rb 下载 6 个 CSV
                    │
                    ▼
                解析 + 类型转换 + 分批写入 IndexedDB
                    │
                    ▼
                自动导出 rb_database.json 到 Parts-json (备份)
```

### 8.4 颜色数据缓存策略

| 策略 | 说明 |
|------|------|
| 内存缓存 | `cachedColors` 变量，TTL 1 小时 (`CACHE_EXPIRY = 3600000`) |
| 数据来源 | 优先 Gitee colors.json，失败回退到内置 30 种默认颜色 |
| 名称字段 | 优先 `name_en` / `en_name` / `english_name`，兜底 `name` |

---

## 九、版本历史

| 版本 | 架构 | 说明 |
|------|------|------|
| v1.0 | Pythonista + iCloud | iOS 原生 Swift 应用 |
| v2.0 | CloudBase + GitHub Pages | 腾讯云 CloudBase 云函数后端 |
| **v3.0** | **Supabase REST + IndexedDB + FastAPI** | **当前版本：前端直连 Supabase，RB 本地缓存** |

### v3.0 核心特性
- ✅ 前端原生 fetch 直连 Supabase REST API（无 SDK 依赖）
- ✅ 原生 IndexedDB 缓存 Rebrickable 6 张表（无 Dexie.js 依赖）
- ✅ RB 数据从 Gitee parts-rb 私有仓库获取（CSV + Token）
- ✅ FastAPI 辅助后端（CloudBase 云托管，备份/恢复/序列重置）
- ✅ 智能分词零件名称联想（支持"数字 x 数字"格式）
- ✅ 零件图片从 Gitee Parts-img 加载
- ✅ Service Worker v66 离线缓存（网络优先 JS/CSS）
- ✅ 腾讯云 COS + Gitee 双备份（每日 02:00 自动）
- ✅ P 单位自适应布局（1P = 46px，基于 DPI 检测）

---

## 十、待办事项

- [x] 架构方案设计
- [x] Supabase 项目配置与建表
- [x] 前端直连 Supabase REST API (api.js)
- [x] 原生 IndexedDB 封装 RB_Database (rb-db.js)
- [x] FastAPI 辅助后端 (备份/恢复/序列重置)
- [x] Service Worker 离线缓存 (v66)
- [x] RB 数据导入/导出/云备份
- [x] 智能分词零件联想
- [x] CSV 批量导入零件
- [x] 四标签页 UI 实现（仓库/零件/搜索/设置）
- [ ] 离线写入队列（pending_ops）
- [ ] 用户认证与 RLS 数据隔离（如需多用户）
- [ ] 零件图片预缓存策略
- [ ] 性能测试与优化

---

## 附录：核心代码示例

### api.js - Supabase REST 封装

```javascript
// frontend/js/api.js
const SUPABASE_URL = 'https://tfxydlkpxkdpxyoqrkez.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EPZpWFRObklmwpfXerINvQ_S-OeeIM_';
const API_BASE = `${SUPABASE_URL}/rest/v1`;

function supabaseHeaders(extra = {}) {
    return {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...extra
    };
}

async function supabaseRequest(table, options = {}) {
    let url = `${API_BASE}/${table}`;
    const queryParams = [];
    if (options.select) queryParams.push(`select=${encodeURIComponent(options.select)}`);
    if (options.filters) {
        for (const [key, value] of Object.entries(options.filters)) {
            queryParams.push(`${key}=eq.${value}`);
        }
    }
    if (options.order) queryParams.push(`order=${encodeURIComponent(options.order)}`);
    if (queryParams.length) url += `?${queryParams.join('&')}`;

    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: supabaseHeaders(options.headers),
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}
```

### rb-db.js - IndexedDB 封装

```javascript
// frontend/js/rb-db.js
const RB_DB_NAME = 'RB_Database';
const RB_DB_VERSION = 1;

const RB_STORES = {
    COLORS: 'rb_colors',
    ELEMENTS: 'rb_elements',
    INVENTORY_PARTS: 'rb_inventory_parts',
    PART_CATEGORIES: 'rb_part_categories',
    PART_RELATIONSHIPS: 'rb_part_relationships',
    PARTS: 'rb_parts'
};

function openRBDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(RB_DB_NAME, RB_DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(RB_STORES.COLORS)) {
                db.createObjectStore(RB_STORES.COLORS, { keyPath: 'id' });
            }
            // ... 其余 5 个 store
        };
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

// 分批插入（避免大数据量崩溃）
async function batchInsertChunks(storeName, data, chunkSize = 5000) {
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await new Promise((resolve, reject) => {
            const tx = rbDbInstance.transaction(storeName, 'readwrite');
            chunk.forEach(item => tx.objectStore(storeName).add(item));
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }
}
```

### main.py - FastAPI 入口

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler

app = FastAPI(title="乐高零件管理系统", version="1.0.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# 注册路由
app.include_router(repositories.router, prefix="/api/repositories")
app.include_router(boxes.router, prefix="/api/boxes")
app.include_router(parts.router, prefix="/api/parts")
app.include_router(search.router, prefix="/api/search")
app.include_router(settings.router, prefix="/api/settings")

# APScheduler 每日 02:00 自动备份
scheduler = BackgroundScheduler()
scheduler.add_job(func=lambda: auto_backup(), trigger="cron",
    hour=2, minute=0, id="daily_backup", replace_existing=True)
scheduler.start()
```

---

## 附录：Service Worker 缓存策略

```javascript
// frontend/service-worker.js (v66)
const CACHE_NAME = 'lego-parts-v66';

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // API 请求与非 GET 请求：仅网络
    if (['POST','PATCH','DELETE'].includes(request.method) ||
        url.hostname.includes('supabase.co') ||
        url.hostname.includes('gitee.com')) {
        event.respondWith(fetch(request).catch(() => caches.match(request)));
        return;
    }

    // JS/CSS：网络优先
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        event.respondWith(
            fetch(request).then(res => {
                caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
                return res;
            }).catch(() => caches.match(request))
        );
    } else {
        // 静态资源：缓存优先
        event.respondWith(
            caches.match(request).then(cached => cached || fetch(request).then(res => {
                caches.open(CACHE_NAME).then(c => c.put(request, res.clone()));
                return res;
            }))
        );
    }
});
```

---

## 附录：文档索引

| 文档 | 路径 | 状态 |
|------|------|------|
| **当前版本文档** | `PWA-PY/docs/system_summary.md` | ✅ v3.0 Supabase版 |
| **页面规划文档** | `PWA-PY/docs/page_summary.md` | ✅ v3.0 页面规划 |
| 旧版本文档 (CloudBase) | `PWA/docs/system_summary.md` | ⚠️ v2.0 已弃用 |
| v3.0 草稿文档 | `PWA-PY/docs/system_summary_副本.md` | ⚠️ 历史草稿 |

---

## 附录：术语表

| 术语 | 说明 |
|------|------|
| PWA | Progressive Web App，渐进式 Web 应用 |
| IndexedDB | 浏览器原生 NoSQL 本地数据库 |
| Service Worker | 浏览器后台脚本，用于缓存和离线支持 |
| Cache Storage | 浏览器缓存 API |
| Supabase | 开源 Firebase 替代产品，提供数据库+认证+存储 |
| RB | Rebrickable，乐高零件数据库 |
| FastAPI | Python 现代 Web 框架 |
| CloudBase | 腾讯云开发平台（云托管） |
| COS | 腾讯云对象存储 |
| P 单位 | 自适应布局单位，1P = 46px（基于屏幕 DPI） |
