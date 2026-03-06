from __future__ import annotations

import json
from dataclasses import dataclass

from .enums import UserRole


@dataclass(frozen=True)
class PermissionDefinition:
    code: str
    label: str
    description: str
    roles: tuple[str, ...]


PERMISSION_DEFINITIONS: tuple[PermissionDefinition, ...] = (
    PermissionDefinition(
        code="manager.dashboard.view",
        label="عرض لوحة المتابعة",
        description="عرض مؤشرات التشغيل الرئيسية في لوحة المتابعة.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.orders.view",
        label="عرض الطلبات",
        description="عرض قوائم الطلبات وتفاصيلها.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.orders.manage",
        label="إدارة الطلبات",
        description="إنشاء وتحديث حالات الطلبات والتحصيل.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.tables.view",
        label="عرض الطاولات",
        description="عرض الطاولات والجلسات الحالية.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.tables.manage",
        label="إدارة الطاولات",
        description="إضافة وتعديل الطاولات وتسوية الجلسات.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.kitchen_monitor.view",
        label="عرض مراقبة المطبخ",
        description="عرض طلبات المطبخ ولوحة المتابعة.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.delivery.view",
        label="عرض التوصيل",
        description="عرض بيانات فريق التوصيل والمهام.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.delivery.manage",
        label="إدارة التوصيل",
        description="إدارة السائقين وإعدادات وسياسات التوصيل.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.products.view",
        label="عرض المنتجات",
        description="عرض المنتجات والتصنيفات.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.products.manage",
        label="إدارة المنتجات",
        description="إضافة وتعديل المنتجات والتصنيفات.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.warehouse.view",
        label="عرض المخزن",
        description="عرض أرصدة وسجلات وسندات المخزن.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.warehouse.manage",
        label="إدارة المخزن",
        description="إدارة سندات الإدخال والصرف والجرد.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.financial.view",
        label="عرض العمليات المالية",
        description="عرض القيود المالية وسجل الإغلاقات.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.financial.manage",
        label="إدارة العمليات المالية",
        description="إغلاق الورديات وتنفيذ الإجراءات المالية.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.expenses.view",
        label="عرض المصروفات",
        description="عرض المصروفات ومرفقاتها ومراكز التكلفة.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.expenses.manage",
        label="إدارة المصروفات",
        description="إضافة ومراجعة واعتماد المصروفات.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.reports.view",
        label="عرض التقارير",
        description="الوصول إلى جميع تقارير الأداء والتصدير.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.users.view",
        label="عرض المستخدمين",
        description="عرض حسابات الفريق وصلاحياتها.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.users.manage",
        label="إدارة المستخدمين",
        description="إضافة وتعديل وحذف المستخدمين وضبط صلاحياتهم.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.settings.view",
        label="عرض الإعدادات",
        description="عرض إعدادات التشغيل والحساب والنسخ الاحتياطي.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.settings.manage",
        label="إدارة الإعدادات",
        description="تعديل إعدادات النظام والحساب والنسخ الاحتياطي.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="manager.audit.view",
        label="عرض سجل التدقيق",
        description="الوصول إلى سجلات التدقيق والتتبع.",
        roles=(UserRole.MANAGER.value,),
    ),
    PermissionDefinition(
        code="kitchen.orders.view",
        label="عرض طلبات المطبخ",
        description="عرض الطلبات المرسلة للمطبخ.",
        roles=(UserRole.KITCHEN.value,),
    ),
    PermissionDefinition(
        code="kitchen.orders.manage",
        label="تحديث حالات المطبخ",
        description="بدء التحضير وتأكيد الجاهزية.",
        roles=(UserRole.KITCHEN.value,),
    ),
    PermissionDefinition(
        code="delivery.assignments.view",
        label="عرض مهام التوصيل",
        description="عرض المهام المسندة لسائق التوصيل.",
        roles=(UserRole.DELIVERY.value,),
    ),
    PermissionDefinition(
        code="delivery.orders.view",
        label="عرض طلبات التوصيل",
        description="عرض طلبات التوصيل المتاحة والنشطة.",
        roles=(UserRole.DELIVERY.value,),
    ),
    PermissionDefinition(
        code="delivery.orders.claim",
        label="استلام طلب للتوصيل",
        description="استلام طلب من قائمة التوصيل.",
        roles=(UserRole.DELIVERY.value,),
    ),
    PermissionDefinition(
        code="delivery.orders.manage",
        label="تحديث حالات التوصيل",
        description="تأكيد الانطلاق والتسليم أو فشل التوصيل.",
        roles=(UserRole.DELIVERY.value,),
    ),
    PermissionDefinition(
        code="delivery.history.view",
        label="عرض سجل التوصيل",
        description="عرض السجل التاريخي لعمليات التوصيل.",
        roles=(UserRole.DELIVERY.value,),
    ),
)

PERMISSION_BY_CODE: dict[str, PermissionDefinition] = {item.code: item for item in PERMISSION_DEFINITIONS}

ROLE_DEFAULT_PERMISSIONS: dict[str, set[str]] = {
    UserRole.MANAGER.value: {item.code for item in PERMISSION_DEFINITIONS if UserRole.MANAGER.value in item.roles},
    UserRole.KITCHEN.value: {item.code for item in PERMISSION_DEFINITIONS if UserRole.KITCHEN.value in item.roles},
    UserRole.DELIVERY.value: {item.code for item in PERMISSION_DEFINITIONS if UserRole.DELIVERY.value in item.roles},
}


def role_assignable_permissions(role: str) -> set[str]:
    return set(ROLE_DEFAULT_PERMISSIONS.get(role, set()))


def parse_permission_overrides(raw_value: str | None) -> dict[str, list[str]]:
    fallback = {"allow": [], "deny": []}
    if not raw_value:
        return fallback
    try:
        payload = json.loads(raw_value)
    except Exception:  # noqa: BLE001
        return fallback
    if not isinstance(payload, dict):
        return fallback
    allow_raw = payload.get("allow", [])
    deny_raw = payload.get("deny", [])
    if not isinstance(allow_raw, list) or not isinstance(deny_raw, list):
        return fallback
    allow = sorted({str(item).strip() for item in allow_raw if str(item).strip()})
    deny = sorted({str(item).strip() for item in deny_raw if str(item).strip()})
    return {"allow": allow, "deny": deny}


def serialize_permission_overrides(*, allow: list[str], deny: list[str]) -> str | None:
    normalized_allow = sorted({item.strip() for item in allow if item and item.strip()})
    normalized_deny = sorted({item.strip() for item in deny if item and item.strip()})
    if not normalized_allow and not normalized_deny:
        return None
    return json.dumps({"allow": normalized_allow, "deny": normalized_deny}, ensure_ascii=False)


def normalize_overrides_for_role(*, role: str, allow: list[str], deny: list[str]) -> tuple[list[str], list[str]]:
    allowed_codes = role_assignable_permissions(role)
    normalized_allow = sorted({item.strip() for item in allow if item and item.strip() and item.strip() in allowed_codes})
    normalized_deny = sorted({item.strip() for item in deny if item and item.strip() and item.strip() in allowed_codes})
    if normalized_allow:
        deny_set = set(normalized_deny)
        normalized_allow = [item for item in normalized_allow if item not in deny_set]
    return normalized_allow, normalized_deny


def effective_permissions(role: str, overrides_raw: str | None = None) -> set[str]:
    base = set(ROLE_DEFAULT_PERMISSIONS.get(role, set()))
    overrides = parse_permission_overrides(overrides_raw)
    allow, deny = normalize_overrides_for_role(role=role, allow=overrides["allow"], deny=overrides["deny"])
    base.update(allow)
    for denied_code in deny:
        base.discard(denied_code)
    return base


def permissions_catalog(*, role: str | None = None) -> list[dict[str, object]]:
    if role is None:
        items = PERMISSION_DEFINITIONS
    else:
        items = tuple(item for item in PERMISSION_DEFINITIONS if role in item.roles)
    return [
        {
            "code": item.code,
            "label": item.label,
            "description": item.description,
            "roles": list(item.roles),
        }
        for item in items
    ]

