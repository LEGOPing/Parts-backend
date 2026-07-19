import os
import shutil
import datetime
import subprocess
import logging
from qcloud_cos import CosConfig
from qcloud_cos import CosS3Client
from qcloud_cos.cos_exception import CosServiceError

logger = logging.getLogger(__name__)

BACKUP_DIR = "./backups"
MAX_BACKUPS = 5

COS_CONFIG = {
    "region": os.getenv("COS_REGION", "ap-shanghai"),
    "secret_id": os.getenv("COS_SECRET_ID"),
    "secret_key": os.getenv("COS_SECRET_KEY"),
    "bucket": os.getenv("COS_BUCKET"),
    "db_key": os.getenv("COS_DB_KEY", "parts/parts.db"),
}

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

def get_cos_client():
    if not COS_CONFIG["secret_id"] or not COS_CONFIG["secret_key"] or not COS_CONFIG["bucket"]:
        logger.warning("COS配置不完整，跳过云存储备份")
        return None
    
    config = CosConfig(
        Region=COS_CONFIG["region"],
        SecretId=COS_CONFIG["secret_id"],
        SecretKey=COS_CONFIG["secret_key"]
    )
    return CosS3Client(config)

def upload_to_cos(db_path):
    client = get_cos_client()
    if not client:
        return False
    
    try:
        with open(db_path, 'rb') as f:
            client.put_object(
                Bucket=COS_CONFIG["bucket"],
                Key=COS_CONFIG["db_key"],
                Body=f,
                ContentType='application/octet-stream'
            )
        logger.info(f"数据库已上传到COS: {COS_CONFIG['db_key']}")
        return True
    except CosServiceError as e:
        logger.error(f"上传到COS失败: {e}")
        return False
    except Exception as e:
        logger.error(f"上传到COS失败: {e}")
        return False

def download_from_cos(db_path):
    client = get_cos_client()
    if not client:
        return False
    
    try:
        response = client.get_object(
            Bucket=COS_CONFIG["bucket"],
            Key=COS_CONFIG["db_key"]
        )
        with open(db_path, 'wb') as f:
            f.write(response['Body'].read())
        logger.info(f"从COS下载数据库成功: {db_path}")
        return True
    except CosServiceError as e:
        logger.error(f"从COS下载失败: {e}")
        return False
    except Exception as e:
        logger.error(f"从COS下载失败: {e}")
        return False

def auto_backup(db_path):
    backup_path = backup_database(db_path)
    if backup_path:
        backup_to_gitee(backup_path)
        upload_to_cos(db_path)