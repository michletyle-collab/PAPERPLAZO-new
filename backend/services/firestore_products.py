from urllib.parse import quote
from uuid import uuid4

import firebase_admin
from firebase_admin import firestore, storage
from flask import current_app

_backfill_completed = False


def _client():
    if not firebase_admin._apps:
        return None
    return firestore.client()


def _document_data(product, image_url=None, existing=None):
    existing = existing or {}
    category = product.category
    images = [image.public() for image in product.images]
    image_url = image_url or existing.get("imageUrl") or (images[0]["url"] if images else "")
    active = product.status == "active"
    return {
        "id": product.id,
        "name": product.name,
        "description": product.description,
        "price": float(product.price),
        "category": category.name if category else "",
        "categoryId": category.id if category else None,
        "categorySlug": category.slug if category else "",
        "imageUrl": image_url,
        "stock": product.stock,
        "sku": product.product_code,
        "isActive": active,
        "product_code": product.product_code,
        "slug": product.slug,
        "discount_price": float(product.discount_price) if product.discount_price is not None else None,
        "selling_price": float(product.selling_price),
        "in_stock": product.stock > 0 and active,
        "paper_gsm": product.paper_gsm,
        "dimensions": product.dimensions,
        "handle_type": product.handle_type,
        "customization_available": product.customization_available,
        "status": product.status,
        "is_featured": product.is_featured,
        "is_best_seller": product.is_best_seller,
        "images": images,
    }


def sync_products(products):
    global _backfill_completed
    products = list(products)
    client = _client()
    if not client or not products or _backfill_completed:
        return

    references = [client.collection("products").document(str(product.id)) for product in products]
    existing_documents = client.get_all(references)
    existing_by_id = {document.id: document.to_dict() or {} for document in existing_documents if document.exists}
    batch = client.batch()
    for product, reference in zip(products, references):
        if str(product.id) in existing_by_id:
            continue
        payload = _document_data(product)
        payload["createdAt"] = firestore.SERVER_TIMESTAMP
        payload["updatedAt"] = firestore.SERVER_TIMESTAMP
        batch.set(reference, payload, merge=True)
    if any(str(product.id) not in existing_by_id for product in products):
        batch.commit()
    _backfill_completed = True


def sync_product(product, image_url=None):
    client = _client()
    if not client:
        return
    reference = client.collection("products").document(str(product.id))
    snapshot = reference.get()
    previous = snapshot.to_dict() or {} if snapshot.exists else {}
    payload = _document_data(product, image_url=image_url, existing=previous)
    payload["createdAt"] = previous.get("createdAt") or firestore.SERVER_TIMESTAMP
    payload["updatedAt"] = firestore.SERVER_TIMESTAMP
    reference.set(payload, merge=True)


def delete_product_document(product_id):
    client = _client()
    if client:
        client.collection("products").document(str(product_id)).delete()


def upload_product_image(filename, product_id, content_type):
    if not firebase_admin._apps:
        return None
    bucket = storage.bucket()
    token = uuid4().hex
    object_name = f"products/{product_id}/{uuid4().hex}-{filename}"
    blob = bucket.blob(object_name)
    blob.metadata = {"firebaseStorageDownloadTokens": token}
    blob.upload_from_filename(f"{current_app.config['UPLOAD_FOLDER']}/{filename}", content_type=content_type)
    return f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{quote(object_name, safe='')}?alt=media&token={token}"