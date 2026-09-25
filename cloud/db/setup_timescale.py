"""
Run once after the app has created tables (Base.metadata.create_all
runs automatically on API startup) and you're pointed at the
Dockerized TimescaleDB. Converts `readings` into a hypertable, which
is what actually gives you fast time-range queries over sensor
history as node count grows — a plain Postgres table works fine too,
this is a "when it matters at scale" step, not a blocker.

Usage:
    docker compose up -d
    uvicorn cloud.api.main:app --port 8000   # creates plain tables first
    # then, in another terminal:
    python -m cloud.db.setup_timescale
"""
from sqlalchemy import text

from cloud.api.database import engine


def make_hypertable():
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb;"))
        conn.execute(text(
            "SELECT create_hypertable('readings', 'timestamp', if_not_exists => TRUE);"
        ))
        conn.commit()
    print("readings table converted to a TimescaleDB hypertable.")


if __name__ == "__main__":
    make_hypertable()
