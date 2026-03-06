from __future__ import annotations

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..models import Expense, FinancialTransaction, Order


def create_financial_transaction(
    db: Session,
    *,
    order_id: int | None,
    expense_id: int | None,
    amount: float,
    tx_type: str,
    created_by: int,
    note: str | None,
) -> None:
    db.add(
        FinancialTransaction(
            order_id=order_id,
            expense_id=expense_id,
            amount=amount,
            type=tx_type,
            created_by=created_by,
            note=note,
        )
    )


def update_order_payment_if_unpaid_and_delivered(
    db: Session,
    *,
    order_id: int,
    delivered_status: str,
    paid_status: str,
    payment_values: dict[str, object],
) -> int:
    result = db.execute(
        update(Order)
        .where(
            Order.id == order_id,
            Order.status == delivered_status,
            Order.payment_status != paid_status,
        )
        .values(**payment_values)
    )
    return int(result.rowcount or 0)


def find_latest_order_transaction_by_type(db: Session, *, order_id: int, tx_type: str) -> FinancialTransaction | None:
    return (
        db.execute(
            select(FinancialTransaction)
            .where(
                FinancialTransaction.order_id == order_id,
                FinancialTransaction.type == tx_type,
            )
            .order_by(FinancialTransaction.id.desc())
        )
        .scalar_one_or_none()
    )


def delete_expense_transactions(db: Session, *, expense_id: int) -> None:
    db.execute(delete(FinancialTransaction).where(FinancialTransaction.expense_id == expense_id))


def find_latest_expense_transaction(db: Session, *, expense_id: int, tx_type: str) -> FinancialTransaction | None:
    return (
        db.execute(
            select(FinancialTransaction)
            .where(
                FinancialTransaction.expense_id == expense_id,
                FinancialTransaction.type == tx_type,
            )
            .order_by(FinancialTransaction.id.desc())
        )
        .scalar_one_or_none()
    )


def sum_daily_transactions(db: Session, *, business_day_key: str, tx_type: str) -> float:
    value = db.execute(
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0.0)).where(
            func.date(FinancialTransaction.created_at, "localtime") == business_day_key,
            FinancialTransaction.type == tx_type,
        )
    ).scalar_one()
    return float(value or 0.0)


def count_daily_transactions(db: Session, *, business_day_key: str) -> int:
    value = db.execute(
        select(func.count(FinancialTransaction.id)).where(
            func.date(FinancialTransaction.created_at, "localtime") == business_day_key
        )
    ).scalar_one()
    return int(value or 0)


def fetch_expense_by_id(db: Session, *, expense_id: int) -> Expense | None:
    return db.execute(select(Expense).where(Expense.id == expense_id)).scalar_one_or_none()

