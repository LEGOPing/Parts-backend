from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import os
import shutil
from app.database import get_db, engine
from app.models import Base

router = APIRouter()

@router.post("/backup")
def backup_database(db: Session = Depends(get_db)):
    db_url = str(engine.url)
    backup_dir = "./backups"
    os.makedirs(backup_dir, exist_ok=True)
    
    import datetime
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    
    if db_url.startswith("sqlite"):
        db_path = db_url.replace("sqlite:///", "")
        if not os.path.exists(db_path):
            raise HTTPException(status_code=404, detail="数据库文件不存在")
        
        backup_filename = f"parts_backup_{timestamp}.db"
        backup_path = os.path.join(backup_dir, backup_filename)
        shutil.copy2(db_path, backup_path)
        
        return {"message": "数据库备份成功", "backup_path": backup_path}
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