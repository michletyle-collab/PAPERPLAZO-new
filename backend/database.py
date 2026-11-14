from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, scoped_session, sessionmaker

from backend.config import Config


class Base(DeclarativeBase):
    pass


def _database_url(url: str) -> str:
    if url.startswith("sqlite:///") and not url.startswith("sqlite:////"):
        relative_path = url.removeprefix("sqlite:///")
        if relative_path.startswith("instance/"):
            full_path = Path(__file__).resolve().parent / relative_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{full_path.as_posix()}"
    return url


DATABASE_URL = _database_url(Config.DATABASE_URL)
engine_kwargs = {"future": True, "pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False))


def init_db() -> None:
    # Import models before metadata creation so every mapped table is present.
    import backend.models  # noqa: F401
    Base.metadata.create_all(bind=engine)


def close_db(_exception=None) -> None:
    SessionLocal.remove()
