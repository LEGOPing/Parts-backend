from sqlalchemy import Column, Integer, String
from app.database import Base

class Color(Base):
    __tablename__ = "colors"
    
    id = Column(Integer, primary_key=True, index=True)
    color_name = Column(String, index=True)
    rgb = Column(String)
    bricklink_id = Column(Integer)