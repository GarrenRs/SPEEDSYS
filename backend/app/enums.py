from enum import StrEnum


class UserRole(StrEnum):
    MANAGER = "manager"
    KITCHEN = "kitchen"
    DELIVERY = "delivery"


class OrderType(StrEnum):
    DINE_IN = "dine-in"
    TAKEAWAY = "takeaway"
    DELIVERY = "delivery"


class OrderStatus(StrEnum):
    CREATED = "CREATED"
    CONFIRMED = "CONFIRMED"
    SENT_TO_KITCHEN = "SENT_TO_KITCHEN"
    IN_PREPARATION = "IN_PREPARATION"
    READY = "READY"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY"
    DELIVERED = "DELIVERED"
    DELIVERY_FAILED = "DELIVERY_FAILED"
    CANCELED = "CANCELED"


class TableStatus(StrEnum):
    AVAILABLE = "available"
    OCCUPIED = "occupied"
    RESERVED = "reserved"


class ProductKind(StrEnum):
    SELLABLE = "sellable"
    INTERNAL = "internal"


class ResourceScope(StrEnum):
    KITCHEN = "kitchen"
    STOCK = "stock"


class PaymentStatus(StrEnum):
    UNPAID = "unpaid"
    PAID = "paid"
    REFUNDED = "refunded"


class FinancialTransactionType(StrEnum):
    SALE = "sale"
    REFUND = "refund"
    EXPENSE = "expense"


class ResourceMovementType(StrEnum):
    ADD = "add"
    DEDUCT = "deduct"
    ADJUST = "adjust"


class DriverStatus(StrEnum):
    AVAILABLE = "available"
    BUSY = "busy"
    INACTIVE = "inactive"


class DeliveryAssignmentStatus(StrEnum):
    NOTIFIED = "notified"
    ASSIGNED = "assigned"
    DEPARTED = "departed"
    DELIVERED = "delivered"
    FAILED = "failed"
