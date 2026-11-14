import re
from decimal import Decimal

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, or_, select

from backend.database import SessionLocal
from backend.models import Category, Product, ProductImage, WishlistItem
from backend.services.firestore_products import (
    delete_product_document,
    sync_product,
    sync_products,
    upload_product_image as upload_product_image_to_firebase,
)
from backend.services.security import audit, error, json_data, require_auth, required_text
from backend.services.uploads import save_upload


products_bp = Blueprint("products", __name__, url_prefix="/api")


def slugify(value):
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value[:190] or "product"


def as_bool(value):
    return value is True or str(value).lower() in {"true", "1", "yes", "on"}


def positive_money(value, field, allow_zero=False):
    try:
        result = Decimal(str(value)).quantize(Decimal("0.01"))
    except Exception as exc:
        raise ValueError(f"{field} must be a valid amount.") from exc
    if result < 0 or (not allow_zero and result == 0):
        raise ValueError(f"{field} must be {'zero or greater' if allow_zero else 'greater than zero'}.")
    return result


def product_payload(data, create=False):
    payload = {}
    required = ("product_code", "name", "description", "price") if create else ()
    for key in required:
        required_text(data, key, 500)
    if "product_code" in data:
        payload["product_code"] = required_text(data, "product_code", 50).upper()
    if "name" in data:
        payload["name"] = required_text(data, "name", 180)
    if "description" in data:
        payload["description"] = required_text(data, "description", 10000)
    if "price" in data:
        payload["price"] = positive_money(data["price"], "Price")
    if "discount_price" in data:
        payload["discount_price"] = None if data["discount_price"] in (None, "") else positive_money(data["discount_price"], "Discount price")
        if payload.get("price") and payload["discount_price"] and payload["discount_price"] > payload["price"]:
            raise ValueError("Discount price cannot be higher than price.")
    if "stock" in data:
        try:
            stock = int(data["stock"])
        except (TypeError, ValueError) as exc:
            raise ValueError("Stock must be a whole number.") from exc
        if stock < 0:
            raise ValueError("Stock cannot be negative.")
        payload["stock"] = stock
    if "category_id" in data:
        category_id = data["category_id"]
        if category_id in (None, ""):
            payload["category_id"] = None
        else:
            category = SessionLocal.get(Category, int(category_id))
            if not category:
                raise ValueError("Selected category does not exist.")
            payload["category_id"] = category.id
    for field, limit in (("paper_gsm", 50), ("dimensions", 100), ("handle_type", 100)):
        if field in data:
            payload[field] = str(data[field]).strip()[:limit] or None
    if "status" in data:
        status = str(data["status"])
        if status not in {"active", "inactive", "draft"}:
            raise ValueError("Invalid product status.")
        payload["status"] = status
    for field in ("customization_available", "is_featured", "is_best_seller"):
        if field in data:
            payload[field] = as_bool(data[field])
    return payload


@products_bp.get("/products")
def list_products():
    query = select(Product).where(Product.status == "active")
    search = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    if search:
        term = f"%{search[:100]}%"
        query = query.where(or_(Product.name.ilike(term), Product.product_code.ilike(term), Product.description.ilike(term)))
    if category:
        query = query.join(Category).where(Category.slug == category)
    if request.args.get("featured") == "true":
        query = query.where(Product.is_featured.is_(True))
    if request.args.get("best_sellers") == "true":
        query = query.where(Product.is_best_seller.is_(True))
    sort = request.args.get("sort", "newest")
    order_by = {"price_asc": Product.selling_price if False else Product.price.asc(), "price_desc": Product.price.desc(), "name": Product.name.asc()}
    query = query.order_by(order_by.get(sort, Product.created_at.desc()))
    page = max(int(request.args.get("page", 1)), 1)
    per_page = min(max(int(request.args.get("per_page", 24)), 1), 100)
    total = SessionLocal.scalar(select(func.count()).select_from(query.subquery()))
    products = SessionLocal.scalars(query.offset((page - 1) * per_page).limit(per_page)).all()
    return jsonify({"products": [product.public() for product in products], "page": page, "per_page": per_page, "total": total})


@products_bp.get("/products/<slug>")
def product_detail(slug):
    product = SessionLocal.scalar(select(Product).where(Product.slug == slug, Product.status == "active"))
    if not product:
        return error("Product not found.", 404)
    related = []
    if product.category_id:
        related = SessionLocal.scalars(select(Product).where(Product.category_id == product.category_id, Product.id != product.id,
                                                             Product.status == "active").limit(4)).all()
    return jsonify({"product": product.public(detail=True), "related": [item.public() for item in related]})


@products_bp.get("/categories")
def categories():
    categories = SessionLocal.scalars(select(Category).where(Category.active.is_(True)).order_by(Category.name)).all()
    return jsonify({"categories": [category.public() for category in categories]})


@products_bp.get("/wishlist")
@require_auth()
def wishlist():
    items = SessionLocal.scalars(select(WishlistItem).where(WishlistItem.user_id == g.current_user.id)).all()
    return jsonify({"products": [item.product.public() for item in items if item.product and item.product.status == "active"]})


@products_bp.post("/wishlist/<int:product_id>")
@require_auth()
def add_wishlist(product_id):
    product = SessionLocal.get(Product, product_id)
    if not product or product.status != "active":
        return error("Product not found.", 404)
    existing = SessionLocal.scalar(select(WishlistItem).where(WishlistItem.user_id == g.current_user.id, WishlistItem.product_id == product_id))
    if not existing:
        SessionLocal.add(WishlistItem(user_id=g.current_user.id, product_id=product_id))
        SessionLocal.commit()
    return jsonify({"message": "Saved to favourites."}), 201


@products_bp.delete("/wishlist/<int:product_id>")
@require_auth()
def remove_wishlist(product_id):
    item = SessionLocal.scalar(select(WishlistItem).where(WishlistItem.user_id == g.current_user.id, WishlistItem.product_id == product_id))
    if item:
        SessionLocal.delete(item)
        SessionLocal.commit()
    return "", 204


@products_bp.get("/admin/products")
@require_auth("admin")
def admin_products():
    query = select(Product)
    q = request.args.get("q", "").strip()
    if q:
        query = query.where(or_(Product.name.ilike(f"%{q[:100]}%"), Product.product_code.ilike(f"%{q[:100]}%")))
    products = SessionLocal.scalars(query.order_by(Product.created_at.desc())).all()
    if getattr(g, "auth_source", None) == "firebase":
        sync_products(products)
    return jsonify({"products": [item.public(detail=True) for item in products]})


@products_bp.post("/admin/products")
@require_auth("admin")
def create_product():
    try:
        data = json_data()
        payload = product_payload(data, create=True)
        if SessionLocal.scalar(select(Product).where(Product.product_code == payload["product_code"])):
            return error("Product code already exists.", 409)
        base_slug = slugify(data.get("slug") or payload["name"])
        slug = base_slug
        suffix = 2
        while SessionLocal.scalar(select(Product).where(Product.slug == slug)):
            slug = f"{base_slug}-{suffix}"; suffix += 1
        product = Product(slug=slug, **payload)
        SessionLocal.add(product)
        SessionLocal.flush()
        audit("product_created", "product", product.product_code)
        if getattr(g, "auth_source", None) == "firebase":
            sync_product(product)
        SessionLocal.commit()
        return jsonify({"product": product.public(detail=True)}), 201
    except (ValueError, TypeError) as exc:
        SessionLocal.rollback()
        return error(str(exc))


@products_bp.patch("/admin/products/<int:product_id>")
@require_auth("admin")
def update_product(product_id):
    product = SessionLocal.get(Product, product_id)
    if not product:
        return error("Product not found.", 404)
    try:
        data = json_data()
        payload = product_payload(data)
        if "product_code" in payload:
            duplicate = SessionLocal.scalar(select(Product).where(Product.product_code == payload["product_code"], Product.id != product.id))
            if duplicate:
                return error("Product code already exists.", 409)
        for key, value in payload.items():
            setattr(product, key, value)
        audit("product_updated", "product", product.id)
        if getattr(g, "auth_source", None) == "firebase":
            sync_product(product)
        SessionLocal.commit()
        return jsonify({"product": product.public(detail=True)})
    except (ValueError, TypeError) as exc:
        SessionLocal.rollback()
        return error(str(exc))


@products_bp.delete("/admin/products/<int:product_id>")
@require_auth("admin")
def deactivate_product(product_id):
    product = SessionLocal.get(Product, product_id)
    if not product:
        return error("Product not found.", 404)
    product.status = "inactive"
    audit("product_deactivated", "product", product.id)
    if getattr(g, "auth_source", None) == "firebase":
        delete_product_document(product.id)
    SessionLocal.commit()
    return "", 204


@products_bp.post("/admin/products/<int:product_id>/images")
@require_auth("admin")
def upload_product_image(product_id):
    product = SessionLocal.get(Product, product_id)
    if not product:
        return error("Product not found.", 404)
    try:
        filename = save_upload(request.files.get("image"), "image")
        if not filename:
            raise ValueError("An image is required.")
        image = ProductImage(product_id=product.id, path=filename, alt_text=str(request.form.get("alt_text", ""))[:180] or None,
                             position=len(product.images))
        SessionLocal.add(image)
        SessionLocal.flush()
        image_url = None
        if getattr(g, "auth_source", None) == "firebase":
            image_url = upload_product_image_to_firebase(filename, product.id, request.files["image"].mimetype)
            sync_product(product, image_url=image_url)
        audit("product_image_uploaded", "product", product.id)
        SessionLocal.commit()
        return jsonify({"image": {**image.public(), "url": image_url or image.public()["url"]}}), 201
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))


@products_bp.post("/admin/categories")
@require_auth("admin")
def create_category():
    try:
        data = json_data()
        name = required_text(data, "name", 100)
        slug = slugify(data.get("slug") or name)
        if SessionLocal.scalar(select(Category).where(or_(Category.name == name, Category.slug == slug))):
            return error("A category with that name already exists.", 409)
        category = Category(name=name, slug=slug, description=str(data.get("description", ""))[:1000] or None)
        SessionLocal.add(category)
        audit("category_created", "category", slug)
        SessionLocal.commit()
        return jsonify({"category": category.public()}), 201
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))


@products_bp.get("/admin/categories")
@require_auth("admin")
def admin_categories():
    categories = SessionLocal.scalars(select(Category).order_by(Category.name)).all()
    return jsonify({"categories": [category.public() for category in categories]})


@products_bp.patch("/admin/categories/<int:category_id>")
@require_auth("admin")
def update_category(category_id):
    category = SessionLocal.get(Category, category_id)
    if not category:
        return error("Category not found.", 404)
    try:
        data = json_data()
        if "name" in data:
            category.name = required_text(data, "name", 100)
        if "slug" in data and str(data["slug"]).strip():
            category.slug = slugify(data["slug"])
        if "description" in data:
            category.description = str(data["description"]).strip()[:1000] or None
        if "active" in data:
            category.active = as_bool(data["active"])
        duplicate = SessionLocal.scalar(select(Category).where(or_(Category.name == category.name, Category.slug == category.slug), Category.id != category.id))
        if duplicate:
            return error("A category with that name or slug already exists.", 409)
        audit("category_updated", "category", category.id)
        SessionLocal.commit()
        return jsonify({"category": category.public()})
    except ValueError as exc:
        SessionLocal.rollback()
        return error(str(exc))
