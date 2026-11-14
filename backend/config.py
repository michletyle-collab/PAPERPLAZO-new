import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


class Config:
    SECRET_KEY = os.getenv("APP_SECRET_KEY", "development-only-change-me")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "development-jwt-change-me")
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///instance/paperplazo.db")
    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", str(ROOT_DIR / "backend" / "uploads"))
    MAX_CONTENT_LENGTH = 8 * 1024 * 1024
    ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv(
        "ALLOWED_ORIGINS", "http://127.0.0.1:5000,http://localhost:5000"
    ).split(",") if origin.strip()]
    LOW_STOCK_THRESHOLD = int(os.getenv("LOW_STOCK_THRESHOLD", "10"))
    COD_ENABLED = os.getenv("COD_ENABLED", "true").lower() == "true"
    SHIPPING_RATE = os.getenv("SHIPPING_RATE", "0")
    FREE_SHIPPING_THRESHOLD = os.getenv("FREE_SHIPPING_THRESHOLD", "0")
    RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
    RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    RATE_LIMIT_STORAGE_URI = os.getenv("RATE_LIMIT_STORAGE_URI", "memory://")
    FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "paperplazo")
    FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY", "")
