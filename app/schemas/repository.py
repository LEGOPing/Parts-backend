from pydantic import BaseModel
from typing import List, Optional

class RepositoryBase(BaseModel):
    name: str

class RepositoryCreate(RepositoryBase):
    pass

class RepositoryUpdate(RepositoryBase):
    pass

class Repository(RepositoryBase):
    id: int
    
    class Config:
        from_attributes = True