from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.part import Part
from app.schemas.part import PartCreate, PartUpdate, Part as PartSchema

router = APIRouter()

@router.post("/", response_model=PartSchema)
def create_part(part: PartCreate, db: Session = Depends(get_db)):
    db_part = Part(
        part_num=part.part_num,
        name=part.name,
        color_id=part.color_id,
        is_new=part.is_new,
        quantity=part.quantity,
        box_id=part.box_id
    )
    db.add(db_part)
    db.commit()
    db.refresh(db_part)
    return db_part

@router.get("/", response_model=List[PartSchema])
def get_parts(box_id: int = None, db: Session = Depends(get_db)):
    if box_id:
        return db.query(Part).filter(Part.box_id == box_id).all()
    return db.query(Part).all()

@router.get("/{part_id}", response_model=PartSchema)
def get_part(part_id: int, db: Session = Depends(get_db)):
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(status_code=404, detail="零件不存在")
    return part

@router.put("/{part_id}", response_model=PartSchema)
def update_part(part_id: int, part: PartUpdate, db: Session = Depends(get_db)):
    db_part = db.query(Part).filter(Part.id == part_id).first()
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    if part.part_num:
        db_part.part_num = part.part_num
    if part.name:
        db_part.name = part.name
    if part.color_id is not None:
        db_part.color_id = part.color_id
    if part.is_new is not None:
        db_part.is_new = part.is_new
    if part.quantity is not None:
        db_part.quantity = part.quantity
    if part.box_id is not None:
        db_part.box_id = part.box_id
    db.commit()
    db.refresh(db_part)
    return db_part

@router.delete("/{part_id}")
def delete_part(part_id: int, db: Session = Depends(get_db)):
    db_part = db.query(Part).filter(Part.id == part_id).first()
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    db.delete(db_part)
    db.commit()
    return {"message": "零件删除成功"}

@router.post("/batch", response_model=List[PartSchema])
def batch_create_parts(parts: List[PartCreate], db: Session = Depends(get_db)):
    created_parts = []
    for part_data in parts:
        db_part = Part(
            part_num=part_data.part_num,
            name=part_data.name,
            color_id=part_data.color_id,
            is_new=part_data.is_new,
            quantity=part_data.quantity,
            box_id=part_data.box_id
        )
        db.add(db_part)
        created_parts.append(db_part)
    db.commit()
    for part in created_parts:
        db.refresh(part)
    return created_parts
