from pydantic import BaseModel
from typing import Optional

class PartBase(BaseModel):
    part_num: str
    name: str
    color_id: int
    is_new: bool = False
    quantity: int = 0
    box_id: int

class PartCreate(PartBase):
    pass

class PartUpdate(BaseModel):
    part_num: Optional[str] = None
    name: Optional[str] = None
    color_id: Optional[int] = None
    is_new: Optional[bool] = None
    quantity: Optional[int] = None
    box_id: Optional[int] = None

class Part(PartBase):
    id: int
    
    class Config:
        from_attributes = True
