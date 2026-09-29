from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from ..database import Base

class Repository(Base):
    __tablename__ = "repositories"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    
    # 关系
    boxes = relationship("Box", back_populates="repository", cascade="all, delete-orphan")
