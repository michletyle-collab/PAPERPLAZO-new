from decimal import Decimal
import hashlib
import hmac

from flask import Blueprint, current_app, g, jsonify, make_response, request
from sqlalchemy import select

from backend.database import SessionLocal
from backend.models import Address, CartItem, Order, OrderItem, Product
from backend.services.orders import create_admin_notification, money
from backend.services.security import audit, error, json_data, require_auth, required_text


orders_bp = Blueprint("orders", __name__, url_prefix="/api")


def shipping_for(subtotal):
    try:
        rate = money(current_app.config["SHIPPING_RATE"])
        free_over = money(current_app.config["FREE_SHIPPING_THRESHOLD"])
    except ValueError:
        rate, free_over = Decimal("0"), Decimal("0")
    return Decimal("0") if free_over > 0 and subtotal >= free_over else rate


def normalise_address(data, user):
    address_id = data.get("address_id")
    if address_id:
        address = SessionLocal.get(Address, int(address_id))
        if not address or address.user_id != user.id:
            raise ValueError("Selected address was not found.")
        return address.public()
    given = data.get("shipping_address")
    if not isinstance(given, dict):
        raise ValueError("A saved address or shipping address is required.")
    values = {}
    for field in ("recipient", "phone", "line1", "city", "state", "postal_code"):
        values[field] = required_text(given, field, 255)
    values["line2"] = str(given.get("line2", ""))[:255] or None
    return values


@orders_bp.post("/orders")
@require_auth()
def create_order():
    try:
        data = json_data()
        payment_method = str(data.get("payment_method", "")).lower()
        if payment_method != "cod":
            return error("Online payment cannot be accepted until a verified provider integration is configured.", 503,
                         "payment_provider_unavailable")
        if not current_app.config["COD_ENABLED"]:
            return error("Cash on delivery is currently unavailable.", 503)
        address = normalise_address(data, g.current_user)
        cart_items = SessionLocal.scalars(select(CartItem).where(CartItem.user_id == g.current_user.id)).all()
        if not cart_items:
            return error("Your cart is empty.", 400)
        subtotal = Decimal("0")
        order_items = []
        for cart_item in cart_items:
            product = cart_item.product
            if not product or product.status != "active" or product.stock < cart_item.quantity:
                raise ValueError(f"{product.name if product else 'A cart item'} is no longer available in the requested quantity.")
            unit_price = product.selling_price
            total = unit_price * cart_item.quantity
            subtotal += total
            order_items.append(OrderItem(product_id=product.id, product_name=product.name, product_code=product.product_code,
                                         unit_price=unit_price, quantity=cart_item.quantity, total=total))
        shipping = shipping_for(subtotal)
        order = Order(user_id=g.current_user.id, payment_method="cod", payment_status="COD", subtotal=subtotal,
                      shipping_total=shipping, discount_total=Decimal("0"), total=subtotal + shipping,
                      shipping_address=address, status="Order Received", items=order_items)
        SessionLocal.add(order)
        for cart_item in cart_items:
            SessionLocal.delete(cart_item)
        SessionLocal.flush()
        audit("order_created", "order", order.order_number)
        create_admin_notification(f"New order {order.order_number} from {g.current_user.full_name}.", "new_order")
        SessionLocal.commit()
        return jsonify({"order": order.public(), "message": "Your order has been received. It will be confirmed after review."}), 201
    except (ValueError, TypeError) as exc:
        SessionLocal.rollback()
        return error(str(exc))


@orders_bp.get("/orders")
@require_auth()
def list_orders():
    orders = SessionLocal.scalars(select(Order).where(Order.user_id == g.current_user.id).order_by(Order.created_at.desc())).all()
    return jsonify({"orders": [order.public() for order in orders]})


@orders_bp.get("/orders/<order_number>")
@require_auth()
def order_detail(order_number):
    order = SessionLocal.scalar(select(Order).where(Order.order_number == order_number))
    if not order or (g.current_user.role != "admin" and order.user_id != g.current_user.id):
        return error("Order not found.", 404)
    return jsonify({"order": order.public(include_user=g.current_user.role == "admin")})


@orders_bp.post("/orders/<order_number>/reorder")
@require_auth()
def reorder(order_number):
    order = SessionLocal.scalar(select(Order).where(Order.order_number == order_number, Order.user_id == g.current_user.id))
    if not order:
        return error("Order not found.", 404)
    for line in order.items:
        product = SessionLocal.get(Product, line.product_id)
        if not product or product.status != "active" or product.stock < line.quantity:
            return error(f"{line.product_name} is currently unavailable in the previous quantity.", 409)
    for line in order.items:
        current = SessionLocal.scalar(select(CartItem).where(CartItem.user_id == g.current_user.id, CartItem.product_id == line.product_id))
        if current:
            current.quantity += line.quantity
        else:
            SessionLocal.add(CartItem(user_id=g.current_user.id, product_id=line.product_id, quantity=line.quantity))
    SessionLocal.commit()
    return jsonify({"message": "Available items were added to your cart."})


@orders_bp.get("/orders/<order_number>/invoice")
@require_auth()
def invoice(order_number):
    order = SessionLocal.scalar(select(Order).where(Order.order_number == order_number))
    if not order or (g.current_user.role != "admin" and order.user_id != g.current_user.id):
        return error("Order not found.", 404)
    rows = "".join(f"<tr><td>{item.product_name}</td><td>{item.quantity}</td><td>₹{item.total:.2f}</td></tr>" for item in order.items)
    address = order.shipping_address
    html = f"""<!doctype html><html><head><meta charset='utf-8'><title>Invoice {order.order_number}</title></head><body style='font:14px Arial;color:#2c241b;max-width:760px;margin:40px auto'><h1>PAPERPLAZO</h1><h2>Invoice {order.order_number}</h2><p>Status: {order.status}<br>Payment: {order.payment_status}</p><p><b>Ship to</b><br>{address['recipient']}<br>{address['line1']}<br>{address['city']}, {address['state']} {address['postal_code']}</p><table style='width:100%;border-collapse:collapse' border='1' cellpadding='9'><tr><th>Product</th><th>Qty</th><th>Total</th></tr>{rows}</table><p style='text-align:right'><b>Shipping: ₹{order.shipping_total:.2f}<br>Grand total: ₹{order.total:.2f}</b></p></body></html>"""
    response = make_response(html)
    response.headers["Content-Type"] = "text/html; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{order.order_number}-invoice.html"'
    return response


@orders_bp.post("/payments/razorpay/webhook")
def razorpay_webhook():
    """Provider-only callback. It refuses unsigned callbacks and never trusts the browser."""
    secret = current_app.config["RAZORPAY_WEBHOOK_SECRET"]
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not secret or not signature:
        return error("Payment webhook is not configured.", 503)
    expected = hmac.new(secret.encode(), request.get_data(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return error("Invalid payment signature.", 400)
    # A provider order-creation adapter should store the provider order reference before activating this endpoint.
    return jsonify({"received": True, "message": "Verified callback received; provider order mapping is not configured."}), 202
