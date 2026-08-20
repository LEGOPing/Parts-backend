from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models.part_alias import PartAlias
from pydantic import BaseModel

router = APIRouter()


class PartAliasCreate(BaseModel):
    alias_part_num: str
    rb_part_num: str
    remark: Optional[str] = None


class PartAliasUpdate(BaseModel):
    alias_part_num: Optional[str] = None
    rb_part_num: Optional[str] = None
    remark: Optional[str] = None


class PartAliasResponse(BaseModel):
    id: int
    alias_part_num: str
    rb_part_num: str
    remark: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("/", response_model=List[PartAliasResponse])
def list_aliases(
    alias_part_num: Optional[str] = Query(None, description="按别名零件型号搜索"),
    rb_part_num: Optional[str] = Query(None, description="按RB标准零件型号搜索"),
    db: Session = Depends(get_db),
):
    query = db.query(PartAlias)
    if alias_part_num:
        query = query.filter(PartAlias.alias_part_num.ilike(f"%{alias_part_num}%"))
    if rb_part_num:
        query = query.filter(PartAlias.rb_part_num.ilike(f"%{rb_part_num}%"))
    return query.all()


@router.get("/resolve", response_model=PartAliasResponse)
def resolve_alias(
    part_num: str = Query(..., description="需要查询的零件型号"),
    db: Session = Depends(get_db),
):
    """根据零件型号查询别名映射：如果 part_num 是别名，返回对应的 RB 标准型号"""
    alias = db.query(PartAlias).filter(PartAlias.alias_part_num == part_num).first()
    if not alias:
        raise HTTPException(status_code=404, detail=f"未找到零件 {part_num} 的别名映射")
    return alias


@router.get("/reverse", response_model=List[PartAliasResponse])
def reverse_lookup(
    rb_part_num: str = Query(..., description="RB标准零件型号"),
    db: Session = Depends(get_db),
):
    """查询某个 RB 标准型号有哪些别名"""
    return db.query(PartAlias).filter(PartAlias.rb_part_num == rb_part_num).all()


@router.post("/", response_model=PartAliasResponse)
def create_alias(alias: PartAliasCreate, db: Session = Depends(get_db)):
    # 检查是否已存在相同的别名映射
    existing = db.query(PartAlias).filter(
        PartAlias.alias_part_num == alias.alias_part_num
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"别名 {alias.alias_part_num} 已存在映射")
    db_alias = PartAlias(**alias.model_dump())
    db.add(db_alias)
    db.commit()
    db.refresh(db_alias)
    return db_alias


@router.put("/{alias_id}", response_model=PartAliasResponse)
def update_alias(alias_id: int, alias: PartAliasUpdate, db: Session = Depends(get_db)):
    db_alias = db.query(PartAlias).filter(PartAlias.id == alias_id).first()
    if not db_alias:
        raise HTTPException(status_code=404, detail="别名记录不存在")
    update_data = alias.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_alias, key, value)
    db.commit()
    db.refresh(db_alias)
    return db_alias


@router.delete("/{alias_id}")
def delete_alias(alias_id: int, db: Session = Depends(get_db)):
    db_alias = db.query(PartAlias).filter(PartAlias.id == alias_id).first()
    if not db_alias:
        raise HTTPException(status_code=404, detail="别名记录不存在")
    db.delete(db_alias)
    db.commit()
    return {"message": "别名删除成功"}