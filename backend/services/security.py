import json
import os
import re
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import current_app, g, has_app_context, jsonify, request
from sqlalchemy import select
from werkzeug.security import check_password_hash, generate_password_hash

from backend.database import SessionLocal
from backend.models import AuditLog, User


try:
    import firebase_admin
    from firebase_admin import auth as firebase_auth
    from firebase_admin import credentials
except ImportError:  # pragma: no cover
    firebase_admin = None
    firebase_auth = None
    credentials = None


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def error(message, status=400, code=None):
    payload = {"error": message}
    if code:
        payload["code"] = code
    return jsonify(payload), status


def json_data(required=True):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        if required:
            raise ValueError("A JSON object is required.")
        return {}
    return data


def required_text(data, key, maximum=500):
    value = str(data.get(key, "")).strip()
    if not value:
        raise ValueError(f"{key.replace('_', ' ').title()} is required.")
    if len(value) > maximum:
        raise ValueError(f"{key.replace('_', ' ').title()} is too long.")
    return value


def valid_email(value):
    return bool(EMAIL_RE.fullmatch(value.lower().strip()))


def password_hash(password):
    if not isinstance(password, str) or len(password) < 10 or len(password) > 128:
        raise ValueError("Password must be between 10 and 128 characters.")
    return generate_password_hash(password)


def verify_password(password, hashed):
    return check_password_hash(hashed, password)


def _jwt_secret():
    if has_app_context():
        return current_app.config.get("JWT_SECRET_KEY", os.getenv("JWT_SECRET_KEY", "development-jwt-change-me"))
    return os.getenv("JWT_SECRET_KEY", "development-jwt-change-me")


def issue_token(user):
    """Issue legacy tokens for customers only.

    Administrator access is exclusively represented by a verified Firebase ID
    token carrying the Firebase custom claim ``admin: true``.
    """
    if user.role == "admin":
        raise ValueError("Administrator sessions must use Firebase Authentication.")
    hours = 8
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.id), "role": user.role, "iat": now, "exp": now + timedelta(hours=hours)}
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def verify_legacy_token(token):
    if not token:
        raise ValueError("Missing JWT token.")
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"],
                             options={"require": ["exp", "sub", "role"]})
    except jwt.PyJWTError as exc:
        raise ValueError("Legacy JWT is invalid or expired.") from exc
    if payload.get("role") not in {"customer", "admin"}:
        raise ValueError("Legacy JWT role is invalid.")
    return payload


def init_firebase_admin():
    if firebase_admin is None or firebase_auth is None:
        raise ValueError("Firebase Admin SDK is not installed.")
    if firebase_admin._apps:
        return

    service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if service_account_path:
        service_account_path = os.path.abspath(service_account_path)
        try:
            with open(service_account_path, 'r', encoding='utf-8') as handle:
                service_account = json.load(handle)
        except FileNotFoundError as exc:
            raise ValueError(f"Firebase service account file not found: {service_account_path}") from exc
        except json.JSONDecodeError as exc:
            raise ValueError(f"Firebase service account file is not valid JSON: {service_account_path}") from exc

        project_id = service_account.get("project_id") or os.getenv("FIREBASE_PROJECT_ID", "paperplazo")
        if credentials is None:
            raise ValueError("Firebase Admin SDK credentials support is unavailable.")
        firebase_admin.initialize_app(credentials.Certificate(service_account_path), {
            "projectId": project_id,
            "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", f"{project_id}.firebasestorage.app"),
        })
        return

    firebase_admin.initialize_app(options={
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", f"{os.getenv('FIREBASE_PROJECT_ID', 'paperplazo')}.firebasestorage.app"),
    })


def verify_firebase_token(token):
    if not token:
        raise ValueError("Missing Firebase token.")
    init_firebase_admin()
    claims = firebase_auth.verify_id_token(token)
    expected_project = current_app.config.get("FIREBASE_PROJECT_ID", "paperplazo") if has_app_context() else os.getenv("FIREBASE_PROJECT_ID", "paperplazo")
    expected_issuers = {f"https://securetoken.google.com/{expected_project}", f"https://{expected_project}.firebaseio.com"}
    if claims.get("iss") not in expected_issuers:
        raise ValueError("Firebase token issuer does not match the configured project.")
    if not str(claims.get("uid") or "").strip():
        raise ValueError("Firebase token is missing a user UID.")
    if claims.get("exp") is None:
        raise ValueError("Firebase token is missing an expiration claim.")
    audience = claims.get("aud")
    if not str(audience or "").strip():
        raise ValueError("Firebase token audience is invalid.")
    if str(audience) != expected_project:
        raise ValueError("Firebase token audience does not match the configured project.")
    if not claims.get("sub"):
        raise ValueError("Firebase token subject is missing.")
    return claims


def require_auth(role=None):
    def decorator(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                return error("Authentication is required.", 401, "authentication_required")
            token = header[7:]

            claims = None
            token_source = None
            required_admin = role == "admin"

            if required_admin:
                # Never fall back to a locally signed JWT for an admin route.
                # Firebase Admin verifies the ID token signature, issuer, audience,
                # expiry and then the custom claim below is checked explicitly.
                try:
                    claims = verify_firebase_token(token)
                    token_source = "firebase"
                except Exception:
                    return error("Your Firebase administrator session is invalid or has expired.", 401, "invalid_token")
            else:
                try:
                    claims = verify_firebase_token(token)
                    token_source = "firebase"
                except Exception:
                    try:
                        claims = verify_legacy_token(token)
                        token_source = "legacy"
                    except Exception:
                        return error("Your session is invalid or has expired.", 401, "invalid_token")

            email = str(claims.get("email") or "").strip().lower()
            if not email and token_source == "legacy":
                subject = claims.get("sub")
                try:
                    user = SessionLocal.scalar(select(User).where(User.id == int(subject)))
                    if user:
                        email = user.email
                except (TypeError, ValueError):
                    user = None
            if not email:
                return error("Account email is required for this session.", 401, "invalid_token")

            admin_claim = bool(claims.get("admin") is True)
            if required_admin:
                if not admin_claim:
                    return error("You do not have permission for this action.", 403, "forbidden")

            user = SessionLocal.scalar(select(User).where(User.email == email))
            if not user:
                user = User(
                    email=email,
                    full_name=str(claims.get("name") or email.split("@", 1)[0]),
                    phone=None,
                    # A legacy JWT is customer-only even if it was forged with an
                    # admin-looking role claim. Firebase is the sole admin source.
                    role="admin" if token_source == "firebase" and admin_claim else "customer",
                    password_hash=password_hash(f"{token_source}:{claims.get('uid') or claims.get('sub') or email}")
                )
                SessionLocal.add(user)
                SessionLocal.commit()
            else:
                if token_source == "legacy" and user.role != "customer":
                    user.role = "customer"
                elif token_source == "firebase" and admin_claim and user.role != "admin":
                    user.role = "admin"
                elif token_source == "firebase" and not admin_claim and user.role == "admin":
                    user.role = "customer"
                SessionLocal.commit()

            if not user.is_active:
                return error("Your account is unavailable.", 401, "invalid_token")

            g.current_user = user
            g.auth_source = token_source
            return func(*args, **kwargs)
        return wrapped
    return decorator


def audit(action, entity_type, entity_id=None, detail=None):
    actor = getattr(g, "current_user", None)
    SessionLocal.add(AuditLog(actor_id=actor.id if actor else None, action=action, entity_type=entity_type,
                              entity_id=str(entity_id) if entity_id is not None else None, detail=detail))
