from __future__ import annotations

from importlib import import_module
from types import ModuleType

_MODULE_NAMES = [
    "shared",
    "session_service",
    "system_service",
    "auth_service",
    "operational_service",
    "inventory_service",
    "financial_service",
    "orders_service",
    "delivery_service",
    "reporting_service",
    "operational_heart_service",
    "user_service",
]


def _public_names(module: ModuleType) -> list[str]:
    module_all = getattr(module, "__all__", None)
    if module_all is None:
        module_all = [name for name in vars(module) if not name.startswith("_")]
    return [name for name in module_all if isinstance(name, str)]


__all__: list[str] = []
for _module_name in _MODULE_NAMES:
    _module = import_module(f"{__name__}.{_module_name}")
    for _name in _public_names(_module):
        globals()[_name] = getattr(_module, _name)
        if _name not in __all__:
            __all__.append(_name)
