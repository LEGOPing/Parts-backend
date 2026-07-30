from pydantic import BaseModel
from typing import List, Optional

class BoxBase(BaseModel):
    box_number: int
    name: str
    repository_id: int

class BoxCreate(BoxBase):
    pass

class BoxUpdate(BaseModel):
    name: Optional[str] = None

class Box(BoxBase):
    id: int
    
    class Config:
        from_attributes = True