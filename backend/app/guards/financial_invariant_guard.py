from __future__ import annotations

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..enums import FinancialTransactionType, PaymentStatus
from ..models import Expense, FinancialTransaction, Order, WarehouseStockBalance


def assert_financial_invariants(db: Session) -> None:
    settled_total = float(
        db.execute(
            select(func.coalesce(func.sum(Order.total), 0.0)).where(
                Order.payment_status.in_((PaymentStatus.PAID.value, PaymentStatus.REFUNDED.value))
            )
        ).scalar_one()
        or 0.0
    )
    sale_total = float(
        db.execute(
            select(func.coalesce(func.sum(FinancialTransaction.amount), 0.0)).where(
                FinancialTransaction.type == FinancialTransactionType.SALE.value
            )
        ).scalar_one()
        or 0.0
    )
    if abs(settled_total - sale_total) > 0.01:
        raise RuntimeError(
            f"Financial invariant failed: total_payments != total_financial_entries ({settled_total:.2f} != {sale_total:.2f})"
        )

    paid_without_sale = int(
        db.execute(
            select(func.count(Order.id))
            .select_from(Order)
            .outerjoin(
                FinancialTransaction,
                and_(
                    FinancialTransaction.order_id == Order.id,
                    FinancialTransaction.type == FinancialTransactionType.SALE.value,
                ),
            )
            .where(
                Order.payment_status.in_((PaymentStatus.PAID.value, PaymentStatus.REFUNDED.value)),
                FinancialTransaction.id.is_(None),
            )
        ).scalar_one()
        or 0
    )
    if paid_without_sale:
        raise RuntimeError(f"Financial invariant failed: {paid_without_sale} paid/refunded order(s) without sale entry")

    refunded_without_refund_entry = int(
        db.execute(
            select(func.count(Order.id))
            .select_from(Order)
            .outerjoin(
                FinancialTransaction,
                and_(
                    FinancialTransaction.order_id == Order.id,
                    FinancialTransaction.type == FinancialTransactionType.REFUND.value,
                ),
            )
            .where(
                Order.payment_status == PaymentStatus.REFUNDED.value,
                FinancialTransaction.id.is_(None),
            )
        ).scalar_one()
        or 0
    )
    if refunded_without_refund_entry:
        raise RuntimeError(
            f"Financial invariant failed: {refunded_without_refund_entry} refunded order(s) without refund entry"
        )

    approved_expenses_without_entry = int(
        db.execute(
            select(func.count(Expense.id))
            .select_from(Expense)
            .outerjoin(
                FinancialTransaction,
                and_(
                    FinancialTransaction.expense_id == Expense.id,
                    FinancialTransaction.type == FinancialTransactionType.EXPENSE.value,
                ),
            )
            .where(
                Expense.status == "approved",
                FinancialTransaction.id.is_(None),
            )
        ).scalar_one()
        or 0
    )
    if approved_expenses_without_entry:
        raise RuntimeError(
            f"Financial invariant failed: {approved_expenses_without_entry} approved expense(s) without financial entry"
        )

    negative_stock = int(
        db.execute(select(func.count(WarehouseStockBalance.id)).where(WarehouseStockBalance.quantity < 0)).scalar_one() or 0
    )
    if negative_stock:
        raise RuntimeError(f"Financial invariant failed: {negative_stock} stock balance row(s) are negative")
