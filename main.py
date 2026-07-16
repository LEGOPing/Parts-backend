from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 导入数据库配置
from app.database import Base, engine, get_db

# 导入所有模型，确保它们被注册到Base.metadata
from app.models.repository import Repository
from app.models.box import Box
from app.models.part import Part

# 创建数据库表
Base.metadata.create_all(bind=engine)

# 创建FastAPI应用
app = FastAPI(
    title="乐高零件管理系统",
    description="一个基于Python和FastAPI的乐高零件管理系统",
    version="1.0.0"
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生产环境中应该设置具体的域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 导入路由
from app.routes import repositories, boxes, parts, search, settings

# 注册路由
app.include_router(repositories.router, prefix="/api/repositories", tags=["仓库管理"])
app.include_router(boxes.router, prefix="/api/boxes", tags=["盒子管理"])
app.include_router(parts.router, prefix="/api/parts", tags=["零件管理"])
app.include_router(search.router, prefix="/api/search", tags=["零件搜索"])
app.include_router(settings.router, prefix="/api/settings", tags=["系统设置"])

# 健康检查端点
@app.get("/health")
def health_check():
    return {"status": "ok"}

# 挂载静态文件
app.mount("/frontend", StaticFiles(directory="frontend", html=True), name="frontend")
app.mount("/images", StaticFiles(directory="images"), name="images")

# 根路径
@app.get("/")
def read_root():
    return {"message": "欢迎使用乐高零件管理系统"}