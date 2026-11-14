from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


def utcnow():
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="customer", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    addresses = relationship("Address", back_populates="user", cascade="all, delete-orphan")

    def public(self):
        return {"id": self.id, "email": self.email, "full_name": self.full_name, "phone": self.phone,
                "role": self.role, "created_at": self.created_at.isoformat()}


class Address(Base):
    __tablename__ = "addresses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    label: Mapped[str] = mapped_column(String(50), default="Home")
    recipient: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(30))
    line1: Mapped[str] = mapped_column(String(255))
    line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(100))
    postal_code: Mapped[str] = mapped_column(String(20))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    user = relationship("User", back_populates="addresses")

    def public(self):
        return {key: getattr(self, key) for key in ("id", "label", "recipient", "phone", "line1", "line2", "city", "state", "postal_code", "is_default")}


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    def public(self):
        return {"id": self.id, "name": self.name, "slug": self.slug, "description": self.description, "active": self.active}


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    discount_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    paper_gsm: Mapped[str | None] = mapped_column(String(50), nullable=True)
    dimensions: Mapped[str | None] = mapped_column(String(100), nullable=True)
    handle_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    customization_available: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="active")
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    is_best_seller: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    category = relationship("Category")
    images = relationship("ProductImage", back_populates="product", cascade="all, delete-orphan", order_by="ProductImage.position")

    @property
    def selling_price(self):
        return self.discount_price if self.discount_price is not None else self.price

    def public(self, detail=False):
        base = {"id": self.id, "product_code": self.product_code, "name": self.name, "slug": self.slug,
                "description": self.description, "price": float(self.price),
                "discount_price": float(self.discount_price) if self.discount_price is not None else None,
                "selling_price": float(self.selling_price), "stock": self.stock,
                "in_stock": self.stock > 0 and self.status == "active", "category": self.category.public() if self.category else None,
                "paper_gsm": self.paper_gsm, "dimensions": self.dimensions, "handle_type": self.handle_type,
                "customization_available": self.customization_available, "status": self.status,
                "is_featured": self.is_featured, "is_best_seller": self.is_best_seller,
                "images": [image.public() for image in self.images]}
        if detail:
            base["created_at"] = self.created_at.isoformat()
        return base


class ProductImage(Base):
    __tablename__ = "product_images"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    path: Mapped[str] = mapped_column(String(255))
    alt_text: Mapped[str | None] = mapped_column(String(180), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    product = relationship("Product", back_populates="images")

    def public(self):
        return {"id": self.id, "url": f"/uploads/{self.path}", "alt_text": self.alt_text, "position": self.position}


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_cart_user_product"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    product = relationship("Product")


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_wishlist_user_product"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    product = relationship("Product")


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_number: Mapped[str] = mapped_column(String(40), unique=True, index=True, default=lambda: f"PP-{uuid4().hex[:10].upper()}")
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(40), default="Order Received", index=True)
    payment_status: Mapped[str] = mapped_column(String(30), default="Payment Pending")
    payment_method: Mapped[str] = mapped_column(String(40))
    payment_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    discount_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    shipping_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    shipping_address: Mapped[dict] = mapped_column(JSON)
    stock_deducted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    user = relationship("User")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")

    def public(self, include_user=False):
        data = {"id": self.id, "order_number": self.order_number, "status": self.status, "payment_status": self.payment_status,
                "payment_method": self.payment_method, "subtotal": float(self.subtotal), "discount_total": float(self.discount_total),
                "shipping_total": float(self.shipping_total), "total": float(self.total), "shipping_address": self.shipping_address,
                "stock_deducted": self.stock_deducted, "created_at": self.created_at.isoformat(),
                "items": [item.public() for item in self.items]}
        if include_user:
            data["customer"] = self.user.public()
        return data


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    product_name: Mapped[str] = mapped_column(String(180))
    product_code: Mapped[str] = mapped_column(String(50))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    quantity: Mapped[int] = mapped_column(Integer)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    order = relationship("Order", back_populates="items")
    product = relationship("Product")

    def public(self):
        return {"product_id": self.product_id, "product_name": self.product_name, "product_code": self.product_code,
                "unit_price": float(self.unit_price), "quantity": self.quantity, "total": float(self.total),
                "image": self.product.images[0].public()["url"] if self.product and self.product.images else None}


class QuoteRequest(Base):
    __tablename__ = "quote_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference: Mapped[str] = mapped_column(String(40), unique=True, default=lambda: f"Q-{uuid4().hex[:10].upper()}")
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    width: Mapped[float] = mapped_column(Numeric(10, 2))
    height: Mapped[float] = mapped_column(Numeric(10, 2))
    depth: Mapped[float] = mapped_column(Numeric(10, 2))
    paper_gsm: Mapped[str] = mapped_column(String(50))
    paper_colour: Mapped[str] = mapped_column(String(100))
    handle_type: Mapped[str] = mapped_column(String(100))
    printing_requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer)
    special_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="Requested", index=True)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    additional_charges: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    production_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    quotation_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    user = relationship("User")

    def public(self, include_customer=False):
        data = {"id": self.id, "reference": self.reference, "width": float(self.width), "height": float(self.height), "depth": float(self.depth),
                "paper_gsm": self.paper_gsm, "paper_colour": self.paper_colour, "handle_type": self.handle_type,
                "printing_requirements": self.printing_requirements, "quantity": self.quantity, "special_instructions": self.special_instructions,
                "logo_url": f"/uploads/{self.logo_path}" if self.logo_path else None, "status": self.status,
                "unit_price": float(self.unit_price) if self.unit_price is not None else None,
                "total_price": float(self.total_price) if self.total_price is not None else None,
                "additional_charges": float(self.additional_charges) if self.additional_charges is not None else None,
                "production_days": self.production_days, "admin_note": self.admin_note,
                "quotation_url": f"/uploads/{self.quotation_path}" if self.quotation_path else None,
                "created_at": self.created_at.isoformat()}
        if include_customer:
            data["customer"] = self.user.public()
        return data


class InventoryHistory(Base):
    __tablename__ = "inventory_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(120))
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    product = relationship("Product")

    def public(self):
        return {"id": self.id, "product_id": self.product_id, "product_name": self.product.name if self.product else None,
                "delta": self.delta, "reason": self.reason, "reference": self.reference, "created_at": self.created_at.isoformat()}


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    audience: Mapped[str] = mapped_column(String(20), default="admin", index=True)
    message: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(50))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    def public(self):
        return {"id": self.id, "message": self.message, "kind": self.kind, "read": self.read, "created_at": self.created_at.isoformat()}


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(120))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ContactMessage(Base):
    __tablename__ = "contact_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), index=True)
    subject: Mapped[str] = mapped_column(String(180))
    message: Mapped[str] = mapped_column(Text)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    def public(self):
        return {"id": self.id, "name": self.name, "email": self.email, "subject": self.subject,
                "message": self.message, "resolved": self.resolved, "created_at": self.created_at.isoformat()}
