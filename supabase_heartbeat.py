"""
Supabase 免费版心跳脚本
每 5 天运行一次，防止 Supabase 项目因 7 天无活动而暂停

使用方式：
    python supabase_heartbeat.py

环境变量：
    DATABASE_URL - Supabase PostgreSQL 连接字符串
"""

import os
import sys
from datetime import datetime

# 自动加载 .env 文件（本地运行时需要）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

def heartbeat():
    """执行一次简单的数据库查询，保持 Supabase 活跃"""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL 环境变量未设置")
        sys.exit(1)

    try:
        import psycopg2
    except ImportError:
        try:
            import psycopg
            psycopg2 = None  # psycopg 3.x
        except ImportError:
            print("正在安装 psycopg2-binary...")
            import subprocess
            subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
            import psycopg2

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] 开始 Supabase 心跳检测...")

    try:
        if psycopg2 is not None:
            conn = psycopg2.connect(database_url, sslmode="require")
        else:
            import psycopg
            conn = psycopg.connect(database_url, sslmode="require")

        cur = conn.cursor()
        cur.execute("SELECT 1")
        result = cur.fetchone()
        cur.close()
        conn.close()

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{now}] ✅ 心跳成功! SELECT 1 返回: {result[0]}")
        return True

    except Exception as e:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{now}] ❌ 心跳失败: {e}")
        return False

if __name__ == "__main__":
    success = heartbeat()
    sys.exit(0 if success else 1)
