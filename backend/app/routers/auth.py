import secrets
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import load_settings
from ..dependencies import get_current_user, get_db
from ..models import User
from ..schemas import AuthSessionOut, LoginInput, RefreshInput, UserOut
from ..security import ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS
from ..services import login_user, record_security_event, refresh_user_tokens, revoke_refresh_token

router = APIRouter(prefix="/auth", tags=["auth"])
SETTINGS = load_settings()
COOKIE_SECURE = SETTINGS.is_production
COOKIE_SAMESITE = "none" if SETTINGS.is_production else "lax"
COOKIE_DOMAIN = SETTINGS.cookie_domain
ACCESS_COOKIE_NAME = "access_token"
REFRESH_COOKIE_NAME = "refresh_token"
CSRF_COOKIE_NAME = "csrf_token"

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)]
CsrfCookie = Annotated[str | None, Cookie(alias=CSRF_COOKIE_NAME)]


def _client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()[:64]
    if request.client and request.client.host:
        return str(request.client.host)[:64]
    return None


def _user_agent(request: Request) -> str | None:
    raw = request.headers.get("user-agent")
    if not raw:
        return None
    return raw.strip()[:255]


def _set_auth_cookies(response: Response, *, access_token: str, refresh_token: str) -> None:
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=ACCESS_TOKEN_TTL_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE_NAME, path="/", domain=COOKIE_DOMAIN)
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/", domain=COOKIE_DOMAIN)
    response.delete_cookie(CSRF_COOKIE_NAME, path="/", domain=COOKIE_DOMAIN)


def _validate_csrf(request: Request, *, csrf_cookie: str | None) -> None:
    csrf_header = request.headers.get("x-csrf-token")
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")


@router.post("/login", response_model=AuthSessionOut)
def login(
    payload: LoginInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthSessionOut:
    ip_address = _client_ip(request)
    user_agent = _user_agent(request)
    try:
        user, access_token, refresh_token = login_user(
            db,
            username=payload.username,
            password=payload.password,
            role=payload.role.value,
        )
        _set_auth_cookies(response, access_token=access_token, refresh_token=refresh_token)
        record_security_event(
            db,
            event_type="login_success",
            success=True,
            severity="info",
            username=user.username,
            role=user.role,
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
            detail="Successful login.",
        )
        return AuthSessionOut(user=user)
    except HTTPException as error:
        record_security_event(
            db,
            event_type="login_failed",
            success=False,
            severity="warning",
            username=payload.username,
            role=payload.role.value,
            ip_address=ip_address,
            user_agent=user_agent,
            detail=str(error.detail),
        )
        raise
    except Exception:
        record_security_event(
            db,
            event_type="login_failed",
            success=False,
            severity="critical",
            username=payload.username,
            role=payload.role.value,
            ip_address=ip_address,
            user_agent=user_agent,
            detail="Unexpected login failure.",
        )
        raise


@router.post("/refresh", response_model=AuthSessionOut)
def refresh(
    request: Request,
    response: Response,
    payload: RefreshInput | None = None,
    refresh_cookie: RefreshCookie = None,
    csrf_cookie: CsrfCookie = None,
    db: Session = Depends(get_db),
) -> AuthSessionOut:
    ip_address = _client_ip(request)
    user_agent = _user_agent(request)
    token = payload.refresh_token if payload is not None else None
    if not token and refresh_cookie:
        _validate_csrf(request, csrf_cookie=csrf_cookie)
        token = refresh_cookie
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is required")

    try:
        user, access_token, refresh_token = refresh_user_tokens(db, token)
        _set_auth_cookies(response, access_token=access_token, refresh_token=refresh_token)
        record_security_event(
            db,
            event_type="refresh_success",
            success=True,
            severity="info",
            username=user.username,
            role=user.role,
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
            detail="Session refresh succeeded.",
        )
        return AuthSessionOut(user=user)
    except HTTPException as error:
        record_security_event(
            db,
            event_type="refresh_failed",
            success=False,
            severity="warning",
            ip_address=ip_address,
            user_agent=user_agent,
            detail=str(error.detail),
        )
        raise
    except Exception:
        record_security_event(
            db,
            event_type="refresh_failed",
            success=False,
            severity="critical",
            ip_address=ip_address,
            user_agent=user_agent,
            detail="Unexpected refresh failure.",
        )
        raise


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    payload: RefreshInput | None = None,
    refresh_cookie: RefreshCookie = None,
    csrf_cookie: CsrfCookie = None,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    ip_address = _client_ip(request)
    user_agent = _user_agent(request)
    token = payload.refresh_token if payload is not None else None
    if not token and refresh_cookie:
        _validate_csrf(request, csrf_cookie=csrf_cookie)
        token = refresh_cookie

    user_id = None
    revoked = False
    if token:
        user_id, revoked = revoke_refresh_token(db, token)
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none() if user_id else None

    _clear_auth_cookies(response)
    record_security_event(
        db,
        event_type="logout",
        success=bool(revoked),
        severity="info" if revoked else "warning",
        username=user.username if user else None,
        role=user.role if user else None,
        user_id=user.id if user else None,
        ip_address=ip_address,
        user_agent=user_agent,
        detail="Session terminated." if revoked else "Session token missing/invalid during logout.",
    )
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
