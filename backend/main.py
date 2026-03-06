from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import load_settings
from app.database import Base, SessionLocal, assert_production_migration_state, engine, run_startup_integrity_checks
from app.routers import auth, delivery, kitchen, manager, public, warehouse
from app.seed import bootstrap_production_data, seed_development_data
from app.text_sanitizer import sanitize_payload

SETTINGS = load_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if SETTINGS.is_production:
        assert_production_migration_state(
            engine,
            version_table=SETTINGS.migration_version_table,
            expected_revision=SETTINGS.schema_expected_revision,
        )
    else:
        Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if SETTINGS.is_production:
            bootstrap_production_data(db)
        else:
            seed_development_data(db)
    finally:
        db.close()
    run_startup_integrity_checks(engine)
    yield


app = FastAPI(
    title="Restaurant On-Prem API",
    version="1.0.0",
    lifespan=lifespan,
    debug=SETTINGS.debug,
    docs_url=None if SETTINGS.is_production else "/docs",
    redoc_url=None if SETTINGS.is_production else "/redoc",
    openapi_url=None if SETTINGS.is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(SETTINGS.cors_allow_origins),
    allow_credentials=bool(SETTINGS.cors_allow_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def sanitized_http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    detail = sanitize_payload(exc.detail, fallback="Request processing failed.")
    return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def sanitized_validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    detail = sanitize_payload(exc.errors(), fallback="Invalid input value.")
    return JSONResponse(status_code=422, content={"detail": detail})


if SETTINGS.expose_diagnostic_endpoints:
    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(public.router, prefix="/api")
app.include_router(manager.router, prefix="/api")
app.include_router(warehouse.router, prefix="/api")
app.include_router(kitchen.router, prefix="/api")
app.include_router(delivery.router, prefix="/api")

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
