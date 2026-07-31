from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
import os
import shutil
import subprocess
from app.database import get_db, engine, is_postgres
from app.models import Base
from app.backup import backup_database, backup_to_gitee, upload_to_cos, get_db_url

router = APIRouter()

@router.post("/backup")
def manual_backup(db: Session = Depends(get_db)):
    db_url = str(engine.url)

    if db_url.startswith("sqlite"):
        db_path = db_url.replace("sqlite:///", "")
        backup_path = backup_database(db_path)
        if backup_path:
            uploaded_gitee = backup_to_gitee(backup_path)
            uploaded_cos = upload_to_cos(backup_path)
            return {"message": "数据库备份成功", "backup_path": backup_path, "uploaded_to_gitee": uploaded_gitee, "uploaded_to_cos": uploaded_cos}
        else:
            raise HTTPException(status_code=500, detail="数据库备份失败")
    elif is_postgres():
        from app.backup import backup_postgres
        backup_path = backup_postgres()
        if backup_path:
            uploaded_gitee = backup_to_gitee(backup_path)
            uploaded_cos = upload_to_cos(backup_path)
            return {"message": "数据库备份成功", "backup_path": backup_path, "uploaded_to_gitee": uploaded_gitee, "uploaded_to_cos": uploaded_cos}
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
    elif is_postgres():
        try:
            result = subprocess.run(
                ["psql", get_db_url(), "-f", backup_path, "-v", "--no-password"],
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.returncode == 0:
                return {"message": "数据库恢复成功"}
            else:
                raise HTTPException(status_code=500, detail=f"恢复失败: {result.stderr}")
        except FileNotFoundError:
            raise HTTPException(status_code=501, detail="服务器未安装 psql 客户端，无法恢复 PostgreSQL 备份")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"恢复失败: {str(e)}")
    else:
        raise HTTPException(status_code=501, detail="暂不支持该数据库类型的恢复")

@router.post("/init")
def initialize_database():
    Base.metadata.create_all(bind=engine)
    return {"message": "数据库初始化成功"}

@router.post("/reset-sequences")
def reset_sequences(db: Session = Depends(get_db)):
    """重置所有表的自增序列，从0开始"""
    if not is_postgres:
        # SQLite 不支持序列重置，删除数据后会自动重置
        return {"message": "SQLite 数据库会在删除数据后自动重置 ID"}
    
    try:
        # PostgreSQL: 重置序列从0开始
        sequences = [
            "repositories_id_seq",
            "boxes_id_seq",
            "parts_id_seq"
        ]
        
        for seq in sequences:
            db.execute(text(f"ALTER SEQUENCE {seq} RESTART WITH 0"))
        
        db.commit()
        return {"message": "序列重置成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"重置序列失败: {str(e)}")
