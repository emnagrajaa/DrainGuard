
from sqlalchemy import text

from cloud.api.database import engine


def make_hypertable():
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb;"))
        # Existing installations were created with id as the sole primary
        # key. TimescaleDB cannot partition that unique key across chunks.
        # Migrate it before converting the table; this is safe to rerun.
        conn.execute(text("UPDATE readings SET timestamp = CURRENT_TIMESTAMP WHERE timestamp IS NULL;"))
        conn.execute(text("ALTER TABLE readings ALTER COLUMN timestamp SET NOT NULL;"))
        conn.execute(text("""
            DO $$
            DECLARE pk_name text;
            DECLARE pk_def text;
            BEGIN
                SELECT c.conname, pg_get_constraintdef(c.oid)
                  INTO pk_name, pk_def
                  FROM pg_constraint c
                 WHERE c.conrelid = 'readings'::regclass AND c.contype = 'p';

                IF pk_name IS NOT NULL AND pk_def <> 'PRIMARY KEY (id, "timestamp")' THEN
                    EXECUTE format('ALTER TABLE readings DROP CONSTRAINT %I', pk_name);
                    pk_name := NULL;
                END IF;

                IF pk_name IS NULL THEN
                    ALTER TABLE readings ADD PRIMARY KEY (id, "timestamp");
                END IF;
            END $$;
        """))
        conn.execute(text(
            "SELECT create_hypertable('readings', 'timestamp', if_not_exists => TRUE);"
        ))
        conn.commit()
    print("readings table converted to a TimescaleDB hypertable.")


if __name__ == "__main__":
    make_hypertable()
