from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base

class Part(Base):
    __tablename__ = "parts"
    
    id = Column(Integer, primary_key=True, index=True)
    part_num = Column(String, index=True)
    name = Column(String, index=True)
    color_id = Column(Integer, index=True)
    is_new = Column(Boolean, default=False)
    quantity = Column(Integer, default=0)
    box_id = Column(Integer, ForeignKey("boxes.id"))
    
    # 关系
    box = relationship("Box", back_populates="parts")
