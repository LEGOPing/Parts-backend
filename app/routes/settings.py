from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import os
import shutil
from app.database import get_db, engine
from app.models import Base
from app.backup import backup_database, backup_to_gitee

router = APIRouter()

@router.post("/backup")
def manual_backup(db: Session = Depends(get_db)):
    db_url = str(engine.url)
    
    if db_url.startswith("sqlite"):
        db_path = db_url.replace("sqlite:///", "")
        backup_path = backup_database(db_path)
        
        if backup_path:
            uploaded = backup_to_gitee(backup_path)
            return {"message": "数据库备份成功", "backup_path": backup_path, "uploaded_to_gitee": uploaded}
        else:
            raise HTTPException(status_code=500, detail="数据库备份失败")
    else:
        raise HTTPException(status_code=501, detail="暂不支持该数据库类型的备份")

@router.get("/backup/{backup_file}")
def download_backup(backup_file: str):
    backup_path = os.path.join("./backups", backup_file)
    if not os.path.exists(backup_path):
        raise HTTPException(status_code=404, detail="备份文件不存在")
    return FileResponse(backup_path, filename=backup_file)

@router.post("/restore/{backup_file}")
def restore_database(backup_file: str, db: Session = Depends(get_db)):
    backup_path = os.path.join("./backups", backup_file)
    if not os.path.exists(backup_path):
        raise HTTPException(status_code=404, detail="备份文件不存在")
    
    db_url = str(engine.url)
    
    if db_url.startswith("sqlite"):
        db_path = db_url.replace("sqlite:///", "")
        db.close()
        shutil.copy2(backup_path, db_path)
        return {"message": "数据库恢复成功"}
    else:
        raise HTTPException(status_code=501, detail="暂不支持该数据库类型的恢复")

@router.post("/init")
def initialize_database():
    Base.metadata.create_all(bind=engine)
    return {"message": "数据库初始化成功"}