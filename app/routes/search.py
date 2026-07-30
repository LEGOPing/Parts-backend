from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from app.database import get_db
from app.models.part import Part
from app.schemas.part import Part as PartSchema

router = APIRouter()

@router.get("/", response_model=List[PartSchema])
def search_parts(
    part_num: Optional[str] = Query(None, description="零件型号"),
    name: Optional[str] = Query(None, description="零件名称"),
    color_id: Optional[int] = Query(None, description="颜色ID"),
    db: Session = Depends(get_db)
):
    query = db.query(Part)
    
    if part_num:
        query = query.filter(Part.part_num.ilike(f"%{part_num}%"))
    if name:
        query = query.filter(Part.name.ilike(f"%{name}%"))
    if color_id:
        query = query.filter(Part.color_id == color_id)
    
    return query.all()

@router.get("/suggestions", response_model=List[dict])
def get_part_suggestions(
    query: str = Query(..., description="搜索关键词"),
    db: Session = Depends(get_db)
):
    # 从系统数据库中获取零件型号和名称的联想建议
    parts = db.query(Part).filter(
        or_(
            Part.part_num.ilike(f"{query}%"),
            Part.name.ilike(f"%{query}%")
        )
    ).limit(10).all()
    
    suggestions = [
        {
            "part_num": part.part_num,
            "name": part.name
        }
        for part in parts
    ]
    
    return suggestions
