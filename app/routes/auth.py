import hashlib
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User

router = APIRouter()

# 简单的 session 存储（生产环境建议用 Redis）
# key: token, value: {"phone": str, "expires_at": datetime}
_sessions = {}

# 默认管理员账号
DEFAULT_ADMINS = [
    {"phone": "18923232468", "password": "22332468"},
    {"phone": "18923222468", "password": "22332468"},
]

SESSION_EXPIRE_HOURS = 72


def _hash_password(password: str) -> str:
    """简单的密码哈希（生产环境建议用 bcrypt/argon2）"""
    salt = "lego_rb_system_v1"  # 固定盐
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()


def _verify_password(password: str, password_hash: str) -> bool:
    return _hash_password(password) == password_hash


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """从请求头 Authorization 中解析当前用户"""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()

    if not token or token not in _sessions:
        raise HTTPException(status_code=401, detail="未登录")

    session = _sessions[token]
    if datetime.utcnow() > session["expires_at"]:
        del _sessions[token]
        raise HTTPException(status_code=401, detail="登录已过期")

    user = db.query(User).filter(User.phone == session["phone"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


class LoginRequest(BaseModel):
    phone: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/login")
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """手机号+密码登录"""
    if not req.phone or not req.password:
        raise HTTPException(status_code=400, detail="手机号和密码不能为空")

    user = db.query(User).filter(User.phone == req.phone.strip()).first()
    if not user:
        raise HTTPException(status_code=401, detail="手机号或密码错误")

    if not _verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="手机号或密码错误")

    token = secrets.token_hex(32)
    _sessions[token] = {
        "phone": user.phone,
        "expires_at": datetime.utcnow() + timedelta(hours=SESSION_EXPIRE_HOURS),
    }

    # 跨域时把 token 也放到 Cookie 备选
    from fastapi.responses import JSONResponse
    response = JSONResponse({
        "token": token,
        "phone": user.phone,
        "expires_in": SESSION_EXPIRE_HOURS * 3600,
    })
    response.set_cookie(
        key="auth_token",
        value=token,
        httponly=False,
        samesite="lax",
        max_age=SESSION_EXPIRE_HOURS * 3600,
    )
    return response


@router.post("/logout")
def logout(request: Request):
    """退出登录"""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    if token in _sessions:
        del _sessions[token]

    from fastapi.responses import JSONResponse
    response = JSONResponse({"message": "已退出"})
    response.delete_cookie("auth_token")
    return response


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    """获取当前登录用户信息"""
    return {
        "phone": current_user.phone,
        "is_admin": bool(current_user.is_admin),
    }


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """修改密码（需要登录态）"""
    if not _verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")

    if not req.new_password or len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="新密码至少 4 位")

    current_user.password_hash = _hash_password(req.new_password)
    db.commit()
    return {"message": "密码修改成功"}


@router.post("/init-default-users")
def init_default_users(db: Session = Depends(get_db)):
    """初始化默认管理员（幂等）。可在启动时调用一次。"""
    created = []
    for admin in DEFAULT_ADMINS:
        existing = db.query(User).filter(User.phone == admin["phone"]).first()
        if not existing:
            user = User(
                phone=admin["phone"],
                password_hash=_hash_password(admin["password"]),
                is_admin=1,
            )
            db.add(user)
            created.append(admin["phone"])
    db.commit()
    return {"created": created, "message": "初始化完成"}
