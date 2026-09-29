from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import event
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./parts.db")

is_postgres = DATABASE_URL.startswith("postgresql://")

if is_postgres:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"sslmode": "require"},
        pool_size=10,
        max_overflow=20,
    )
else:
    DATA_DIR = os.getenv("DATA_DIR", "./")
    db_path = DATABASE_URL.replace("sqlite:///", "")
    db_dir = os.path.dirname(db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    from app.backup import download_from_cos
    if not os.path.exists(db_path):
        download_from_cos(db_path)

    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

    def set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    event.listen(engine, "connect", set_sqlite_pragmas)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
