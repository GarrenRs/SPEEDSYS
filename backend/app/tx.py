from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.orm import Session


@contextmanager
def transaction_scope(db: Session) -> Iterator[None]:
    if db.in_transaction():
        with db.begin_nested():
            yield
    else:
        with db.begin():
            yield

