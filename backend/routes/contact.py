from flask import Blueprint, g, jsonify

from backend.database import SessionLocal
from backend.models import ContactMessage
from backend.services.orders import create_admin_notification
from backend.services.security import error, json_data, required_text, valid_email


contact_bp = Blueprint("contact", __name__, url_prefix="/api")


@contact_bp.post("/contact")
def send_contact_message():
    try:
        data = json_data()
        name = required_text(data, "name", 120)
        email = required_text(data, "email", 255).lower()
        if not valid_email(email):
            raise ValueError("Please enter a valid email address.")
        current_user = getattr(g, "current_user", None)
        message = ContactMessage(name=name, email=email, subject=required_text(data, "subject", 180),
                                 message=required_text(data, "message", 4000), user_id=current_user.id if current_user else None)
        SessionLocal.add(message)
        SessionLocal.flush()
        create_admin_notification(f"New contact message from {name}: {message.subject}", "contact_message")
        SessionLocal.commit()
        return jsonify({"message": "Thank you. Your message has been received."}), 201
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))
