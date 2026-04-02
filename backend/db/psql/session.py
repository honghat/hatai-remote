from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from core.config import DB_CONFIG
from urllib.parse import quote_plus

user = DB_CONFIG.get("username")
password = quote_plus(DB_CONFIG.get("password", ""))
host = DB_CONFIG.get("server", "localhost")
port = DB_CONFIG.get("port", 5432)
database = DB_CONFIG.get("database", "")

database_url = f"postgresql://{user}:{password}@{host}:{port}/{database}"

engine = create_engine(
    database_url,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=5,
    max_overflow=10,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
