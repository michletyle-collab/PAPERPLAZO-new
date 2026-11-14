from datetime import datetime, timedelta
from decimal import Decimal

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, or_, select

from backend.config import Config
from backend.database import SessionLocal
from backend.models import (Category, ContactMessage, InventoryHistory, Notification, Order, OrderItem, Product,
                            QuoteRequest, User)
from backend.services.orders import ORDER_STATUSES, create_admin_notification, set_order_status
from backend.services.firestore_products import sync_product
from backend.services.security import audit, error, json_data, require_auth, required_text
from backend.services.uploads import save_upload


admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


def decimal_amount(value, label, allow_zero=True):
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"))
    except Exception as exc:
        raise ValueError(f"{label} must be a valid amount.") from exc
    if amount < 0 or (not allow_zero and amount == 0):
        raise ValueError(f"{label} cannot be negative.")
    return amount


@admin_bp.get("/dashboard")
@require_auth("admin")
def dashboard():
    today = datetime.utcnow().date()
    month_start = today.replace(day=1)
    total_orders = SessionLocal.scalar(select(func.count()).select_from(Order)) or 0
    total_products = SessionLocal.scalar(select(func.count()).select_from(Product)) or 0
    low_stock = SessionLocal.scalar(select(func.count()).select_from(Product).where(Product.stock <= Config.LOW_STOCK_THRESHOLD,
                                                                                     Product.status == "active")) or 0
    total_sales = SessionLocal.scalar(select(func.coalesce(func.sum(Order.total), 0)).where(Order.payment_status.in_(["Paid", "COD"]),
                                                                                              Order.status != "Cancelled")) or 0
    monthly_revenue = SessionLocal.scalar(select(func.coalesce(func.sum(Order.total), 0)).where(Order.created_at >= month_start,
                                                                                                  Order.payment_status.in_(["Paid", "COD"]),
                                                                                                  Order.status != "Cancelled")) or 0
    by_status = {status: SessionLocal.scalar(select(func.count()).select_from(Order).where(Order.status == status)) or 0 for status in ORDER_STATUSES}
    best_sellers = SessionLocal.scalars(select(Product).order_by(Product.is_best_seller.desc(), Product.stock.asc()).limit(5)).all()
    return jsonify({"metrics": {"total_orders": total_orders, "new_orders": by_status["Order Received"],
                                  "pending_orders": by_status["Payment Pending"], "completed_orders": by_status["Delivered"],
                                  "total_products": total_products, "low_stock_products": low_stock,
                                  "total_sales": float(total_sales), "monthly_revenue": float(monthly_revenue)},
                    "orders_by_status": by_status,
                    "best_sellers": [{"name": item.name, "product_code": item.product_code, "stock": item.stock} for item in best_sellers]})


@admin_bp.get("/orders")
@require_auth("admin")
def admin_orders():
    query = select(Order)
    search = request.args.get("q", "").strip()
    status = request.args.get("status", "").strip()
    if status:
        query = query.where(Order.status == status)
    if search:
        term = f"%{search[:100]}%"
        query = query.join(User).where(or_(Order.order_number.ilike(term), User.email.ilike(term), User.full_name.ilike(term)))
    orders = SessionLocal.scalars(query.order_by(Order.created_at.desc())).all()
    return jsonify({"orders": [order.public(include_user=True) for order in orders]})


@admin_bp.patch("/orders/<order_number>")
@require_auth("admin")
def update_order(order_number):
    order = SessionLocal.scalar(select(Order).where(Order.order_number == order_number))
    if not order:
        return error("Order not found.", 404)
    try:
        data = json_data()
        status = required_text(data, "status", 40)
        if status == "Cancelled" and order.stock_deducted:
            for item in order.items:
                item.product.stock += item.quantity
                SessionLocal.add(InventoryHistory(product_id=item.product_id, delta=item.quantity, reason="Cancelled order restock",
                                                 reference=order.order_number, actor_id=g.current_user.id))
            order.stock_deducted = False
        set_order_status(order, status, g.current_user.id)
        if status == "Confirmed" and order.payment_method == "cod":
            order.payment_status = "COD"
        if getattr(g, "auth_source", None) == "firebase":
            for item in order.items:
                sync_product(item.product)
        audit("order_status_updated", "order", order.order_number, status)
        SessionLocal.commit()
        return jsonify({"order": order.public(include_user=True)})
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))


@admin_bp.get("/customers")
@require_auth("admin")
def customers():
    query = select(User).where(User.role == "customer")
    q = request.args.get("q", "").strip()
    if q:
        query = query.where(or_(User.full_name.ilike(f"%{q[:100]}%"), User.email.ilike(f"%{q[:100]}%"), User.phone.ilike(f"%{q[:100]}%")))
    users = SessionLocal.scalars(query.order_by(User.created_at.desc())).all()
    result = []
    for user in users:
        order_count = SessionLocal.scalar(select(func.count()).select_from(Order).where(Order.user_id == user.id)) or 0
        result.append({**user.public(), "order_count": order_count})
    return jsonify({"customers": result})


@admin_bp.get("/customers/<int:user_id>/orders")
@require_auth("admin")
def customer_orders(user_id):
    user = SessionLocal.get(User, user_id)
    if not user or user.role != "customer":
        return error("Customer not found.", 404)
    orders = SessionLocal.scalars(select(Order).where(Order.user_id == user_id).order_by(Order.created_at.desc())).all()
    return jsonify({"customer": user.public(), "orders": [order.public() for order in orders]})


@admin_bp.get("/quotes")
@require_auth("admin")
def admin_quotes():
    query = select(QuoteRequest)
    status = request.args.get("status", "").strip()
    if status:
        query = query.where(QuoteRequest.status == status)
    return jsonify({"quotes": [quote.public(include_customer=True) for quote in SessionLocal.scalars(query.order_by(QuoteRequest.created_at.desc())).all()]})


@admin_bp.patch("/quotes/<int:quote_id>")
@require_auth("admin")
def send_quote(quote_id):
    quote = SessionLocal.get(QuoteRequest, quote_id)
    if not quote:
        return error("Quotation request not found.", 404)
    try:
        data = json_data()
        for field, label in (("unit_price", "Unit price"), ("total_price", "Total price"), ("additional_charges", "Additional charges")):
            if field in data:
                setattr(quote, field, decimal_amount(data[field], label))
        if "production_days" in data:
            days = int(data["production_days"])
            if days < 1 or days > 365:
                raise ValueError("Production days must be between 1 and 365.")
            quote.production_days = days
        if "admin_note" in data:
            quote.admin_note = str(data["admin_note"]).strip()[:4000] or None
        status = data.get("status")
        if status:
            if status not in {"Reviewing", "Quoted", "Closed"}:
                raise ValueError("Invalid quotation status.")
            if status == "Quoted" and (quote.unit_price is None or quote.total_price is None or quote.production_days is None):
                raise ValueError("Unit price, total price and production days are required before sending a quotation.")
            quote.status = status
        audit("quote_updated", "quote_request", quote.reference)
        if quote.status == "Quoted":
            create_admin_notification(f"Quotation {quote.reference} was prepared for {quote.user.full_name}.", "quote_sent")
        SessionLocal.commit()
        return jsonify({"quote": quote.public(include_customer=True)})
    except (ValueError, TypeError) as exc:
        SessionLocal.rollback()
        return error(str(exc))


@admin_bp.post("/quotes/<int:quote_id>/document")
@require_auth("admin")
def upload_quote_document(quote_id):
    quote = SessionLocal.get(QuoteRequest, quote_id)
    if not quote:
        return error("Quotation request not found.", 404)
    try:
        document = save_upload(request.files.get("document"), "document")
        if not document:
            raise ValueError("A quotation document is required.")
        quote.quotation_path = document
        audit("quote_document_uploaded", "quote_request", quote.reference)
        SessionLocal.commit()
        return jsonify({"quote": quote.public(include_customer=True)})
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))


@admin_bp.post("/inventory/<int:product_id>/adjust")
@require_auth("admin")
def adjust_inventory(product_id):
    product = SessionLocal.get(Product, product_id)
    if not product:
        return error("Product not found.", 404)
    try:
        data = json_data()
        delta = int(data.get("delta"))
        reason = required_text(data, "reason", 120)
        if delta == 0 or product.stock + delta < 0:
            raise ValueError("Adjustment would leave an invalid stock quantity.")
        product.stock += delta
        if getattr(g, "auth_source", None) == "firebase":
            sync_product(product)
        SessionLocal.add(InventoryHistory(product_id=product.id, delta=delta, reason=reason, actor_id=g.current_user.id))
        if product.stock <= Config.LOW_STOCK_THRESHOLD:
            create_admin_notification(f"Low stock: {product.name} has {product.stock} units remaining.", "low_stock")
        audit("inventory_adjusted", "product", product.id, f"{delta}: {reason}")
        SessionLocal.commit()
        return jsonify({"product": product.public(detail=True)})
    except (ValueError, TypeError) as exc:
        SessionLocal.rollback()
        return error(str(exc))


@admin_bp.get("/inventory/history")
@require_auth("admin")
def inventory_history():
    records = SessionLocal.scalars(select(InventoryHistory).order_by(InventoryHistory.created_at.desc()).limit(250)).all()
    return jsonify({"history": [record.public() for record in records]})


@admin_bp.get("/notifications")
@require_auth("admin")
def notifications():
    notices = SessionLocal.scalars(select(Notification).where(Notification.audience == "admin").order_by(Notification.created_at.desc()).limit(100)).all()
    return jsonify({"notifications": [notice.public() for notice in notices]})


@admin_bp.get("/contact-messages")
@require_auth("admin")
def contact_messages():
    messages = SessionLocal.scalars(select(ContactMessage).order_by(ContactMessage.created_at.desc()).limit(250)).all()
    return jsonify({"messages": [message.public() for message in messages]})


@admin_bp.post("/contact-messages/<int:message_id>/resolve")
@require_auth("admin")
def resolve_contact_message(message_id):
    message = SessionLocal.get(ContactMessage, message_id)
    if not message:
        return error("Contact message not found.", 404)
    message.resolved = True
    audit("contact_message_resolved", "contact_message", message_id)
    SessionLocal.commit()
    return jsonify({"message": message.public()})


@admin_bp.post("/notifications/<int:notification_id>/read")
@require_auth("admin")
def read_notification(notification_id):
    notice = SessionLocal.get(Notification, notification_id)
    if not notice or notice.audience != "admin":
        return error("Notification not found.", 404)
    notice.read = True
    SessionLocal.commit()
    return jsonify({"notification": notice.public()})


@admin_bp.get("/analytics")
@require_auth("admin")
def analytics():
    today = datetime.utcnow().date()
    days = []
    for offset in range(6, -1, -1):
        date = today - timedelta(days=offset)
        start = datetime.combine(date, datetime.min.time())
        end = start + timedelta(days=1)
        sales = SessionLocal.scalar(select(func.coalesce(func.sum(Order.total), 0)).where(Order.created_at >= start, Order.created_at < end,
                                                                                             Order.status != "Cancelled")) or 0
        days.append({"date": date.isoformat(), "sales": float(sales)})
    categories = SessionLocal.scalars(select(Category).order_by(Category.name)).all()
    category_counts = []
    for category in categories:
        count = SessionLocal.scalar(select(func.count()).select_from(Product).where(Product.category_id == category.id)) or 0
        category_counts.append({"category": category.name, "products": count})
    year_start = today.replace(month=1, day=1)
    annual_revenue = SessionLocal.scalar(select(func.coalesce(func.sum(Order.total), 0)).where(
        Order.created_at >= year_start, Order.status != "Cancelled")) or 0
    monthly_sales = []
    cursor = today.replace(day=1)
    for _ in range(12):
        previous_month = (cursor - timedelta(days=1)).replace(day=1)
        sales = SessionLocal.scalar(select(func.coalesce(func.sum(Order.total), 0)).where(
            Order.created_at >= previous_month, Order.created_at < cursor, Order.status != "Cancelled")) or 0
        customers = SessionLocal.scalar(select(func.count()).select_from(User).where(
            User.role == "customer", User.created_at >= previous_month, User.created_at < cursor)) or 0
        monthly_sales.append({"month": previous_month.strftime("%Y-%m"), "sales": float(sales), "new_customers": customers})
        cursor = previous_month
    monthly_sales.reverse()
    best_sellers = SessionLocal.execute(select(OrderItem.product_name, func.sum(OrderItem.quantity).label("quantity"))
                                        .join(Order).where(Order.status != "Cancelled")
                                        .group_by(OrderItem.product_name).order_by(func.sum(OrderItem.quantity).desc()).limit(5)).all()
    return jsonify({"daily_sales": days, "monthly_sales": monthly_sales, "annual_revenue": float(annual_revenue), "category_inventory": category_counts,
                    "best_sellers": [{"name": name, "quantity": quantity} for name, quantity in best_sellers],
                    "note": "Revenue excludes cancelled orders. Configure production reporting rules before using for accounting."})
