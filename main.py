from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import logging
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

logger.info(f"DATA_DIR: {os.getenv('DATA_DIR', 'not set')}")
logger.info(f"DATABASE_URL: {os.getenv('DATABASE_URL', 'not set')}")

from app.database import Base, engine, get_db
from app.backup import auto_backup

# 导入所有模型，确保它们被注册到Base.metadata
from app.models.repository import Repository
from app.models.box import Box
from app.models.part import Part

logger.info("Creating database tables...")
try:
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created successfully")
except Exception as e:
    logger.error(f"Failed to create database tables: {e}")
    raise

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

# 挂载静态文件（仅本地开发时使用，云托管时前端由GitHub Pages托管）
try:
    app.mount("/frontend", StaticFiles(directory="frontend", html=True), name="frontend")
except RuntimeError:
    logger.info("frontend directory not found, skipping static mount")

try:
    app.mount("/images", StaticFiles(directory="images"), name="images")
except RuntimeError:
    logger.info("images directory not found, skipping static mount")

# 根路径
@app.get("/")
def read_root():
    return {"message": "欢迎使用乐高零件管理系统"}

# 获取数据库路径
DATABASE_PATH = os.getenv("DATABASE_URL", "sqlite:///./parts.db").replace("sqlite:///", "")

# 定时备份
scheduler = BackgroundScheduler()
scheduler.add_job(
    func=lambda: auto_backup(DATABASE_PATH),
    trigger="cron",
    hour=2,
    minute=0,
    id="daily_backup",
    name="每日数据库备份",
    replace_existing=True
)
scheduler.start()

logger.info("定时备份任务已启动")