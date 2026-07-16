import json
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models.repository import Repository
from app.models.box import Box
from app.models.part import Part

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./parts.db")

engine = create_engine(DATABASE_URL, connect_args={
    "check_same_thread": False} if "sqlite" in DATABASE_URL else {"charset": "utf8mb4"})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def load_json_lines(filepath):
    if not os.path.exists(filepath):
        print(f"文件不存在: {filepath}")
        return []
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    return [json.loads(line.strip()) for line in lines if line.strip()]

def migrate_repositories(db, data_dir):
    filepath = os.path.join(data_dir, 'repositories.json')
    repos_data = load_json_lines(filepath)
    
    existing_names = {r.name for r in db.query(Repository).all()}
    
    for item in repos_data:
        name = item.get('name', '未命名仓库')
        if name not in existing_names:
            repo = Repository(name=name)
            db.add(repo)
            existing_names.add(name)
    
    db.commit()
    print(f"迁移仓库: {len(repos_data)} 条记录")

def migrate_boxes(db, data_dir):
    filepath = os.path.join(data_dir, 'boxes.json')
    boxes_data = load_json_lines(filepath)
    
    repo_name_to_id = {r.name: r.id for r in db.query(Repository).all()}
    
    for item in boxes_data:
        repository_id = item.get('repository_id')
        if isinstance(repository_id, str):
            repository_id = int(repository_id)
        
        box_number = item.get('box_number', 0)
        name = item.get('name', '新盒子')
        
        if repository_id and repository_id in repo_name_to_id.values():
            existing_box = db.query(Box).filter(
                Box.repository_id == repository_id,
                Box.box_number == box_number
            ).first()
            if not existing_box:
                box = Box(
                    box_number=box_number,
                    name=name,
                    repository_id=repository_id
                )
                db.add(box)
    
    db.commit()
    print(f"迁移盒子: {len(boxes_data)} 条记录")

def migrate_parts(db, data_dir):
    filepath = os.path.join(data_dir, 'parts.json')
    parts_data = load_json_lines(filepath)
    
    for item in parts_data:
        part_num = item.get('part_num', '')
        name = item.get('name', '')
        color_id = item.get('color_id', 0)
        is_new = item.get('is_new', False)
        quantity = item.get('quantity', 0)
        box_id = item.get('box_id')
        
        if isinstance(box_id, str):
            box_id = int(box_id)
        
        if part_num and box_id:
            existing_part = db.query(Part).filter(
                Part.box_id == box_id,
                Part.part_num == part_num,
                Part.color_id == color_id
            ).first()
            if not existing_part:
                part = Part(
                    part_num=part_num,
                    name=name,
                    color_id=color_id,
                    is_new=is_new,
                    quantity=quantity,
                    box_id=box_id
                )
                db.add(part)
    
    db.commit()
    print(f"迁移零件: {len(parts_data)} 条记录")

def main():
    data_dir = os.path.join(os.path.dirname(__file__), '../PWA/migration_data')
    
    print("开始创建数据库表...")
    Base.metadata.create_all(bind=engine)
    
    print("开始数据迁移...")
    db = SessionLocal()
    
    try:
        migrate_repositories(db, data_dir)
        migrate_boxes(db, data_dir)
        migrate_parts(db, data_dir)
        print("数据迁移完成！")
    except Exception as e:
        print(f"迁移过程中发生错误: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    main()