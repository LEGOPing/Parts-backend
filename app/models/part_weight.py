from sqlalchemy import Column, String, Float, DateTime
from datetime import datetime
from ..database import Base


class PartWeight(Base):
    """零件重量缓存表（数据源 Bricklink）。

    本地 FastAPI 用本机 IP 抓取 Bricklink 重量后回写此表，
    生产环境 PWA 直接读取缓存，避免云服务器 IP 被 Bricklink 反爬拦截。
    """
    __tablename__ = "part_weights"

    part_num = Column(String, primary_key=True)
    weight = Column(Float, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
