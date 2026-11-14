from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from backend.database import SessionLocal
from backend.models import Address, User
from backend.services.security import (audit, error, issue_token, json_data, password_hash,
                                       require_auth, required_text, valid_email, verify_password)


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _login(data):
    email = required_text(data, "email", 255).lower()
    password = required_text(data, "password", 128)
    user = SessionLocal.scalar(select(User).where(User.email == email))
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        return error("Invalid email or password.", 401)
    if user.role == "admin":
        return error("Administrator sessions must use Firebase Authentication.", 403, "firebase_auth_required")
    audit("login", "user", user.id)
    SessionLocal.commit()
    return jsonify({"token": issue_token(user), "user": user.public()})


@auth_bp.post("/register")
def register():
    try:
        data = json_data()
        name = required_text(data, "full_name", 120)
        email = required_text(data, "email", 255).lower()
        if not valid_email(email):
            raise ValueError("Please enter a valid email address.")
        if SessionLocal.scalar(select(User).where(User.email == email)):
            return error("An account with that email already exists.", 409)
        user = User(full_name=name, email=email, phone=str(data.get("phone", "")).strip() or None,
                    password_hash=password_hash(data.get("password")), role="customer")
        SessionLocal.add(user)
        SessionLocal.commit()
        return jsonify({"token": issue_token(user), "user": user.public()}), 201
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))


@auth_bp.post("/login")
def login():
    try:
        return _login(json_data())
    except ValueError as exc:
        return error(str(exc))


@auth_bp.post("/admin/login")
def admin_login():
    return error("Administrator sessions must use Firebase Authentication.", 410, "firebase_auth_required")


@auth_bp.post("/forgot-password")
def forgot_password():
    # Deliberately generic until a transactional email provider is configured.
    try:
        email = required_text(json_data(), "email", 255).lower()
        if not valid_email(email):
            raise ValueError("Please enter a valid email address.")
        return jsonify({"message": "If that account exists, reset instructions will be sent when email delivery is configured."})
    except ValueError as exc:
        return error(str(exc))


@auth_bp.get("/me")
@require_auth()
def me():
    return jsonify({"user": g.current_user.public(), "addresses": [address.public() for address in g.current_user.addresses]})


@auth_bp.patch("/me")
@require_auth()
def update_me():
    try:
        data = json_data()
        if "full_name" in data:
            g.current_user.full_name = required_text(data, "full_name", 120)
        if "phone" in data:
            g.current_user.phone = str(data["phone"]).strip()[:30] or None
        audit("profile_update", "user", g.current_user.id)
        SessionLocal.commit()
        return jsonify({"user": g.current_user.public()})
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))


@auth_bp.post("/addresses")
@require_auth()
def add_address():
    try:
        data = json_data()
        values = {key: required_text(data, key, 255) for key in ("recipient", "phone", "line1", "city", "state", "postal_code")}
        make_default = bool(data.get("is_default")) or not g.current_user.addresses
        if make_default:
            for current in g.current_user.addresses:
                current.is_default = False
        address = Address(user_id=g.current_user.id, label=str(data.get("label", "Home"))[:50], line2=str(data.get("line2", ""))[:255] or None,
                          is_default=make_default, **values)
        SessionLocal.add(address)
        SessionLocal.commit()
        return jsonify({"address": address.public()}), 201
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))


@auth_bp.delete("/addresses/<int:address_id>")
@require_auth()
def delete_address(address_id):
    address = SessionLocal.get(Address, address_id)
    if not address or address.user_id != g.current_user.id:
        return error("Address not found.", 404)
    SessionLocal.delete(address)
    SessionLocal.commit()
    return "", 204
