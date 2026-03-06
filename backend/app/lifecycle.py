from .enums import OrderStatus, OrderType


BASE_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.CREATED: {OrderStatus.CONFIRMED, OrderStatus.CANCELED},
    OrderStatus.CONFIRMED: {OrderStatus.SENT_TO_KITCHEN, OrderStatus.CANCELED},
    OrderStatus.SENT_TO_KITCHEN: {OrderStatus.IN_PREPARATION},
    OrderStatus.IN_PREPARATION: {OrderStatus.READY},
    OrderStatus.READY: {OrderStatus.DELIVERED, OrderStatus.OUT_FOR_DELIVERY},
    OrderStatus.OUT_FOR_DELIVERY: {OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED},
    OrderStatus.DELIVERED: set(),
    OrderStatus.DELIVERY_FAILED: set(),
    OrderStatus.CANCELED: set(),
}

# Canonical lifecycle policy used by runtime guards.
ALLOWED_TRANSITIONS = BASE_TRANSITIONS

CANONICAL_SEQUENCE: tuple[OrderStatus, ...] = (
    OrderStatus.CREATED,
    OrderStatus.CONFIRMED,
    OrderStatus.SENT_TO_KITCHEN,
    OrderStatus.IN_PREPARATION,
    OrderStatus.READY,
    OrderStatus.DELIVERED,
)

DELIVERY_SEQUENCE: tuple[OrderStatus, ...] = (
    OrderStatus.READY,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
)


def _validate_transition_map() -> list[str]:
    errors: list[str] = []

    for source, target in zip(CANONICAL_SEQUENCE, CANONICAL_SEQUENCE[1:]):
        if target not in ALLOWED_TRANSITIONS[source]:
            errors.append(f"Missing canonical transition: {source.value} -> {target.value}")

    for source, target in zip(DELIVERY_SEQUENCE, DELIVERY_SEQUENCE[1:]):
        if target not in ALLOWED_TRANSITIONS[source]:
            errors.append(f"Missing delivery transition: {source.value} -> {target.value}")

    return errors


_TRANSITION_MAP_ERRORS = _validate_transition_map()
if _TRANSITION_MAP_ERRORS:
    raise RuntimeError(f"Invalid lifecycle transition map: {_TRANSITION_MAP_ERRORS}")


def can_transition(current: OrderStatus, target: OrderStatus, order_type: OrderType) -> bool:
    if target not in ALLOWED_TRANSITIONS[current]:
        return False

    if current == OrderStatus.READY and target == OrderStatus.OUT_FOR_DELIVERY:
        return order_type == OrderType.DELIVERY
    if current == OrderStatus.READY and target == OrderStatus.DELIVERED:
        return order_type in (OrderType.DINE_IN, OrderType.TAKEAWAY)
    if current == OrderStatus.OUT_FOR_DELIVERY:
        return order_type == OrderType.DELIVERY
    return True
