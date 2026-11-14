from decimal import Decimal

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from backend.database import SessionLocal
from backend.models import QuoteRequest
from backend.services.orders import create_admin_notification
from backend.services.security import audit, error, json_data, require_auth
from backend.services.uploads import save_upload


custom_orders_bp = Blueprint("custom_orders", __name__, url_prefix="/api")


def required_form(name, limit=500):
    value = str(request.form.get(name, "")).strip()
    if not value or len(value) > limit:
        raise ValueError(f"{name.replace('_', ' ').title()} is required and must be valid.")
    return value


def positive_decimal(value, name):
    try:
        result = Decimal(str(value))
    except Exception as exc:
        raise ValueError(f"{name} must be a number.") from exc
    if result <= 0:
        raise ValueError(f"{name} must be greater than zero.")
    return result


@custom_orders_bp.post("/custom-orders")
@require_auth()
def request_quote():
    try:
        width = positive_decimal(required_form("width", 20), "Width")
        height = positive_decimal(required_form("height", 20), "Height")
        depth = positive_decimal(required_form("depth", 20), "Depth")
        quantity = int(required_form("quantity", 10))
        if quantity < 1:
            raise ValueError("Quantity must be at least one.")
        logo = save_upload(request.files.get("logo"), "document")
        quote = QuoteRequest(user_id=g.current_user.id, width=width, height=height, depth=depth,
                             paper_gsm=required_form("paper_gsm", 50), paper_colour=required_form("paper_colour", 100),
                             handle_type=required_form("handle_type", 100), printing_requirements=str(request.form.get("printing_requirements", ""))[:4000] or None,
                             quantity=quantity, special_instructions=str(request.form.get("special_instructions", ""))[:4000] or None,
                             logo_path=logo)
        SessionLocal.add(quote)
        SessionLocal.flush()
        audit("quote_requested", "quote_request", quote.reference)
        create_admin_notification(f"New custom-order request {quote.reference} from {g.current_user.full_name}.", "quote_requested")
        SessionLocal.commit()
        return jsonify({"quote": quote.public()}), 201
    except (ValueError, TypeError) as exc:
        SessionLocal.rollback()
        return error(str(exc))


@custom_orders_bp.get("/custom-orders")
@require_auth()
def list_my_quotes():
    quotes = SessionLocal.scalars(select(QuoteRequest).where(QuoteRequest.user_id == g.current_user.id).order_by(QuoteRequest.created_at.desc())).all()
    return jsonify({"quotes": [quote.public() for quote in quotes]})


@custom_orders_bp.post("/custom-orders/<int:quote_id>/decision")
@require_auth()
def customer_quote_decision(quote_id):
    quote = SessionLocal.get(QuoteRequest, quote_id)
    if not quote or quote.user_id != g.current_user.id:
        return error("Quotation not found.", 404)
    try:
        decision = str(json_data().get("decision", "")).lower()
        if quote.status != "Quoted":
            raise ValueError("A quotation must be sent before it can be accepted or rejected.")
        if decision not in {"accept", "reject"}:
            raise ValueError("Decision must be accept or reject.")
        quote.status = "Accepted" if decision == "accept" else "Rejected"
        audit(f"quote_{decision}ed", "quote_request", quote.reference)
        create_admin_notification(f"Quotation {quote.reference} was {quote.status.lower()} by the customer.", "quote_decision")
        SessionLocal.commit()
        return jsonify({"quote": quote.public()})
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))
