import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import select

from backend.config import Config, ROOT_DIR
from backend.database import SessionLocal, close_db, init_db
from backend.models import User
from backend.routes.admin import admin_bp
from backend.routes.auth import auth_bp
from backend.routes.cart import cart_bp
from backend.routes.contact import contact_bp
from backend.routes.custom_orders import custom_orders_bp
from backend.routes.orders import orders_bp
from backend.routes.products import products_bp
from backend.services.security import password_hash


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    CORS(app, resources={r"/api/*": {"origins": app.config["ALLOWED_ORIGINS"]}}, allow_headers=["Content-Type", "Authorization"])
    Limiter(key_func=get_remote_address, app=app, default_limits=["200 per hour"], storage_uri=app.config["RATE_LIMIT_STORAGE_URI"])
    app.teardown_appcontext(close_db)

    app.register_blueprint(auth_bp)
    app.register_blueprint(products_bp)
    app.register_blueprint(cart_bp)
    app.register_blueprint(contact_bp)
    app.register_blueprint(orders_bp)
    app.register_blueprint(custom_orders_bp)
    app.register_blueprint(admin_bp)

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://www.gstatic.com; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https://firebasestorage.googleapis.com; "
            "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firebasestorage.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; "
            "font-src 'self' data:; "
            "frame-src 'self'; "
            "object-src 'none'"
        )
        return response

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({"error": "Upload is too large. The maximum size is 8 MB."}), 413

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": "Resource not found."}), 404

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "PAPERPLAZO API"})

    @app.get("/")
    def customer_home():
        return send_from_directory(ROOT_DIR / "customer_app", "index.html")

    @app.get("/customer/<path:filename>")
    def customer_assets(filename):
        return send_from_directory(ROOT_DIR / "customer_app", filename)

    @app.get("/admin")
    @app.get("/admin/")
    def admin_home():
        return send_from_directory(ROOT_DIR / "admin_app", "index.html")

    @app.get("/admin/<path:filename>")
    def admin_assets(filename):
        return send_from_directory(ROOT_DIR / "admin_app", filename)

    @app.get("/shared/<path:filename>")
    def shared_assets(filename):
        return send_from_directory(ROOT_DIR / "shared", filename)

    @app.get("/uploads/<path:filename>")
    def uploads(filename):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

    with app.app_context():
        init_db()
        _bootstrap_admin(app)
    return app


def _bootstrap_admin(app):
    email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("ADMIN_PASSWORD", "")
    if not email or not password or password == "change-this-before-first-run":
        app.logger.warning("No admin was created. Set ADMIN_EMAIL and a strong ADMIN_PASSWORD in .env, then restart.")
        return
    admin = SessionLocal.scalar(select(User).where(User.email == email))
    if not admin:
        try:
            SessionLocal.add(User(email=email, full_name="PAPERPLAZO Administrator", role="admin", password_hash=password_hash(password)))
            SessionLocal.commit()
            app.logger.info("Initial administrator created from environment configuration.")
        except ValueError:
            SessionLocal.rollback()
            app.logger.error("ADMIN_PASSWORD must be at least 10 characters; administrator was not created.")


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000, debug=os.getenv("FLASK_ENV") == "development")
