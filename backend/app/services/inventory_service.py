from . import shared as _shared

globals().update({name: getattr(_shared, name) for name in _shared.__all__})


def _normalize_category_name(name: str) -> str:
    normalized = " ".join(name.split()).strip()
    if len(normalized) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم التصنيف غير صالح.")
    return normalized

def _is_protected_product_category(name: str) -> bool:
    return _normalize_category_name(name).lower() in PROTECTED_PRODUCT_CATEGORY_NAMES_LOWER

def get_product_category_or_404(db: Session, category_id: int) -> ProductCategory:
    category = db.execute(select(ProductCategory).where(ProductCategory.id == category_id)).scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="التصنيف غير موجود.")
    return category

def list_product_categories_service(
    db: Session,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> list[ProductCategory]:
    safe_offset, safe_limit = _normalize_offset_limit(offset=offset, limit=limit, max_limit=500)
    stmt = (
        select(ProductCategory)
        .order_by(ProductCategory.sort_order.asc(), ProductCategory.id.asc())
        .offset(safe_offset)
    )
    if safe_limit is not None:
        stmt = stmt.limit(safe_limit)
    return db.execute(stmt).scalars().all()

def create_product_category_service(
    db: Session,
    *,
    name: str,
    active: bool,
    sort_order: int,
) -> ProductCategory:
    normalized_name = _normalize_category_name(name)
    existing = db.execute(
        select(ProductCategory).where(func.lower(ProductCategory.name) == normalized_name.lower())
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم التصنيف موجود مسبقًا.")

    category = ProductCategory(name=normalized_name, active=active, sort_order=sort_order)
    with transaction_scope(db):
        db.add(category)
    return category

def update_product_category_service(
    db: Session,
    *,
    category_id: int,
    name: str,
    active: bool,
    sort_order: int,
) -> ProductCategory:
    category = get_product_category_or_404(db, category_id)
    if _is_protected_product_category(category.name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن تعديل التصنيف الافتراضي.",
        )

    normalized_name = _normalize_category_name(name)
    existing = db.execute(
        select(ProductCategory).where(
            func.lower(ProductCategory.name) == normalized_name.lower(),
            ProductCategory.id != category_id,
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="اسم التصنيف موجود مسبقًا.")

    with transaction_scope(db):
        category.name = normalized_name
        category.active = active
        category.sort_order = sort_order
        db.execute(
            update(Product)
            .where(Product.category_id == category_id)
            .values(category=normalized_name)
        )
        if not active:
            db.execute(
                update(Product)
                .where(Product.category_id == category_id)
                .values(available=False)
            )
    return category

def delete_product_category_service(db: Session, *, category_id: int) -> None:
    category = get_product_category_or_404(db, category_id)
    if _is_protected_product_category(category.name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن حذف التصنيف الافتراضي.",
        )

    linked_products = db.execute(
        select(func.count(Product.id)).where(Product.category_id == category_id)
    ).scalar_one()
    if int(linked_products or 0) > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يمكن حذف تصنيف مرتبط بمنتجات.")

    with transaction_scope(db):
        db.delete(category)

def create_product_service(
    db: Session,
    *,
    name: str,
    description: str | None,
    price: float,
    kind: ProductKind,
    available: bool,
    category_id: int,
) -> Product:
    category = get_product_category_or_404(db, category_id)
    if not category.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="التصنيف غير نشط.")

    with transaction_scope(db):
        product = Product(
            name=name,
            description=description,
            price=price,
            kind=kind.value,
            available=available if kind == ProductKind.SELLABLE else False,
            category=category.name,
            category_id=category.id,
            is_archived=False,
        )
        db.add(product)

    return db.execute(select(Product).where(Product.id == product.id)).scalar_one()

def update_product_service(
    db: Session,
    *,
    product_id: int,
    name: str,
    description: str | None,
    price: float,
    kind: ProductKind,
    available: bool,
    category_id: int,
    is_archived: bool | None,
) -> Product:
    category = get_product_category_or_404(db, category_id)
    if not category.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="التصنيف غير نشط.")

    product = db.execute(select(Product).where(Product.id == product_id)).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المنتج غير موجود.")

    with transaction_scope(db):
        product.name = name
        product.description = description
        product.price = price
        product.kind = kind.value
        product.available = available if kind == ProductKind.SELLABLE else False
        product.category = category.name
        product.category_id = category.id
        if is_archived is not None:
            product.is_archived = is_archived
        if product.is_archived:
            product.available = False

    return db.execute(select(Product).where(Product.id == product_id)).scalar_one()

def archive_product_service(db: Session, *, product_id: int) -> None:
    product = db.execute(select(Product).where(Product.id == product_id)).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المنتج غير موجود.")

    with transaction_scope(db):
        product.is_archived = True
        product.available = False

def delete_product_permanently_service(db: Session, *, product_id: int) -> None:
    product = db.execute(select(Product).where(Product.id == product_id)).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المنتج غير موجود.")
    if not bool(product.is_archived):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن الحذف النهائي إلا بعد أرشفة المنتج.",
        )

    linked_order_items = int(
        db.execute(select(func.count(OrderItem.id)).where(OrderItem.product_id == product_id)).scalar_one()
        or 0
    )
    linked_cost_entries = int(
        db.execute(select(func.count(OrderCostEntry.id)).where(OrderCostEntry.product_id == product_id)).scalar_one()
        or 0
    )
    if linked_order_items > 0 or linked_cost_entries > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="لا يمكن حذف المنتج نهائيًا لأنه مرتبط بسجلات طلبات سابقة.",
        )

    image_path = product.image_path
    with transaction_scope(db):
        db.delete(product)
    _remove_static_file(image_path)

def upload_product_image_service(
    db: Session,
    *,
    product_id: int,
    data_base64: str,
    mime_type: str,
) -> Product:
    product = db.execute(select(Product).where(Product.id == product_id)).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المنتج غير موجود.")

    with transaction_scope(db):
        product.image_path = save_product_image(
            data_base64=data_base64,
            mime_type=mime_type,
            old_path=product.image_path,
        )
    return db.execute(select(Product).where(Product.id == product_id)).scalar_one()

def save_product_image(*, data_base64: str, mime_type: str, old_path: str | None = None) -> str:
    if mime_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="نوع الصورة غير مدعوم.")

    try:
        data = base64.b64decode(data_base64, validate=True)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="بيانات الصورة غير صالحة.") from error

    if len(data) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="حجم الصورة يتجاوز الحد الأقصى.")

    PRODUCT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename: str
    full_path: Path

    try:
        from PIL import Image

        try:
            image = Image.open(BytesIO(data))
            image = image.convert("RGB")
        except Exception as error:  # noqa: BLE001
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ملف الصورة غير صالح.") from error

        image.thumbnail((1200, 1200))
        filename = f"{uuid4().hex}.webp"
        full_path = PRODUCT_UPLOAD_DIR / filename
        image.save(full_path, format="WEBP", quality=85, method=6)
    except ModuleNotFoundError:
        # Fallback mode when Pillow is unavailable: keep original bytes after signature validation.
        signatures = {
            "image/jpeg": (b"\xFF\xD8\xFF", ".jpg"),
            "image/png": (b"\x89PNG\r\n\x1A\n", ".png"),
            "image/webp": (b"RIFF", ".webp"),
        }
        expected_header, extension = signatures[mime_type]
        is_valid = data.startswith(expected_header)
        if mime_type == "image/webp":
            is_valid = data.startswith(b"RIFF") and b"WEBP" in data[:16]
        if not is_valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ملف الصورة غير صالح.")

        filename = f"{uuid4().hex}{extension}"
        full_path = PRODUCT_UPLOAD_DIR / filename
        full_path.write_bytes(data)

    if old_path:
        old = Path(__file__).resolve().parent.parent / old_path.lstrip("/").replace("/", "\\")
        if old.exists() and old.is_file():
            old.unlink()

    return f"/static/uploads/products/{filename}"

def _remove_static_file(file_url: str | None) -> None:
    if not file_url:
        return
    relative = file_url.lstrip("/")
    if not relative:
        return
    full_path = Path(__file__).resolve().parent.parent / Path(relative)
    if full_path.exists() and full_path.is_file():
        full_path.unlink()

def _sanitize_attachment_name(raw_name: str | None, *, fallback_stem: str) -> str:
    source = (raw_name or fallback_stem).strip()
    if not source:
        source = fallback_stem
    source = Path(source).name
    safe = "".join(ch if (ch.isalnum() or ch in {"-", "_", ".", " "}) else "_" for ch in source).strip(" .")
    return safe or fallback_stem

def _validate_attachment_signature(*, mime_type: str, data: bytes) -> None:
    if mime_type == "application/pdf":
        if not data.startswith(b"%PDF"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ملف PDF غير صالح.")
        return
    if mime_type == "image/jpeg":
        if not data.startswith(b"\xFF\xD8\xFF"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ملف الصورة غير صالح.")
        return
    if mime_type == "image/png":
        if not data.startswith(b"\x89PNG\r\n\x1A\n"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ملف الصورة غير صالح.")
        return
    if mime_type == "image/webp":
        if not (data.startswith(b"RIFF") and b"WEBP" in data[:16]):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ملف الصورة غير صالح.")
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="نوع المرفق غير مدعوم.")

def save_expense_attachment(*, data_base64: str, mime_type: str, file_name: str | None) -> tuple[str, str, int]:
    extension = ALLOWED_EXPENSE_ATTACHMENT_TYPES.get(mime_type)
    if extension is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="نوع المرفق غير مدعوم.")

    try:
        data = base64.b64decode(data_base64, validate=True)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="بيانات المرفق غير صالحة.") from error

    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="المرفق فارغ.")
    if len(data) > MAX_EXPENSE_ATTACHMENT_SIZE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="حجم المرفق يتجاوز الحد الأقصى.")

    _validate_attachment_signature(mime_type=mime_type, data=data)
    EXPENSE_ATTACHMENT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    safe_name = _sanitize_attachment_name(file_name, fallback_stem="expense_attachment")
    safe_stem = Path(safe_name).stem.strip() or "expense_attachment"
    final_name = f"{safe_stem}{extension}"
    stored_name = f"{uuid4().hex}_{final_name}"
    full_path = EXPENSE_ATTACHMENT_UPLOAD_DIR / stored_name
    full_path.write_bytes(data)
    return f"/static/uploads/expenses/{stored_name}", final_name, len(data)
