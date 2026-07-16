from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base

class Box(Base):
    __tablename__ = "boxes"
    
    id = Column(Integer, primary_key=True, index=True)
    box_number = Column(Integer, index=True)
    name = Column(String, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id"))
    
    # 关系
    repository = relationship("Repository", back_populates="boxes")
    parts = relationship("Part", back_populates="box", cascade="all, delete-orphan")
