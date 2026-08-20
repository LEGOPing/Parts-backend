from sqlalchemy import Column, Integer, String
from app.database import Base

class PartAlias(Base):
    __tablename__ = "part_aliases"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # 别名零件型号（如 4073），在 RB 数据库中可能不存在
    alias_part_num = Column(String, index=True, nullable=False)
    # RB 数据库中对应的标准零件型号（如 6141）
    rb_part_num = Column(String, index=True, nullable=False)
    # 备注说明（可选）
    remark = Column(String, nullable=True)