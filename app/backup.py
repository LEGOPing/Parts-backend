import os
import shutil
import datetime
import subprocess
import logging

logger = logging.getLogger(__name__)

BACKUP_DIR = "./backups"
MAX_BACKUPS = 5

def ensure_backup_dir():
    os.makedirs(BACKUP_DIR, exist_ok=True)

def get_backup_filename():
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    return f"parts_backup_{timestamp}.db"

def backup_database(db_path):
    ensure_backup_dir()
    
    if not os.path.exists(db_path):
        logger.warning(f"数据库文件不存在: {db_path}")
        return None
    
    backup_filename = get_backup_filename()
    backup_path = os.path.join(BACKUP_DIR, backup_filename)
    
    try:
        shutil.copy2(db_path, backup_path)
        logger.info(f"数据库备份成功: {backup_path}")
        
        cleanup_old_backups()
        
        return backup_path
    except Exception as e:
        logger.error(f"数据库备份失败: {e}")
        return None

def cleanup_old_backups():
    ensure_backup_dir()
    
    backups = sorted(
        [f for f in os.listdir(BACKUP_DIR) if f.startswith('parts_backup_') and f.endswith('.db')],
        key=lambda x: os.path.getmtime(os.path.join(BACKUP_DIR, x)),
        reverse=True
    )
    
    if len(backups) > MAX_BACKUPS:
        for backup in backups[MAX_BACKUPS:]:
            backup_path = os.path.join(BACKUP_DIR, backup)
            try:
                os.remove(backup_path)
                logger.info(f"清理旧备份: {backup}")
            except Exception as e:
                logger.error(f"清理旧备份失败: {e}")

def backup_to_gitee(backup_path):
    gitee_repo = "git@gitee.com:legoping/Parts-backup.git"
    backup_dir = "./parts-backup-temp"
    
    try:
        if os.path.exists(backup_dir):
            shutil.rmtree(backup_dir)
        
        subprocess.run(
            ["git", "clone", gitee_repo, backup_dir],
            check=True,
            capture_output=True,
            text=True
        )
        
        backup_filename = os.path.basename(backup_path)
        dest_path = os.path.join(backup_dir, backup_filename)
        shutil.copy2(backup_path, dest_path)
        
        subprocess.run(
            ["git", "add", backup_filename],
            cwd=backup_dir,
            check=True,
            capture_output=True,
            text=True
        )
        
        commit_message = f"自动备份: {backup_filename}"
        subprocess.run(
            ["git", "commit", "-m", commit_message],
            cwd=backup_dir,
            check=True,
            capture_output=True,
            text=True
        )
        
        subprocess.run(
            ["git", "push", "origin", "main"],
            cwd=backup_dir,
            check=True,
            capture_output=True,
            text=True
        )
        
        shutil.rmtree(backup_dir)
        logger.info(f"备份已上传到 Gitee: {backup_filename}")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"上传到 Gitee 失败: {e.stderr}")
        return False
    except Exception as e:
        logger.error(f"上传到 Gitee 失败: {e}")
        return False

def auto_backup(db_path):
    backup_path = backup_database(db_path)
    if backup_path:
        backup_to_gitee(backup_path)