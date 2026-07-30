# 乐高零件管理系统 - 规划方案总结

## 一、系统概述

这是一个基于 **PWA（渐进式Web应用）** 架构的乐高零件管理系统，实现了仓库、盒子、零件的三层级管理功能。

**系统版本**：2.1.0 (PWA版)  
**开发者**：LEGOPing  
**访问地址**：https://legoping.github.io/Parts-2026

---

## 二、架构设计

### 2.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | HTML5 + CSS3 + JavaScript | PWA单页应用 |
| **后端** | 腾讯云CloudBase | 云函数 + NoSQL数据库 |
| **静态资源** | GitHub Pages / Gitee | 前端页面和图片托管 |
| **数据存储** | CloudBase数据库 | repositories, boxes, parts, colors 四个集合 |

### 2.2 部署架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
└─────────────────────────────┬───────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  GitHub Pages   │ │   CloudBase     │ │    Gitee        │
│  (Parts-2026)   │ │   云函数/数据库  │ │  Parts-img/json │
│  前端静态页面    │ │   动态数据处理   │ │  图片/基础数据   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 2.3 CloudBase配置

- **环境ID**：`legopart-d3gyvl7hw36084032`
- **区域**：`ap-shanghai`
- **账号ID**：`100050446959`

---

## 三、功能模块

### 3.1 仓库管理
- 查看仓库列表及统计数量
- 添加新仓库
- 编辑仓库信息
- 删除仓库

### 3.2 盒子管理
- 选择仓库后查看盒子列表
- 添加盒子（支持编号和名称）
- 编辑盒子信息
- 删除盒子
- 盒子转仓（开发中）

### 3.3 零件管理
- 选择盒子后查看零件列表
- 添加单个零件（型号、名称、颜色、数量、状态）
- 批量导入零件（CSV格式）
- 编辑零件信息
- 删除零件
- 零件转盒（开发中）

### 3.4 零件搜索
- 按型号搜索
- 按名称搜索
- 按颜色ID筛选
- 按状态筛选（新品/旧品）

### 3.5 系统设置
- 数据库初始化
- 数据备份/恢复/同步
- 缓存管理
- 统计信息展示（仓库数、盒子数、零件种类、零件总数）

---

## 四、项目结构

```
PWA/
├── frontend/                    # 前端静态文件
│   ├── index.html               # 主页面
│   ├── manifest.json            # PWA配置
│   ├── service-worker.js        # 离线缓存
│   ├── css/style.css            # 样式文件
│   ├── js/
│   │   ├── api.js               # API调用封装
│   │   ├── store.js             # 本地状态管理
│   │   └── ui.js                # UI交互逻辑
│   └── .github/workflows/
│       └── deploy.yml           # GitHub Actions自动部署
│
├── cloudbase/functions/         # 云函数（14个）
│   ├── getRepositories/         # 获取仓库列表
│   ├── createRepository/        # 创建仓库
│   ├── updateRepository/        # 更新仓库
│   ├── deleteRepository/        # 删除仓库
│   ├── getBoxes/                # 获取盒子列表
│   ├── createBox/               # 创建盒子
│   ├── updateBox/               # 更新盒子
│   ├── deleteBox/               # 删除盒子
│   ├── getParts/                # 获取零件列表
│   ├── createPart/              # 创建零件
│   ├── updatePart/              # 更新零件
│   ├── deletePart/              # 删除零件
│   ├── searchParts/             # 搜索零件
│   └── importData/              # 批量导入数据
│
├── migration_data/              # 迁移数据文件
│   ├── repositories.json
│   ├── boxes.json
│   ├── parts.json
│   └── colors.json
│
└── deploy.sh / migrate.js       # 部署和迁移脚本
```

---

## 五、云函数规范

所有云函数遵循统一规范：

1. **CORS响应头**（免费版限制）：
   ```javascript
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Methods: GET, POST, OPTIONS
   Access-Control-Allow-Headers: Content-Type
   ```

2. **`getEventData` 函数**：解析HTTP POST请求参数

3. **OPTIONS预检请求**：统一处理跨域预检

4. **响应格式**：`{ success: boolean, data: any, error?: string }`

---

## 六、部署流程

### 前端部署
- 代码提交到 GitHub 仓库 `Parts-2026` 的 `main` 分支
- GitHub Actions 自动触发部署到 GitHub Pages
- 访问地址：https://legoping.github.io/Parts-2026

### 云函数部署
- 通过腾讯云CloudBase控制台手动部署
- 或使用 CLI 工具（当前环境因网络问题需手动部署）

### 静态资源
- 图片资源：部署到 `Parts-img` 仓库（Gitee）
- 基础数据（颜色、零件信息）：部署到 `Parts-json` 仓库（Gitee）

---

## 七、关键技术决策

| 决策点 | 方案 | 原因 |
|--------|------|------|
| 后端SDK选择 | HTTP直接调用云函数 | CloudBase JS SDK在GitHub Pages环境初始化失败 |
| CORS处理 | 云函数代码中设置响应头 | 免费版不支持域名白名单配置 |
| 数据存储 | CloudBase数据库 | 无需自建服务器，按需计费 |
| 前端部署 | GitHub Pages | 免费托管，自动CDN加速 |
| 基础数据 | Gitee托管 | 访问稳定，支持大文件 |

---

## 八、已知问题与待办

**已修复**：
- ✅ 按钮无响应问题（SDK初始化超时导致）
- ✅ 替换为HTTP直接调用云函数
- ✅ 添加全局错误捕获

**待开发**：
- ⏳ 盒子转仓功能
- ⏳ 零件转盒功能
- ⏳ 云函数自动部署（当前需手动部署）

**注意事项**：
- 避免嵌套Git仓库，会导致push失败
- CloudBase免费包不支持自定义域名CORS配置
- 数据库导入需使用JSON Lines格式（每行一个JSON对象）
