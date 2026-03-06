"""p3_1_drop_legacy_inventory_tables

Revision ID: c9f4b8d1e2a3
Revises: 07038e084fcd
Create Date: 2026-03-01 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9f4b8d1e2a3"
down_revision: Union[str, Sequence[str], None] = "07038e084fcd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LEGACY_TABLES: tuple[str, ...] = (
    "suppliers",
    "inventory_warehouses",
    "inventory_balances",
    "inventory_movements",
    "supplier_receipts",
    "supplier_receipt_items",
)
ARCHIVE_PREFIX = "legacy_archive_"


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _archive_table_name(table_name: str) -> str:
    return f"{ARCHIVE_PREFIX}{table_name}"


def _copy_archive_rows(bind, *, archive_table: str, target_table: str) -> None:
    table_names = _table_names(bind)
    if archive_table not in table_names or target_table not in table_names:
        return
    inspector = sa.inspect(bind)
    target_columns = [column["name"] for column in inspector.get_columns(target_table)]
    archive_columns = {column["name"] for column in inspector.get_columns(archive_table)}
    shared_columns = [column for column in target_columns if column in archive_columns]
    if not shared_columns:
        return
    quoted = ", ".join(f'"{column}"' for column in shared_columns)
    op.execute(sa.text(f'INSERT INTO "{target_table}" ({quoted}) SELECT {quoted} FROM "{archive_table}"'))


def upgrade() -> None:
    """Archive legacy inventory tables, then drop them from active schema."""
    bind = op.get_bind()
    existing_tables = _table_names(bind)

    for table_name in LEGACY_TABLES:
        if table_name not in existing_tables:
            continue
        archive_table = _archive_table_name(table_name)
        if archive_table not in existing_tables:
            op.execute(sa.text(f'CREATE TABLE "{archive_table}" AS SELECT * FROM "{table_name}"'))
            existing_tables.add(archive_table)

    drop_order = (
        "supplier_receipt_items",
        "supplier_receipts",
        "inventory_movements",
        "inventory_balances",
        "inventory_warehouses",
        "suppliers",
    )
    for table_name in drop_order:
        if table_name in existing_tables:
            op.drop_table(table_name)
            existing_tables.remove(table_name)


def downgrade() -> None:
    """Restore legacy inventory tables from archive snapshots if available."""
    bind = op.get_bind()
    existing_tables = _table_names(bind)

    if "suppliers" not in existing_tables:
        op.create_table(
            "suppliers",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("phone", sa.String(length=40), nullable=True),
            sa.Column("email", sa.String(length=120), nullable=True),
            sa.Column("address", sa.String(length=255), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )
        existing_tables.add("suppliers")

    if "inventory_warehouses" not in existing_tables:
        op.create_table(
            "inventory_warehouses",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("code", sa.String(length=32), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code"),
        )
        existing_tables.add("inventory_warehouses")

    if "inventory_balances" not in existing_tables:
        op.create_table(
            "inventory_balances",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("warehouse_id", sa.Integer(), nullable=False),
            sa.Column("resource_id", sa.Integer(), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["resource_id"], ["resources.id"]),
            sa.ForeignKeyConstraint(["warehouse_id"], ["inventory_warehouses.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("warehouse_id", "resource_id", name="uq_inventory_balance"),
        )
        existing_tables.add("inventory_balances")

    if "inventory_movements" not in existing_tables:
        op.create_table(
            "inventory_movements",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("warehouse_id", sa.Integer(), nullable=False),
            sa.Column("resource_id", sa.Integer(), nullable=False),
            sa.Column("supplier_id", sa.Integer(), nullable=True),
            sa.Column("movement_type", sa.String(length=40), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("balance_before", sa.Float(), nullable=False),
            sa.Column("balance_after", sa.Float(), nullable=False),
            sa.Column("reason", sa.String(length=255), nullable=False),
            sa.Column("source_type", sa.String(length=40), nullable=True),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["resource_id"], ["resources.id"]),
            sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
            sa.ForeignKeyConstraint(["warehouse_id"], ["inventory_warehouses.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("inventory_movements")

    if "supplier_receipts" not in existing_tables:
        op.create_table(
            "supplier_receipts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("supplier_id", sa.Integer(), nullable=False),
            sa.Column("warehouse_id", sa.Integer(), nullable=False),
            sa.Column("reference_no", sa.String(length=80), nullable=True),
            sa.Column("note", sa.String(length=255), nullable=True),
            sa.Column("received_by", sa.Integer(), nullable=False),
            sa.Column("received_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["received_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
            sa.ForeignKeyConstraint(["warehouse_id"], ["inventory_warehouses.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("supplier_receipts")

    if "supplier_receipt_items" not in existing_tables:
        op.create_table(
            "supplier_receipt_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("receipt_id", sa.Integer(), nullable=False),
            sa.Column("resource_id", sa.Integer(), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("unit_cost", sa.Float(), nullable=True),
            sa.ForeignKeyConstraint(["receipt_id"], ["supplier_receipts.id"]),
            sa.ForeignKeyConstraint(["resource_id"], ["resources.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("supplier_receipt_items")

    _copy_archive_rows(bind, archive_table=_archive_table_name("suppliers"), target_table="suppliers")
    _copy_archive_rows(
        bind,
        archive_table=_archive_table_name("inventory_warehouses"),
        target_table="inventory_warehouses",
    )
    _copy_archive_rows(
        bind,
        archive_table=_archive_table_name("inventory_balances"),
        target_table="inventory_balances",
    )
    _copy_archive_rows(
        bind,
        archive_table=_archive_table_name("inventory_movements"),
        target_table="inventory_movements",
    )
    _copy_archive_rows(
        bind,
        archive_table=_archive_table_name("supplier_receipts"),
        target_table="supplier_receipts",
    )
    _copy_archive_rows(
        bind,
        archive_table=_archive_table_name("supplier_receipt_items"),
        target_table="supplier_receipt_items",
    )
