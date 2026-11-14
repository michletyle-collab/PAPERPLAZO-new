from decimal import Decimal, ROUND_HALF_UP

from backend.config import Config
from backend.models import InventoryHistory, Notification, Order, Product


ORDER_STATUSES = ["Order Received", "Payment Pending", "Confirmed", "Processing", "Production", "Ready for Dispatch", "Shipped", "Delivered", "Cancelled"]


def money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def create_admin_notification(message, kind):
    from backend.database import SessionLocal
    SessionLocal.add(Notification(audience="admin", message=message, kind=kind))


def deduct_stock(order, actor_id=None):
    """Deduct stock once, after a trusted confirmation/admin status transition."""
    if order.stock_deducted:
        return
    session = __import__("backend.database", fromlist=["SessionLocal"]).SessionLocal
    for item in order.items:
        product = session.get(Product, item.product_id)
        if not product or product.status != "active" or product.stock < item.quantity:
            raise ValueError(f"Insufficient stock for {item.product_name}.")
        product.stock -= item.quantity
        session.add(InventoryHistory(product_id=product.id, delta=-item.quantity, reason="Confirmed order",
                                     reference=order.order_number, actor_id=actor_id))
        if product.stock <= Config.LOW_STOCK_THRESHOLD:
            create_admin_notification(f"Low stock: {product.name} has {product.stock} units remaining.", "low_stock")
    order.stock_deducted = True


def set_order_status(order: Order, status: str, actor_id=None):
    if status not in ORDER_STATUSES:
        raise ValueError("Invalid order status.")
    if order.status == "Cancelled" and status != "Cancelled":
        raise ValueError("Cancelled orders cannot be reopened.")
    if status == "Confirmed":
        deduct_stock(order, actor_id)
    order.status = status
    if status == "Confirmed":
        create_admin_notification(f"Order {order.order_number} was confirmed.", "order_confirmed")
    elif status == "Shipped":
        create_admin_notification(f"Order {order.order_number} was marked shipped.", "order_shipped")
