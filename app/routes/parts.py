from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
import re
import urllib.request
import urllib.error
import logging
from app.database import get_db
from app.models.part import Part
from app.models.part_weight import PartWeight
from app.schemas.part import PartCreate, PartUpdate, Part as PartSchema

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/", response_model=PartSchema)
def create_part(part: PartCreate, db: Session = Depends(get_db)):
    db_part = Part(
        part_num=part.part_num,
        name=part.name,
        color_id=part.color_id,
        is_new=part.is_new,
        quantity=part.quantity,
        box_id=part.box_id
    )
    db.add(db_part)
    db.commit()
    db.refresh(db_part)
    return db_part

@router.get("/", response_model=List[PartSchema])
def get_parts(box_id: int = None, db: Session = Depends(get_db)):
    if box_id:
        return db.query(Part).filter(Part.box_id == box_id).all()
    return db.query(Part).all()

@router.get("/weight")
def get_part_weight_from_bricklink(
    part_number: str = Query(..., description="零件型号，如3001"),
    db: Session = Depends(get_db),
):
    """根据零件型号查询单个零件重量（克）。

    优先读 Supabase part_weights 缓存；未命中则从 Bricklink 抓取并回写缓存。
    本地 FastAPI 走本机 IP 抓取（可成功），生产环境依赖缓存。

    端点：GET /api/parts/weight?part_number=3001
    返回：{"part_number": "3001", "weight": 2.08} 或 {"part_number": "...", "weight": null, "error": "..."}
    """
    clean_num = "".join(c for c in part_number if c.isalnum())
    if not clean_num:
        raise HTTPException(status_code=400, detail="零件型号无效")

    # 1. 优先读 Supabase 重量缓存
    cached = db.query(PartWeight).filter(PartWeight.part_num == clean_num).first()
    if cached and cached.weight:
        logger.info(f"重量缓存命中: {clean_num} = {cached.weight}g")
        return {"part_number": clean_num, "weight": cached.weight}

    # 2. 缓存未命中，从 Bricklink 抓取（本机 IP）
    url = f"https://www.bricklink.com/v2/catalog/catalogitem.page?P={clean_num}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive",
    }

    last_error = None
    for attempt in range(1, 4):
        try:
            logger.info(f"Bricklink 重量查询 (尝试 {attempt}/3): {clean_num}")
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status != 200:
                    last_error = f"HTTP {resp.status}"
                    continue
                data = resp.read()
                encoding = "utf-8"
                try:
                    html = data.decode(encoding)
                except UnicodeDecodeError:
                    html = data.decode("latin-1", errors="ignore")
            weight = _extract_weight_from_html(html)
            if weight is not None:
                logger.info(f"Bricklink 重量查询成功: {clean_num} = {weight}g")
                # 3. 回写 Supabase 缓存（upsert by part_num 主键）
                db.merge(PartWeight(part_num=clean_num, weight=weight))
                db.commit()
                return {"part_number": clean_num, "weight": weight}
            last_error = "未在页面中找到重量数据"
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code}"
            if e.code == 404:
                return {"part_number": clean_num, "weight": None, "error": "Bricklink 上未找到该零件"}
        except Exception as e:
            last_error = str(e)
            logger.warning(f"Bricklink 重量查询失败 (尝试 {attempt}): {e}")

    return {"part_number": clean_num, "weight": None, "error": last_error or "查询失败"}

@router.get("/{part_id}", response_model=PartSchema)
def get_part(part_id: int, db: Session = Depends(get_db)):
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(status_code=404, detail="零件不存在")
    return part

@router.put("/{part_id}", response_model=PartSchema)
def update_part(part_id: int, part: PartUpdate, db: Session = Depends(get_db)):
    db_part = db.query(Part).filter(Part.id == part_id).first()
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    if part.part_num:
        db_part.part_num = part.part_num
    if part.name:
        db_part.name = part.name
    if part.color_id is not None:
        db_part.color_id = part.color_id
    if part.is_new is not None:
        db_part.is_new = part.is_new
    if part.quantity is not None:
        db_part.quantity = part.quantity
    if part.box_id is not None:
        db_part.box_id = part.box_id
    db.commit()
    db.refresh(db_part)
    return db_part

@router.delete("/{part_id}")
def delete_part(part_id: int, db: Session = Depends(get_db)):
    db_part = db.query(Part).filter(Part.id == part_id).first()
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    db.delete(db_part)
    db.commit()
    return {"message": "零件删除成功"}

@router.post("/batch", response_model=List[PartSchema])
def batch_create_parts(parts: List[PartCreate], db: Session = Depends(get_db)):
    created_parts = []
    for part_data in parts:
        db_part = Part(
            part_num=part_data.part_num,
            name=part_data.name,
            color_id=part_data.color_id,
            is_new=part_data.is_new,
            quantity=part_data.quantity,
            box_id=part_data.box_id
        )
        db.add(db_part)
        created_parts.append(db_part)
    db.commit()
    for part in created_parts:
        db.refresh(part)
    return created_parts


def _extract_weight_from_html(html: str):
    """从 Bricklink HTML 内容中提取单个零件重量（克）。

    算法参考 tem/partwall_pythonista.py 与 tem/AddPartView.swift：
    先查找 "Weight:"/"Weight：" 关键字后的数字，再回退到 "数字 g" 模式。
    """
    patterns = ["Weight：", "Weight:", "weight：", "weight:"]
    for pattern in patterns:
        idx = html.find(pattern)
        if idx != -1:
            segment = html[idx:idx + 100]
            m = re.search(r"(\d+(?:\.\d+)?)", segment)
            if m:
                try:
                    w = float(m.group(1))
                    if w > 0:
                        return round(w, 4)
                except ValueError:
                    pass
    # 回退：查找 "数字 g" 模式
    m = re.search(r"(\d+(?:\.\d+)?)\s*g", html)
    if m:
        try:
            w = float(m.group(1))
            if w > 0:
                return round(w, 4)
        except ValueError:
            pass
    return None



