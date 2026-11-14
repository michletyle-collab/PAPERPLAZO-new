from decimal import Decimal

from flask import Blueprint, g, jsonify
from sqlalchemy import select

from backend.database import SessionLocal
from backend.models import CartItem, Product
from backend.services.security import error, json_data, require_auth


cart_bp = Blueprint("cart", __name__, url_prefix="/api/cart")


def cart_response():
    items = SessionLocal.scalars(select(CartItem).where(CartItem.user_id == g.current_user.id)).all()
    lines = []
    subtotal = Decimal("0")
    for item in items:
        if not item.product or item.product.status != "active":
            continue
        price = item.product.selling_price
        line_total = price * item.quantity
        subtotal += line_total
        lines.append({"id": item.id, "product": item.product.public(), "quantity": item.quantity, "line_total": float(line_total)})
    return {"items": lines, "subtotal": float(subtotal), "count": sum(item["quantity"] for item in lines)}


@cart_bp.get("")
@require_auth()
def get_cart():
    return jsonify(cart_response())


@cart_bp.post("/items")
@require_auth()
def add_item():
    try:
        data = json_data()
        product_id = int(data.get("product_id"))
        quantity = int(data.get("quantity", 1))
        if quantity < 1:
            raise ValueError("Quantity must be at least one.")
    except (TypeError, ValueError):
        return error("Product and a valid quantity are required.")
    product = SessionLocal.get(Product, product_id)
    if not product or product.status != "active":
        return error("Product is not available.", 404)
    item = SessionLocal.scalar(select(CartItem).where(CartItem.user_id == g.current_user.id, CartItem.product_id == product_id))
    desired = quantity + (item.quantity if item else 0)
    if product.stock < desired:
        return error(f"Only {product.stock} unit(s) of this product are currently available.", 409)
    if item:
        item.quantity = desired
    else:
        SessionLocal.add(CartItem(user_id=g.current_user.id, product_id=product_id, quantity=quantity))
    SessionLocal.commit()
    return jsonify(cart_response()), 201


@cart_bp.patch("/items/<int:item_id>")
@require_auth()
def update_item(item_id):
    item = SessionLocal.get(CartItem, item_id)
    if not item or item.user_id != g.current_user.id:
        return error("Cart item not found.", 404)
    try:
        quantity = int(json_data().get("quantity"))
        if quantity < 1:
            raise ValueError
    except (TypeError, ValueError):
        return error("Quantity must be at least one.")
    if not item.product or item.product.stock < quantity:
        return error("Requested quantity is not available.", 409)
    item.quantity = quantity
    SessionLocal.commit()
    return jsonify(cart_response())


@cart_bp.delete("/items/<int:item_id>")
@require_auth()
def delete_item(item_id):
    item = SessionLocal.get(CartItem, item_id)
    if not item or item.user_id != g.current_user.id:
        return error("Cart item not found.", 404)
    SessionLocal.delete(item)
    SessionLocal.commit()
    return "", 204
