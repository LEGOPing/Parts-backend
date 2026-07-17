from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.repository import Repository
from app.schemas.repository import RepositoryCreate, RepositoryUpdate, Repository as RepositorySchema

router = APIRouter()

@router.post("/", response_model=RepositorySchema)
def create_repository(repository: RepositoryCreate, db: Session = Depends(get_db)):
    db_repository = Repository(name=repository.name)
    db.add(db_repository)
    db.commit()
    db.refresh(db_repository)
    return db_repository

@router.get("/", response_model=List[RepositorySchema])
def get_repositories(db: Session = Depends(get_db)):
    repositories = db.query(Repository).all()
    seen_ids = set()
    unique_repos = []
    for repo in repositories:
        if repo.id not in seen_ids:
            seen_ids.add(repo.id)
            unique_repos.append(repo)
    return unique_repos

@router.get("/{repository_id}", response_model=RepositorySchema)
def get_repository(repository_id: int, db: Session = Depends(get_db)):
    repository = db.query(Repository).filter(Repository.id == repository_id).first()
    if not repository:
        raise HTTPException(status_code=404, detail="仓库不存在")
    return repository

@router.put("/{repository_id}", response_model=RepositorySchema)
def update_repository(repository_id: int, repository: RepositoryUpdate, db: Session = Depends(get_db)):
    db_repository = db.query(Repository).filter(Repository.id == repository_id).first()
    if not db_repository:
        raise HTTPException(status_code=404, detail="仓库不存在")
    db_repository.name = repository.name
    db.commit()
    db.refresh(db_repository)
    return db_repository

@router.delete("/{repository_id}")
def delete_repository(repository_id: int, db: Session = Depends(get_db)):
    db_repository = db.query(Repository).filter(Repository.id == repository_id).first()
    if not db_repository:
        raise HTTPException(status_code=404, detail="仓库不存在")
    db.delete(db_repository)
    db.commit()
    return {"message": "仓库删除成功"}