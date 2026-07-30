# 乐高零件管理系统 - 系统架构总结

## 一、系统概述

这是一个基于 **混合架构 PWA** 的乐高零件管理系统，专为 **iPhone/iPad** 终端优化。系统采用 **Supabase + IndexedDB** 双存储设计：

- **动态数据**（仓库、盒子、零件库存等用户操作数据）存储在 **Supabase 云端数据库**
- **静态数据**（零件目录、颜色定义、图片等基础信息）缓存在本地 **IndexedDB**，支持离线浏览

**系统版本**：4.1.0 (RB本地存储版)  
**开发者**：LEGOPing  
**GitHub 仓库**：https://github.com/LEGOPing/Parts-backend  
**前端访问地址**：https://legoping.github.io/Parts-backend/  
**终端支持**：iPhone / iPad (iOS 15+)
**Gitee Token**：5e8fe75044a023e2c992c1b5d11c95f0（用于访问私有 Parts-RB 仓库）

### 1.1 设计理念

| 数据类型 | 存储位置 | 原因 |
|---------|---------|------|
| 仓库/盒子/零件库存 | Supabase | 多设备同步、数据安全、实时性要求高 |
| RB零件基础信息(6表) | IndexedDB (RB_Database) | 离线使用、从Parts-RB仓库读取 |
| 零件目录(型号/名称) | IndexedDB | 基本静态、离线浏览、减少网络请求 |
| 颜色定义 | IndexedDB | 极少变化、全量缓存 |
| 零件图片 | Cache Storage | 离线显示、预加载常用图片 |

---

## 二、架构设计

### 2.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | HTML5 + CSS3 + JavaScript | PWA单页应用，纯原生JS |
| **云端数据库** | Supabase PostgreSQL | 动态数据存储（仓库/盒子/零件库存） |
| **前端SDK** | Supabase JS Client | 前端直连 Supabase（CDN引入） |
| **本地数据库** | IndexedDB + Dexie.js | 静态数据缓存（零件目录/颜色） |
| **图片缓存** | Service Worker + Cache Storage | 零件图片离线缓存 |
| **PWA框架** | Service Worker + Web App Manifest | 应用壳与离线能力 |

### 2.2 CDN 依赖引入

在 `index.html` 中引入所需的第三方库：

```html
<!-- Supabase JS Client (v2) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/supabase.min.js"></script>

<!-- Dexie.js (IndexedDB 封装) -->
<script src="https://cdn.jsdelivr.net/npm/dexie@4.0.4/dist/dexie.min.js"></script>
```

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
    │   (Supabase)          │    │   (本地 IndexedDB)     │
    │                       │    │                       │
    │  ┌─────────────────┐  │    │  ┌─────────────────┐  │
    │  │ repositories    │  │    │  │ parts_catalog  │  │
    │  │ - 仓库信息      │  │    │ │ (part_num,    │  │
    │  │ - 关联用户      │  │    │ │  name,        │  │
    │  └─────────────────┘  │    │ │  image_url)   │  │
    │                       │    │ └─────────────────┘  │
    │  ┌─────────────────┐  │    │                      │
    │  │ boxes           │  │    │  ┌─────────────────┐  │
    │  │ - 盒子编号/名称 │  │    │  │ colors         │  │
    │  │ - 所属仓库      │  │    │ │ - 颜色名称     │  │
    │  └─────────────────┘  │    │ │ - RGB值        │  │
    │                       │    │ │ - BrickLink ID │  │
    │  ┌─────────────────┐  │    │ └─────────────────┘  │
    │  │ parts           │  │    │                      │
    │  │ - part_num      │  │    │  ┌─────────────────┐  │
    │  │ - color_id      │  │    │  │ Cache Storage  │  │
    │  │ - box_id        │  │    │ │ - 零件图片     │  │
    │  │ - quantity      │  │    │ │ - 静态资源     │  │
    │  │ - is_new        │  │    │ └─────────────────┘  │
    │  └─────────────────┘  │    │                      │
    │                       │    │  Dexie.js 封装层      │
    │  Supabase SDK 封装层   │    │  (catalog_db.js)     │
    │  (api.js)            │    │                       │
    └──────────┬───────────┘    └──────────┬───────────┘
               │                            │
               │      数据服务层             │
               └────────────┬───────────────┘
                            │
                     ┌──────▼──────┐
                     │   store.js  │
                     │  (数据路由)  │
                     └─────────────┘
                            │
                     ┌──────▼──────┐
                     │   ui.js     │
                     │  (UI 交互)  │
                     └─────────────┘
```

### 2.4 动态数据流向

#### 写入操作（需要网络）
```
用户操作 (创建仓库/添加零件等)
    │
    ▼
ui.js → store.js (判断数据类型)
    │
    ▼
api.js → Supabase SDK
    │
    ▼
Supabase 云端数据库
    │
    ▼
返回结果 → 更新 UI
```

#### 读取操作（动态数据）
```
用户查看仓库/盒子列表
    │
    ▼
store.js → api.js → Supabase SDK
    │
    ▼
请求 Supabase 云端
    │
    ▼
返回数据 → 渲染 UI
    │
    ▼
(可选择) 缓存到本地
```

### 2.5 静态数据流向

#### 初始化加载
```
首次访问 PWA
    │
    ▼
Service Worker 注册
    │
    ▼
加载 parts_catalog.json (零件目录)
    │
    ▼
加载 colors.json (颜色定义)
    │
    ▼
Dexie.js 写入 IndexedDB
    │
    ▼
预缓存常用零件图片
    │
    ▼
静态数据就绪
```

#### 静态数据使用
```
用户浏览零件
    │
    ▼
store.js → catalog_db.js (本地查询)
    │
    ▼
从 IndexedDB 读取零件目录
    │
    ▼
从 Cache Storage 读取图片
    │
    ▼
渲染 UI (完全离线可用)
```

### 2.6 离线行为说明

| 功能 | 在线时 | 离线时 | 说明 |
|------|--------|--------|------|
| 浏览零件目录 | ✅ | ✅ | 从本地 IndexedDB 读取 |
| 查看零件图片 | ✅ | ✅ | 从 Cache Storage 读取 |
| 查看仓库列表 | ✅ | ⚠️ 缓存数据 | 显示上次缓存的快照 |
| 查看盒子列表 | ✅ | ⚠️ 缓存数据 | 显示上次缓存的快照 |
| 查看零件库存 | ✅ | ⚠️ 缓存数据 | 显示上次缓存的库存快照 |
| 创建仓库/盒子 | ✅ | ⚠️ 队列写入 | 保存到本地队列，在线后同步 |
| 添加/编辑零件 | ✅ | ⚠️ 队列写入 | 保存到本地队列，在线后同步 |
| 搜索零件 | ✅ | ✅ | 基于本地目录搜索 |
| 统计信息 | ✅ | ⚠️ 缓存数据 | 基于上次缓存数据计算 |

**离线模式行为**：
- 应用会检测网络状态（`navigator.onLine`）
- 动态数据页面在离线时显示"离线模式"提示
- 静态浏览功能完全可用
- 网络恢复后自动恢复完整功能

### 2.7 离线写入队列（Pending Operations）

针对网络不稳定场景，采用**离线写入队列**机制：

#### 队列表结构（IndexedDB）
```javascript
// 离线操作队列表
pending_ops: '++id, action, table, data, status, created_at'
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Number (主键) | 自增 ID |
| action | String | 操作类型：insert/update/delete |
| table | String | 目标表：repositories/boxes/parts |
| data | Object | 操作数据 |
| status | String | pending/syncing/completed/failed |
| created_at | Number | 创建时间戳 |

#### 队列处理流程
```
用户尝试写入数据
    │
    ▼
检查网络状态
    │
    ├── 在线 → 直接调用 Supabase API
    │           │
    │           ├── 成功 → 返回结果
    │           └── 失败 → 写入队列（status: failed）
    │
    └── 离线 → 写入队列（status: pending）
                │
                ▼
           显示"已保存，待同步"提示
                │
                ▼
           网络恢复后自动同步
```

#### 同步机制
```javascript
// sync.js 队列处理逻辑
async function processPendingOps() {
  const pendingOps = await db.pending_ops
    .where('status')
    .equals('pending')
    .toArray();
  
  for (const op of pendingOps) {
    try {
      await api.execute(op.table, op.action, op.data);
      await db.pending_ops.update(op.id, { status: 'completed' });
    } catch (error) {
      await db.pending_ops.update(op.id, { status: 'failed' });
    }
  }
}

// 监听网络恢复
window.addEventListener('online', async () => {
  await processPendingOps();
  showNotification('数据同步完成');
});
```

#### 用户体验
- 离线写入时显示 **"已保存，待同步"** 提示
- 设置页面显示 **待同步数量** 徽章
- 用户可手动触发同步：点击 **"立即同步"** 按钮
- 同步失败的操作显示错误图标，支持重试

---

## 三、数据库设计

### 3.1 Supabase 动态数据表

#### repositories（仓库表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键，自增 |
| name | VARCHAR(255) NOT NULL | 仓库名称 |
| user_id | UUID | 关联用户 (RLS 策略) |
| created_at | TIMESTAMPTZ DEFAULT now() | 创建时间 |

#### boxes（盒子表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键，自增 |
| box_number | INTEGER NOT NULL | 盒子编号 |
| name | VARCHAR(255) NOT NULL | 盒子名称 |
| repository_id | INTEGER REFERENCES repositories(id) ON DELETE CASCADE | 所属仓库 |
| user_id | UUID | 关联用户 |
| created_at | TIMESTAMPTZ DEFAULT now() | 创建时间 |

#### parts（零件库存表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键，自增 |
| part_num | VARCHAR(100) NOT NULL | 零件型号 (关联目录) |
| color_id | INTEGER NOT NULL | 颜色 ID (关联目录) |
| box_id | INTEGER REFERENCES boxes(id) ON DELETE CASCADE | 所属盒子 |
| quantity | INTEGER DEFAULT 0 | 库存数量 |
| is_new | BOOLEAN DEFAULT FALSE | 是否为新零件 |
| user_id | UUID | 关联用户 |
| created_at | TIMESTAMPTZ DEFAULT now() | 创建时间 |
| updated_at | TIMESTAMPTZ DEFAULT now() | 更新时间 |

### 3.2 本地 IndexedDB 静态表

#### RB 数据库（零件基础信息）

数据库名称：`RB_Database`  
版本号：`1.0`  
数据来源：Gitee Parts-RB 仓库（6个CSV文件）

| 表名 | 说明 | 对应CSV文件 |
|------|------|------------|
| rb_colors | 颜色数据 | colors.csv |
| rb_parts | 零件基础数据 | parts.csv |
| rb_part_categories | 零件类别 | part_categories.csv |
| rb_elements | 元素数据 | elements.csv |
| rb_inventory_parts | 库存零件 | inventory_parts.csv |
| rb_part_relationships | 零件关系 | part_relationships.csv |

**管理方式**：
- 系统启动时自动检查，如无则从Parts-RB读取CSV建立
- 点击"更新RB"按钮可手动更新，更新后自动导出备份到iOS文件App

#### lego_catalog_db（零件目录缓存）

数据库名称：`lego_catalog_db`  
版本号：`1.0`

#### parts_catalog（零件目录表）
| 字段 | 类型 | 说明 | 索引 |
|------|------|------|------|
| id | Number (主键) | 主键 | ✅ |
| part_num | String | 零件型号 (如 3001) | ✅ |
| name | String | 零件名称 | ✅ |
| image_url | String | 零件图片 URL | - |
| category | String | 零件分类 | ✅ |
| updated_at | Number | 最后更新时间戳 | - |

#### colors（颜色定义表）
| 字段 | 类型 | 说明 | 索引 |
|------|------|------|------|
| id | Number (主键) | 主键 | ✅ |
| color_name | String | 颜色名称 | ✅ |
| rgb | String | RGB 颜色值 | - |
| bricklink_id | Number | BrickLink 颜色 ID | - |

### 3.3 索引配置

#### Supabase 索引
```sql
-- repositories
CREATE INDEX idx_repositories_user_id ON repositories(user_id);
CREATE INDEX idx_repositories_name ON repositories(name);

-- boxes
CREATE INDEX idx_boxes_repository_id ON boxes(repository_id);
CREATE INDEX idx_boxes_user_id ON boxes(user_id);
CREATE INDEX idx_boxes_box_number ON boxes(box_number);

-- parts
CREATE INDEX idx_parts_box_id ON parts(box_id);
CREATE INDEX idx_parts_part_num ON parts(part_num);
CREATE INDEX idx_parts_color_id ON parts(color_id);
CREATE INDEX idx_parts_user_id ON parts(user_id);
```

#### Dexie.js 索引
```javascript
// parts_catalog 索引
parts_catalog: '++id, &part_num, name, category'

// colors 索引
colors: '++id, &color_name'
```

### 3.4 用户认证策略

根据使用场景选择认证方案：

#### 方案 A：匿名认证（推荐，个人单用户）
```sql
-- 简化版：允许所有请求，通过 app_id 字段隔离
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;

-- 简单策略：基于固定 app_id 隔离（可在前端硬编码）
CREATE POLICY "允许所有操作" ON repositories
  FOR ALL
  USING (true)
  WITH CHECK (true);
```
- 优点：无需登录，打开即用
- 缺点：多人共用时数据不隔离
- 适用：个人单用户场景

#### 方案 B：邮箱/手机号认证（多人使用）
```sql
-- 启用 RLS 并绑定用户 ID
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户访问自己的仓库" ON repositories
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```
- 优点：数据安全隔离
- 缺点：需要登录步骤
- 适用：多人共享使用

### 3.5 网络兼容性说明

| 项目 | v3.0 (Python直连) | v4.0 (JS SDK) |
|------|------------------|--------------|
| 协议 | PostgreSQL 直连 | HTTPS REST API |
| IPv4 支持 | ❌ 需要 IPv6 | ✅ 完全支持 |
| IPv6 支持 | ✅ | ✅ |
| 网络要求 | 需配置网络 | 任何网络均可 |

**结论**：v4.0 使用 Supabase JS SDK 通过 HTTPS 协议通信，**IPv4/IPv6 均可**，不再有 v3.0 的 IPv6 限制。

---

## 四、数据操作接口

### 4.1 动态数据接口（Supabase）

#### 仓库操作
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `api.getRepositories()` | 获取当前用户的所有仓库 |
| POST | `api.createRepository(name)` | 创建新仓库 |
| PUT | `api.updateRepository(id, name)` | 更新仓库名称 |
| DELETE | `api.deleteRepository(id)` | 删除仓库及关联数据 |

#### 盒子操作
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `api.getBoxes(repositoryId)` | 获取仓库下的盒子列表 |
| POST | `api.createBox(repositoryId, boxNumber, name)` | 创建新盒子 |
| PUT | `api.updateBox(id, data)` | 更新盒子信息 |
| DELETE | `api.deleteBox(id)` | 删除盒子及关联零件 |

#### 零件库存操作
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `api.getParts(boxId)` | 获取盒子下的零件列表 |
| POST | `api.createPart(data)` | 添加零件库存记录 |
| POST | `api.batchCreateParts(parts)` | 批量添加零件 |
| PUT | `api.updatePart(id, data)` | 更新零件信息 |
| DELETE | `api.deletePart(id)` | 删除零件记录 |

### 4.2 静态数据接口（本地 IndexedDB）

#### 零件目录操作
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `catalog.searchParts(keyword)` | 按型号/名称搜索零件 |
| GET | `catalog.getPartByNum(partNum)` | 按型号获取零件信息 |
| GET | `catalog.getPartsByCategory(category)` | 按分类获取零件列表 |
| GET | `catalog.getRecentParts(limit)` | 获取最近更新的零件 |

#### 颜色操作
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `catalog.getAllColors()` | 获取所有颜色定义 |
| GET | `catalog.getColorById(id)` | 获取指定颜色信息 |
| GET | `catalog.getColorByName(name)` | 按名称搜索颜色 |

### 4.3 缓存管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `cache.getCacheSize()` | 获取缓存占用空间 |
| POST | `cache.clearImageCache()` | 清除所有图片缓存 |
| POST | `cache.preloadImages(partNums)` | 预加载指定零件图片 |
| POST | `cache.refreshCatalog()` | 刷新零件目录数据 |

---

## 五、项目结构

```
PWA-PY/
├── frontend/                         # 前端静态文件 (GitHub Pages)
│   ├── index.html                    # 主页面
│   ├── manifest.json                 # PWA 配置
│   ├── service-worker.js             # Service Worker (离线缓存)
│   ├── css/
│   │   └── style.css                 # 样式文件
│   ├── js/
│   │   ├── app.js                    # 应用入口 + 初始化
│   │   ├── api.js                    # Supabase SDK 封装 (动态数据)
│   │   ├── catalog_db.js             # Dexie.js 封装 (静态数据)
│   │   ├── store.js                  # 数据路由层 (动态/静态分发)
│   │   ├── ui.js                     # UI 交互逻辑
│   │   ├── cache.js                  # 图片缓存管理
│   │   ├── auth.js                   # 用户认证 (Supabase Auth)
│   │   └── data-init.js              # 静态数据初始化
│   ├── data/
│   │   ├── parts_catalog.json        # 零件目录数据
│   │   ├── colors.json               # 颜色定义数据
│   │   └── catalog_meta.json         # 目录版本信息
│   ├── icons/                        # PWA 图标资源
│   └── images/
│       └── placeholder.png           # 占位图
│
├── docs/                             # 文档
│   └── system_summary.md             # 本文档
│
├── sql/                              # 数据库脚本
│   ├── init_supabase.sql             # Supabase 建表与 RLS 脚本
│   └── seed_catalog.sql              # 静态数据初始化脚本
│
├── data/                             # 原始数据资源
│   ├── images/                       # 零件图片源
│   └── json/                         # 基础数据 JSON 源
│
├── .github/workflows/
│   └── deploy-frontend.yml           # GitHub Actions 自动部署
│
└── README.md
```

### 5.1 核心文件说明

| 文件 | 功能 |
|------|------|
| `api.js` | Supabase SDK 封装，处理动态数据 CRUD |
| `catalog_db.js` | Dexie.js 封装，处理静态数据查询 |
| `store.js` | 数据路由层，根据操作类型分发到对应数据源 |
| `cache.js` | 图片缓存管理，预加载与运行时缓存 |
| `auth.js` | Supabase 用户认证 |
| `service-worker.js` | Service Worker 实现离线缓存 |
| `data-init.js` | 静态数据初始化到 IndexedDB |

### 5.2 store.js 数据路由逻辑

```javascript
// store.js 核心路由逻辑
const Store = {
  // 动态数据 → Supabase
  async getRepositories() {
    return await api.getRepositories();
  },
  
  // 静态数据 → IndexedDB
  async searchParts(keyword) {
    return await catalog.searchParts(keyword);
  },
  
  // 混合数据（动态+静态关联查询）
  async getPartsForBox(boxId) {
    // 1. 从 Supabase 获取零件库存记录
    const inventories = await api.getParts(boxId);
    
    // 2. 从 IndexedDB 获取零件目录信息
    const partsCatalog = await catalog.getPartsByNums(
      inventories.map(p => p.part_num)
    );
    
    // 3. 合并数据
    return inventories.map(inv => ({
      ...inv,
      catalog: partsCatalog.find(c => c.part_num === inv.part_num)
    }));
  }
};
```

---

## 六、部署流程

### 6.1 前端部署
1. 代码提交到 GitHub 仓库 `main` 分支
2. GitHub Actions 自动将 `frontend/` 目录部署到 `gh-pages` 分支
3. 访问地址：https://legoping.github.io/Parts-backend/

### 6.2 Supabase 配置
1. 在 Supabase 控制台创建项目
2. 执行 `sql/init_supabase.sql` 建表与 RLS 策略
3. 获取 Project URL 和 anon Public Key
4. 在 `index.html` 中配置：

```html
<script>
  // Supabase 配置
  window.SUPABASE_CONFIG = {
    url: 'https://tfxydlkpxkdpxyoqrkez.supabase.co',
    anonKey: 'eyJhbGciOiJI...(你的anon key)'
  };
</script>
```

### 6.3 iOS 安装流程
1. 在 iPhone/iPad 上用 Safari 打开 PWA 地址
2. 点击"分享"按钮 → "添加到主屏幕"
3. 首次启动：
   - 用户登录（Supabase Auth）
   - 自动加载静态数据到 IndexedDB
   - 预缓存常用零件图片
4. 之后可离线浏览零件目录

### 6.4 静态数据更新
```bash
# 更新零件目录
# 1. 修改 frontend/data/parts_catalog.json
# 2. 更新 catalog_meta.json 版本号
# 3. 推送代码到 GitHub
# 4. 用户下次访问时自动增量更新 IndexedDB
```

---

## 七、关键技术决策

| 决策点 | 方案 | 原因 |
|--------|------|------|
| 动态数据存储 | Supabase PostgreSQL | 多设备同步、数据安全、免费且稳定 |
| 静态数据缓存 | IndexedDB + Dexie.js | 离线浏览、减少网络请求、iOS 原生支持 |
| 图片缓存 | Service Worker + Cache Storage | 离线显示、预加载常用图片 |
| 后端方案 | 无需独立后端 | 前端直连 Supabase SDK |
| 用户认证 | Supabase Auth | 内置认证、与 RLS 策略配合 |
| 应用框架 | 原生 JavaScript | 简单直接，无构建依赖 |
| 静态托管 | GitHub Pages | 免费、CDN 加速、自动部署 |

### 7.1 为什么选择 Supabase 直连

| 对比项 | 独立后端 (FastAPI) | 直连 Supabase |
|--------|-------------------|--------------|
| 架构复杂度 | 高（需维护后端） | 低（无后端） |
| 部署成本 | 需 Docker/云托管 | 仅前端部署 |
| 实时性 | 需轮询或缓存 | 支持实时订阅 |
| 安全性 | 需自建鉴权 | RLS 策略内置 |
| 开发效率 | 低（多一层抽象） | 高（直接操作） |

### 7.2 数据分层策略说明

| 数据类型 | 示例 | 更新频率 | 存储位置 |
|---------|------|---------|---------|
| 用户操作数据 | 仓库、盒子、零件数量 | 高（随时可能变化） | Supabase |
| 零件基础信息 | 型号、名称、分类 | 极低（定期更新） | IndexedDB |
| 颜色定义 | 颜色名、RGB 值 | 极低（基本不变） | IndexedDB |
| 图片资源 | 零件图片 | 低（偶尔添加） | Cache Storage |

---

## 八、静态数据管理

### 8.1 目录数据格式

```json
// frontend/data/parts_catalog.json
{
  "version": "2024.07",
  "updated_at": "2024-07-29",
  "parts": [
    {
      "part_num": "3001",
      "name": "基础砖 2x4",
      "category": "基础砖",
      "image_url": "https://img.bricklink.com/...",
      "color_ids": [1, 2, 4, 21]
    }
  ]
}
```

```json
// frontend/data/colors.json
{
  "colors": [
    {
      "id": 1,
      "color_name": "红色",
      "rgb": "#C91A09",
      "bricklink_id": 21
    }
  ]
}
```

### 8.2 数据刷新机制

#### 完整刷新流程
```
应用启动
    │
    ▼
1. 在线检查
   ├── 离线 → 使用现有本地数据
   └── 在线 → 继续
    │
    ▼
2. 版本检查
   GET /data/catalog_meta.json (带 ?v=timestamp 避免缓存)
    │
    ▼
3. 版本比较
   ├── 版本相同 → 跳过，使用现有数据
   └── 版本不同 → 继续
    │
    ▼
4. 数据下载
   下载 parts_catalog.json + colors.json
    │
    ▼
5. 数据更新
   ├── 增量更新：只更新新增/变更的记录
   ├── 全量更新：版本跨度大时全量替换
   └── 状态标记：标记更新中，防止导航中断
    │
    ▼
6. 图片刷新
   更新图片 URL（带新版本号）
   清理旧版本图片缓存
    │
    ▼
7. 完成
   更新本地版本号
   通知用户"数据已更新"
```

#### 错误处理策略

| 错误场景 | 处理方式 |
|---------|---------|
| 下载失败 | 保留现有数据，下次启动重试 |
| 中途断网 | 标记状态为 partial，网络恢复继续 |
| 数据格式错误 | 回滚到上一版本，提示用户 |
| IndexedDB 已满 | 提示清理缓存，或使用精简模式 |

#### 刷新时机
- **应用启动时**：自动检查版本（轻量级请求）
- **用户手动触发**：设置页"刷新数据"按钮
- **Service Worker 更新时**：新版本 SW 激活后触发

### 8.3 图片缓存策略

| 策略 | 说明 |
|------|------|
| 预缓存 | 首次加载时缓存 TOP 500 常用零件图片 |
| 按需缓存 | 用户查看过的图片自动缓存 |
| 容量限制 | 监控缓存大小，超过 100MB 自动清理 |
| 清理策略 | 优先清理长期未访问的图片 |
| 版本关联 | 图片 URL 带版本号，便于更新缓存 |

---

## 九、版本历史

| 版本 | 架构 | 说明 |
|------|------|------|
| v1.0 | Pythonista + iCloud | iOS 原生应用 |
| v2.0 | CloudBase + GitHub Pages | 腾讯云 CloudBase 后端 |
| v3.0 | Supabase + FastAPI | 纯云端后端架构 |
| **v4.0** | **Supabase + IndexedDB 混合** | **当前版本：动态云+静态本地** |

### v4.0 升级内容
- ✅ 采用混合架构：动态数据 Supabase，静态数据 IndexedDB
- ✅ 移除独立后端依赖，前端直连 Supabase SDK
- ✅ 支持离线浏览零件目录和图片
- ✅ 静态数据定期自动刷新
- ✅ 实现用户认证与 RLS 数据隔离
- ✅ Service Worker 实现图片离线缓存

---

## 十、待办事项

- [x] 架构方案设计
- [ ] Supabase 项目配置与建表
- [ ] 实现 Supabase SDK 封装 (api.js)
- [ ] 实现 Dexie.js 数据库封装 (catalog_db.js)
- [ ] 实现数据路由层 (store.js)
- [ ] 实现 Service Worker 离线缓存
- [ ] 实现图片缓存管理 (cache.js)
- [ ] 实现用户认证 (auth.js)
- [ ] 实现静态数据初始化与刷新
- [ ] 优化 iOS 移动端 UI 交互
- [ ] 性能测试与优化

---

## 附录：核心代码示例

### api.js - Supabase SDK 封装

```javascript
// frontend/js/api.js

const Api = (() => {
  const supabase = window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.anonKey
  );

  // 仓库操作
  async getRepositories() {
    const { data, error } = await supabase
      .from('repositories')
      .select('*')
      .order('name');
    if (error) throw error;
    return data;
  },

  async createRepository(name) {
    const { data, error } = await supabase
      .from('repositories')
      .insert({ name, user_id: (await supabase.auth.getUser()).data.user.id })
      .select();
    if (error) throw error;
    return data[0];
  },

  // 盒子操作
  async getBoxes(repositoryId) {
    const { data, error } = await supabase
      .from('boxes')
      .select('*')
      .eq('repository_id', repositoryId)
      .order('box_number');
    if (error) throw error;
    return data;
  },

  // 零件操作
  async getParts(boxId) {
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .eq('box_id', boxId);
    if (error) throw error;
    return data;
  },

  async createPart(partData) {
    const { data, error } = await supabase
      .from('parts')
      .insert(partData)
      .select();
    if (error) throw error;
    return data[0];
  }
})();

window.LegoAPI = Api;
```

### catalog_db.js - Dexie.js 封装

```javascript
// frontend/js/catalog_db.js

const CatalogDB = (() => {
  const db = new Dexie('lego_catalog_db');

  db.version(1).stores({
    parts_catalog: '++id, &part_num, name, category',
    colors: '++id, &color_name'
  });

  return {
    // 零件目录查询
    async searchParts(keyword) {
      return await db.parts_catalog
        .where('name')
        .startsWithIgnoreCase(keyword)
        .or('part_num')
        .startsWithIgnoreCase(keyword)
        .toArray();
    },

    async getPartByNum(partNum) {
      return await db.parts_catalog.get(partNum);
    },

    async getPartsByNums(partNums) {
      return await db.parts_catalog
        .where('part_num')
        .anyOf(partNums)
        .toArray();
    },

    // 颜色查询
    async getAllColors() {
      return await db.colors.toArray();
    },

    async getColorById(id) {
      return await db.colors.get(id);
    },

    // 数据写入
    async importParts(parts) {
      await db.parts_catalog.bulkPut(parts);
    },

    async importColors(colors) {
      await db.colors.bulkPut(colors);
    }
  };
})();

window.LegoCatalog = CatalogDB;
```

---

## 附录：Service Worker 缓存策略

```javascript
// frontend/service-worker.js

const BASE_PATH = '/Parts-backend';
const CACHE_NAME = 'lego-parts-v4';

// 预缓存核心资源
const PRECACHE_URLS = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/css/style.css`,
  `${BASE_PATH}/js/app.js`,
  `${BASE_PATH}/js/api.js`,
  `${BASE_PATH}/js/catalog_db.js`,
  `${BASE_PATH}/js/store.js`,
  `${BASE_PATH}/js/ui.js`,
  `${BASE_PATH}/js/cache.js`,
  `${BASE_PATH}/js/auth.js`,
  `${BASE_PATH}/js/data-init.js`,
  `${BASE_PATH}/data/parts_catalog.json`,
  `${BASE_PATH}/data/colors.json`,
  `${BASE_PATH}/manifest.json`,
  // CDN 资源
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/dexie@4.0.4/dist/dexie.min.js'
];

// 安装：预缓存
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of PRECACHE_URLS) {
        try {
          if (url.startsWith('http')) {
            const response = await fetch(url, { mode: 'cors' });
            await cache.put(url, response);
          } else {
            await cache.add(url);
          }
        } catch (e) {
          console.warn(`Cache failed: ${url}`);
        }
      }
    })
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
});

// 请求拦截
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  
  // Supabase API 请求：网络优先
  if (url.hostname.includes('supabase.co')) {
    return; // 不缓存，直接网络请求
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;

      return fetch(event.request).then((fetchResponse) => {
        // 缓存同源资源和图片
        if (url.origin === self.location.origin ||
            url.hostname.includes('img.bricklink.com') ||
            url.hostname.includes('cdn.jsdelivr.net')) {
          const clone = fetchResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return fetchResponse;
      });
    })
  );
});
```

---

## 附录：文档索引

| 文档 | 路径 | 状态 |
|------|------|------|
| **当前版本文档** | `PWA-PY/docs/system_summary.md` | ✅ v4.0 混合架构版 |
| 旧版本文档 (CloudBase) | `PWA/docs/system_summary.md` | ⚠️ v2.1 已弃用 |
| v3.0 文档 (Supabase+FastAPI) | `PWA-PY/docs/system_summary_副本.md` | ⚠️ v3.0 已弃用 |

---

## 附录：术语表

| 术语 | 说明 |
|------|------|
| PWA | Progressive Web App，渐进式 Web 应用 |
| RLS | Row Level Security，行级安全策略 |
| IndexedDB | 浏览器原生 NoSQL 本地数据库 |
| Dexie.js | IndexedDB 的封装库 |
| Service Worker | 浏览器后台脚本，用于缓存和离线支持 |
| Cache Storage | 浏览器缓存 API |
| Supabase | 开源 Firebase 替代产品，提供数据库+认证+存储 |
| CDN | Content Delivery Network，内容分发网络 |