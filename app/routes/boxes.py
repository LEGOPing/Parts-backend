from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.box import Box
from app.schemas.box import BoxCreate, BoxUpdate, Box as BoxSchema

router = APIRouter()

@router.post("/", response_model=BoxSchema)
def create_box(box: BoxCreate, db: Session = Depends(get_db)):
    db_box = Box(
        box_number=box.box_number,
        name=box.name,
        repository_id=box.repository_id
    )
    db.add(db_box)
    db.commit()
    db.refresh(db_box)
    return db_box

@router.get("/", response_model=List[BoxSchema])
def get_boxes(repository_id: int = None, db: Session = Depends(get_db)):
    if repository_id:
        return db.query(Box).filter(Box.repository_id == repository_id).all()
    return db.query(Box).all()

@router.get("/{box_id}", response_model=BoxSchema)
def get_box(box_id: int, db: Session = Depends(get_db)):
    box = db.query(Box).filter(Box.id == box_id).first()
    if not box:
        raise HTTPException(status_code=404, detail="盒子不存在")
    return box

@router.put("/{box_id}", response_model=BoxSchema)
def update_box(box_id: int, box: BoxUpdate, db: Session = Depends(get_db)):
    db_box = db.query(Box).filter(Box.id == box_id).first()
    if not db_box:
        raise HTTPException(status_code=404, detail="盒子不存在")
    if box.name:
        db_box.name = box.name
    db.commit()
    db.refresh(db_box)
    return db_box

@router.delete("/{box_id}")
def delete_box(box_id: int, db: Session = Depends(get_db)):
    db_box = db.query(Box).filter(Box.id == box_id).first()
    if not db_box:
        raise HTTPException(status_code=404, detail="盒子不存在")
    db.delete(db_box)
    db.commit()
    return {"message": "盒子删除成功"}