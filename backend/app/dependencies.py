from collections.abc import Callable
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import SessionLocal
from .enums import UserRole
from .models import User
from .permissions import effective_permissions
from .security import decode_access_token
from .services import record_security_event


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


AuthorizationHeader = Annotated[str | None, Header(alias="Authorization")]
AccessTokenCookie = Annotated[str | None, Cookie(alias="access_token")]
CsrfHeader = Annotated[str | None, Header(alias="X-CSRF-Token")]
CsrfCookie = Annotated[str | None, Cookie(alias="csrf_token")]
SAFE_HTTP_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_current_user(
    request: Request,
    authorization: AuthorizationHeader = None,
    access_token_cookie: AccessTokenCookie = None,
    csrf_header: CsrfHeader = None,
    csrf_cookie: CsrfCookie = None,
    db: Session = Depends(get_db),
) -> User:
    token: str | None = None
    using_cookie_auth = False
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    elif access_token_cookie:
        token = access_token_cookie.strip()
        using_cookie_auth = True

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials are missing",
        )

    if using_cookie_auth and request.method.upper() not in SAFE_HTTP_METHODS:
        if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed",
            )

    try:
        payload = decode_access_token(token)
        user_id = int(payload.get("sub", 0))
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
        )

    user = db.execute(select(User).where(User.id == user_id, User.active.is_(True))).scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is missing or inactive",
        )
    return user


def require_roles(*allowed: UserRole) -> Callable[[User], User]:
    allowed_values = {role.value for role in allowed}

    def _check(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied for this role",
            )
        return current_user

    return _check


def _strip_api_prefix(path: str) -> str:
    normalized = path.strip() or "/"
    if normalized.startswith("/api/"):
        return normalized[4:]
    if normalized == "/api":
        return "/"
    return normalized


def _resolve_manager_capability(path: str, method: str) -> str | None:
    if path.startswith("/manager/warehouse"):
        return "manager.warehouse.view" if method == "GET" else "manager.warehouse.manage"
    if path.startswith("/manager/dashboard"):
        return "manager.dashboard.view"
    if path.startswith("/manager/orders"):
        return "manager.orders.view" if method == "GET" else "manager.orders.manage"
    if path.startswith("/manager/table-sessions") or path.startswith("/manager/tables"):
        return "manager.tables.view" if method == "GET" else "manager.tables.manage"
    if path.startswith("/manager/kitchen/orders"):
        return "manager.kitchen_monitor.view"
    if path.startswith("/manager/drivers") or path.startswith("/manager/delivery"):
        return "manager.delivery.view" if method == "GET" else "manager.delivery.manage"
    if path.startswith("/manager/products") or path.startswith("/manager/categories"):
        return "manager.products.view" if method == "GET" else "manager.products.manage"
    if path.startswith("/manager/financial"):
        return "manager.financial.view" if method == "GET" else "manager.financial.manage"
    if path.startswith("/manager/expenses"):
        return "manager.expenses.view" if method == "GET" else "manager.expenses.manage"
    if path.startswith("/manager/reports"):
        return "manager.reports.view"
    if path.startswith("/manager/users/permissions/catalog"):
        return "manager.users.view"
    if path.startswith("/manager/users/") and path.endswith("/permissions"):
        return "manager.users.view" if method == "GET" else "manager.users.manage"
    if path.startswith("/manager/users"):
        return "manager.users.view" if method == "GET" else "manager.users.manage"
    if path.startswith("/manager/account") or path.startswith("/manager/system") or path.startswith("/manager/settings"):
        return "manager.settings.view" if method == "GET" else "manager.settings.manage"
    if path.startswith("/manager/operational-capabilities"):
        return "manager.dashboard.view"
    if path.startswith("/manager/audit"):
        return "manager.audit.view"
    return None


def _resolve_kitchen_capability(path: str, method: str) -> str | None:
    if path.startswith("/kitchen/orders") or path.startswith("/kitchen/runtime-settings"):
        return "kitchen.orders.view" if method == "GET" else "kitchen.orders.manage"
    return None


def _resolve_delivery_capability(path: str, method: str, role: str) -> str | None:
    if path.startswith("/delivery/assignments"):
        if role == UserRole.MANAGER.value:
            return "manager.delivery.view"
        return "delivery.assignments.view"
    if path.startswith("/delivery/history"):
        return "delivery.history.view"
    if path.startswith("/delivery/orders/") and path.endswith("/claim"):
        return "delivery.orders.claim"
    if path.startswith("/delivery/orders/") and (
        path.endswith("/depart") or path.endswith("/delivered") or path.endswith("/failed")
    ):
        return "delivery.orders.manage"
    if path.startswith("/delivery/orders"):
        if role == UserRole.MANAGER.value:
            return "manager.delivery.view"
        return "delivery.orders.view"
    return None


def _resolve_required_capability(path: str, method: str, role: str) -> str | None:
    normalized_path = _strip_api_prefix(path)
    normalized_method = method.upper()

    if normalized_path.startswith("/manager"):
        return _resolve_manager_capability(normalized_path, normalized_method)
    if normalized_path.startswith("/kitchen"):
        return _resolve_kitchen_capability(normalized_path, normalized_method)
    if normalized_path.startswith("/delivery"):
        return _resolve_delivery_capability(normalized_path, normalized_method, role)
    return None


def require_route_capability(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    required = _resolve_required_capability(request.url.path, request.method, current_user.role)
    if required is None:
        return current_user

    granted = effective_permissions(current_user.role, current_user.permission_overrides_json)
    if required not in granted:
        forwarded_for = request.headers.get("x-forwarded-for")
        ip_address = (forwarded_for.split(",")[0].strip() if forwarded_for else (request.client.host if request.client else None))
        user_agent = request.headers.get("user-agent")
        record_security_event(
            db,
            event_type="access_denied",
            success=False,
            severity="warning",
            username=current_user.username,
            role=current_user.role,
            user_id=current_user.id,
            ip_address=ip_address,
            user_agent=user_agent,
            detail=f"Denied route {request.method.upper()} {_strip_api_prefix(request.url.path)} (required={required}).",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied for this action",
        )
    return current_user
