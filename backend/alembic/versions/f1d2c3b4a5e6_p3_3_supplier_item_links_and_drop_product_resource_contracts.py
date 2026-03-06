"""p3_3_supplier_item_links_and_drop_product_resource_contracts

Revision ID: f1d2c3b4a5e6
Revises: c9f4b8d1e2a3
Create Date: 2026-03-03 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1d2c3b4a5e6"
down_revision: Union[str, Sequence[str], None] = "c9f4b8d1e2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ARCHIVE_PREFIX = "legacy_archive_"
DROP_TARGETS: tuple[str, ...] = (
    "product_resources",
    "kitchen_resource_components",
)


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
    bind = op.get_bind()
    existing_tables = _table_names(bind)

    if "wh_supplier_items" not in existing_tables:
        op.create_table(
            "wh_supplier_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("supplier_id", sa.Integer(), nullable=False),
            sa.Column("item_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["supplier_id"], ["wh_suppliers.id"]),
            sa.ForeignKeyConstraint(["item_id"], ["wh_items.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("supplier_id", "item_id", name="uq_wh_supplier_item"),
        )
        with op.batch_alter_table("wh_supplier_items", schema=None) as batch_op:
            batch_op.create_index(batch_op.f("ix_wh_supplier_items_id"), ["id"], unique=False)
            batch_op.create_index(batch_op.f("ix_wh_supplier_items_supplier_id"), ["supplier_id"], unique=False)
            batch_op.create_index(batch_op.f("ix_wh_supplier_items_item_id"), ["item_id"], unique=False)
            batch_op.create_index(batch_op.f("ix_wh_supplier_items_created_at"), ["created_at"], unique=False)
        existing_tables.add("wh_supplier_items")

    for table_name in DROP_TARGETS:
        if table_name not in existing_tables:
            continue
        archive_table = _archive_table_name(table_name)
        if archive_table not in existing_tables:
            op.execute(sa.text(f'CREATE TABLE "{archive_table}" AS SELECT * FROM "{table_name}"'))
            existing_tables.add(archive_table)

    for table_name in DROP_TARGETS:
        if table_name in existing_tables:
            op.drop_table(table_name)
            existing_tables.remove(table_name)


def downgrade() -> None:
    bind = op.get_bind()
    existing_tables = _table_names(bind)

    if "product_resources" not in existing_tables:
        op.create_table(
            "product_resources",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("product_id", sa.Integer(), nullable=False),
            sa.Column("resource_id", sa.Integer(), nullable=False),
            sa.Column("quantity_per_unit", sa.Float(), nullable=False),
            sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
            sa.ForeignKeyConstraint(["resource_id"], ["resources.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("product_id", "resource_id", name="uq_product_resource"),
        )
        with op.batch_alter_table("product_resources", schema=None) as batch_op:
            batch_op.create_index(batch_op.f("ix_product_resources_id"), ["id"], unique=False)
            batch_op.create_index(batch_op.f("ix_product_resources_product_id"), ["product_id"], unique=False)
            batch_op.create_index(batch_op.f("ix_product_resources_resource_id"), ["resource_id"], unique=False)
        existing_tables.add("product_resources")

    if "kitchen_resource_components" not in existing_tables:
        op.create_table(
            "kitchen_resource_components",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("kitchen_resource_id", sa.Integer(), nullable=False),
            sa.Column("stock_resource_id", sa.Integer(), nullable=False),
            sa.Column("quantity_per_unit", sa.Float(), nullable=False),
            sa.ForeignKeyConstraint(["kitchen_resource_id"], ["resources.id"]),
            sa.ForeignKeyConstraint(["stock_resource_id"], ["resources.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("kitchen_resource_id", "stock_resource_id", name="uq_kitchen_resource_component"),
        )
        with op.batch_alter_table("kitchen_resource_components", schema=None) as batch_op:
            batch_op.create_index(batch_op.f("ix_kitchen_resource_components_id"), ["id"], unique=False)
            batch_op.create_index(batch_op.f("ix_kitchen_resource_components_kitchen_resource_id"), ["kitchen_resource_id"], unique=False)
            batch_op.create_index(batch_op.f("ix_kitchen_resource_components_stock_resource_id"), ["stock_resource_id"], unique=False)
        existing_tables.add("kitchen_resource_components")

    _copy_archive_rows(
        bind,
        archive_table=_archive_table_name("product_resources"),
        target_table="product_resources",
    )
    _copy_archive_rows(
        bind,
        archive_table=_archive_table_name("kitchen_resource_components"),
        target_table="kitchen_resource_components",
    )

    if "wh_supplier_items" in existing_tables:
        op.drop_table("wh_supplier_items")
