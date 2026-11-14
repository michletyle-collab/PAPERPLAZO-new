"""Integration tests for the shared customer/admin backend contract."""
import os
from io import BytesIO
from pathlib import Path

TEST_DB = Path(__file__).resolve().parent / "paperplazo_test.db"
TEST_UPLOADS = Path(__file__).resolve().parent / "test_uploads"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["UPLOAD_FOLDER"] = str(TEST_UPLOADS)
os.environ["APP_SECRET_KEY"] = "test-app-secret-not-for-production"
os.environ["JWT_SECRET_KEY"] = "test-jwt-secret-not-for-production"
os.environ["ADMIN_EMAIL"] = "admin@test.local"
os.environ["ADMIN_PASSWORD"] = "test-admin-password-123"
os.environ["COD_ENABLED"] = "true"

import pytest  # noqa: E402
from backend.app import create_app  # noqa: E402
from backend.database import Base, SessionLocal, engine  # noqa: E402
from backend.models import User  # noqa: E402
from backend.routes import products as product_routes  # noqa: E402
from backend.services import security  # noqa: E402


@pytest.fixture()
def client():
    TEST_UPLOADS.mkdir(parents=True, exist_ok=True)
    for uploaded in TEST_UPLOADS.iterdir():
        if uploaded.is_file():
            uploaded.unlink()
    Base.metadata.drop_all(engine)
    app = create_app()
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client
    SessionLocal.remove()
    Base.metadata.drop_all(engine)
    for uploaded in TEST_UPLOADS.iterdir():
        if uploaded.is_file():
            uploaded.unlink()


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def firebase_admin_headers(monkeypatch):
    def fake_verify(token):
        assert token == "firebase-admin-token"
        return {
            "uid": "firebase-admin-uid",
            "sub": "firebase-admin-uid",
            "email": "admin@paperplazo.test",
            "name": "Firebase Administrator",
            "admin": True,
            "aud": "paperplazo",
            "iss": "https://securetoken.google.com/paperplazo",
            "exp": 4102444800,
        }

    monkeypatch.setattr(security, "verify_firebase_token", fake_verify)
    # Firebase Admin/Storage network calls are outside this Flask regression
    # suite; the endpoint is exercised with an authenticated Firebase admin.
    monkeypatch.setattr(product_routes, "sync_product", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(product_routes, "sync_products", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        product_routes,
        "upload_product_image_to_firebase",
        lambda *_args, **_kwargs: "https://firebasestorage.googleapis.com/mock-product-image.png",
    )
    return headers("firebase-admin-token")


def test_firebase_admin_claim_is_enforced_via_token(monkeypatch, client):
    def fake_verify(token):
        assert token == "firebase-admin-token"
        return {"uid": "admin-uid", "email": "admin@paperplazo.test", "admin": True, "exp": 4102444800}

    monkeypatch.setattr(security, "verify_firebase_token", fake_verify)

    response = client.get("/api/admin/dashboard", headers={"Authorization": "Bearer firebase-admin-token"})
    assert response.status_code == 200


def test_firebase_customer_claim_is_rejected_for_admin(monkeypatch, client):
    def fake_verify(token):
        assert token == "firebase-customer-token"
        return {"uid": "customer-uid", "email": "customer@paperplazo.test", "admin": False, "exp": 4102444800}

    monkeypatch.setattr(security, "verify_firebase_token", fake_verify)

    response = client.get("/api/admin/dashboard", headers={"Authorization": "Bearer firebase-customer-token"})
    assert response.status_code == 403


def test_legacy_admin_jwt_is_rejected_for_admin_endpoint(client):
    token = security.jwt.encode({"sub": "42", "role": "admin", "exp": 4102444800, "iat": 1},
                                security._jwt_secret(), algorithm="HS256")
    response = client.get("/api/admin/dashboard", headers=headers(token))
    assert response.status_code == 401
    assert response.get_json()["code"] == "invalid_token"


def test_legacy_admin_claim_token_is_rejected_for_admin_endpoint(client):
    token = security.jwt.encode({"sub": "42", "role": "admin", "admin": True, "exp": 4102444800, "iat": 1},
                                security._jwt_secret(), algorithm="HS256")
    response = client.get("/api/admin/dashboard", headers=headers(token))
    assert response.status_code == 401
    assert response.get_json()["code"] == "invalid_token"


def test_legacy_jwts_are_rejected_by_every_admin_product_write(client):
    legacy_token = security.jwt.encode(
        {"sub": "42", "role": "admin", "admin": True, "exp": 4102444800, "iat": 1},
        security._jwt_secret(),
        algorithm="HS256",
    )
    admin_headers = headers(legacy_token)
    responses = [
        client.post("/api/admin/products", headers=admin_headers, json={}),
        client.patch("/api/admin/products/1", headers=admin_headers, json={}),
        client.delete("/api/admin/products/1", headers=admin_headers),
        client.post("/api/admin/products/1/images", headers=admin_headers),
    ]
    assert all(response.status_code == 401 for response in responses)
    assert all(response.get_json()["code"] == "invalid_token" for response in responses)


def test_missing_authorization_header_is_rejected(client):
    response = client.get("/api/admin/dashboard")
    assert response.status_code == 401
    assert response.get_json()["code"] == "authentication_required"


def test_expired_firebase_token_is_rejected(monkeypatch, client):
    def fake_verify(_token):
        raise ValueError("Expired token")

    monkeypatch.setattr(security, "verify_firebase_token", fake_verify)
    response = client.get("/api/admin/dashboard", headers={"Authorization": "Bearer expired-token"})
    assert response.status_code == 401
    assert response.get_json()["code"] == "invalid_token"


def test_invalid_firebase_token_is_rejected(monkeypatch, client):
    def fake_verify(_token):
        raise ValueError("Invalid token")

    monkeypatch.setattr(security, "verify_firebase_token", fake_verify)
    response = client.get("/api/admin/dashboard", headers={"Authorization": "Bearer invalid-token"})
    assert response.status_code == 401
    assert response.get_json()["code"] == "invalid_token"


def test_legacy_admin_login_is_disabled(client):
    response = client.post("/api/auth/admin/login", json={"email": "admin@test.local", "password": "test-admin-password-123"})
    assert response.status_code == 410
    assert response.get_json()["code"] == "firebase_auth_required"


def test_customer_order_is_visible_to_admin_and_deducts_stock_on_confirmation(client, firebase_admin_headers):
    admin_token = firebase_admin_headers["Authorization"].removeprefix("Bearer ")

    category = client.post("/api/admin/categories", headers=headers(admin_token), json={"name": "Retail bags"})
    assert category.status_code == 201
    product = client.post("/api/admin/products", headers=headers(admin_token), json={
        "product_code": "PP-RETAIL-01", "name": "Retail Carry", "description": "Premium paper carry bag.",
        "price": 125, "stock": 15, "category_id": category.get_json()["category"]["id"], "status": "active",
    })
    assert product.status_code == 201
    product_id = product.get_json()["product"]["id"]

    registration = client.post("/api/auth/register", json={
        "full_name": "Asha Kumar", "email": "asha@example.com", "password": "a-strong-customer-password", "phone": "9999999999",
    })
    assert registration.status_code == 201
    customer_token = registration.get_json()["token"]
    added = client.post("/api/cart/items", headers=headers(customer_token), json={"product_id": product_id, "quantity": 2})
    assert added.status_code == 201

    order = client.post("/api/orders", headers=headers(customer_token), json={
        "payment_method": "cod", "shipping_address": {"recipient": "Asha Kumar", "phone": "9999999999", "line1": "12 Paper Lane", "city": "Pune", "state": "Maharashtra", "postal_code": "411001"},
    })
    assert order.status_code == 201
    order_number = order.get_json()["order"]["order_number"]

    listed = client.get("/api/admin/orders", headers=headers(admin_token))
    assert any(item["order_number"] == order_number for item in listed.get_json()["orders"])
    confirmed = client.patch(f"/api/admin/orders/{order_number}", headers=headers(admin_token), json={"status": "Confirmed"})
    assert confirmed.status_code == 200
    assert confirmed.get_json()["order"]["stock_deducted"] is True

    admin_products = client.get("/api/admin/products", headers=headers(admin_token))
    updated = next(item for item in admin_products.get_json()["products"] if item["id"] == product_id)
    assert updated["stock"] == 13


def test_customer_cannot_submit_unverified_online_payment(client):
    registration = client.post("/api/auth/register", json={"full_name": "Ravi Shah", "email": "ravi@example.com", "password": "another-strong-password"})
    token = registration.get_json()["token"]
    response = client.post("/api/orders", headers=headers(token), json={"payment_method": "razorpay"})
    assert response.status_code == 503
    assert response.get_json()["code"] == "payment_provider_unavailable"


def test_catalog_quote_contact_and_admin_management_endpoints(client, firebase_admin_headers):
    admin_token = firebase_admin_headers["Authorization"].removeprefix("Bearer ")
    category = client.post("/api/admin/categories", headers=headers(admin_token), json={"name": "Gift bags", "description": "For considered gifting."})
    category_id = category.get_json()["category"]["id"]
    assert client.patch(f"/api/admin/categories/{category_id}", headers=headers(admin_token), json={"description": "Gift packaging.", "active": True}).status_code == 200
    product = client.post("/api/admin/products", headers=headers(admin_token), json={
        "product_code": "PP-GIFT-01", "name": "Signature Gift", "description": "A premium gift bag.", "price": 300,
        "discount_price": 250, "stock": 20, "category_id": category_id, "paper_gsm": "180 GSM", "dimensions": "200 × 100 × 250 mm",
        "handle_type": "Ribbon", "customization_available": True, "is_featured": True, "is_best_seller": True, "status": "active",
    }).get_json()["product"]
    assert client.get("/api/categories").status_code == 200
    public_list = client.get("/api/products?q=Signature&sort=price_asc")
    assert public_list.status_code == 200 and public_list.get_json()["total"] == 1
    assert client.get(f"/api/products/{product['slug']}").status_code == 200
    upload = client.post(f"/api/admin/products/{product['id']}/images", headers=headers(admin_token), data={
        "image": (BytesIO(b"not-a-real-png-but-validated-by-mimetype"), "gift.png", "image/png"), "alt_text": "Gift bag"
    }, content_type="multipart/form-data")
    assert upload.status_code == 201
    assert client.patch(f"/api/admin/products/{product['id']}", headers=headers(admin_token), json={"stock": 22, "is_featured": False}).status_code == 200
    assert client.post(f"/api/admin/inventory/{product['id']}/adjust", headers=headers(admin_token), json={"delta": 2, "reason": "Stocktake"}).status_code == 200
    assert client.get("/api/admin/inventory/history", headers=headers(admin_token)).status_code == 200

    registered = client.post("/api/auth/register", json={"full_name": "Meera Patel", "email": "meera@example.com", "password": "a-new-customer-password"})
    customer_token = registered.get_json()["token"]
    assert client.post(f"/api/wishlist/{product['id']}", headers=headers(customer_token)).status_code == 201
    assert len(client.get("/api/wishlist", headers=headers(customer_token)).get_json()["products"]) == 1
    assert client.delete(f"/api/wishlist/{product['id']}", headers=headers(customer_token)).status_code == 204
    address = client.post("/api/auth/addresses", headers=headers(customer_token), json={"recipient": "Meera Patel", "phone": "8888888888", "line1": "9 Kraft Road", "city": "Mumbai", "state": "Maharashtra", "postal_code": "400001", "is_default": True})
    assert address.status_code == 201
    assert client.patch("/api/auth/me", headers=headers(customer_token), json={"phone": "7777777777"}).status_code == 200

    quote = client.post("/api/custom-orders", headers=headers(customer_token), data={
        "width": "220", "height": "280", "depth": "110", "paper_gsm": "150 GSM", "paper_colour": "Natural kraft",
        "handle_type": "Twisted paper", "quantity": "500", "printing_requirements": "One colour logo", "special_instructions": "Matte finish",
    }, content_type="multipart/form-data")
    assert quote.status_code == 201
    quote_id = quote.get_json()["quote"]["id"]
    assert client.get("/api/custom-orders", headers=headers(customer_token)).status_code == 200
    quote_update = client.patch(f"/api/admin/quotes/{quote_id}", headers=headers(admin_token), json={
        "unit_price": 18, "total_price": 9000, "additional_charges": 0, "production_days": 12, "admin_note": "Artwork approval required.", "status": "Quoted",
    })
    assert quote_update.status_code == 200
    quote_document = client.post(f"/api/admin/quotes/{quote_id}/document", headers=headers(admin_token), data={
        "document": (BytesIO(b"%PDF-1.4 test quotation"), "quotation.pdf", "application/pdf")
    }, content_type="multipart/form-data")
    assert quote_document.status_code == 200
    assert client.post(f"/api/custom-orders/{quote_id}/decision", headers=headers(customer_token), json={"decision": "accept"}).get_json()["quote"]["status"] == "Accepted"

    contact = client.post("/api/contact", json={"name": "Visitor", "email": "visitor@example.com", "subject": "Catalog question", "message": "Can I order samples?"})
    assert contact.status_code == 201
    messages = client.get("/api/admin/contact-messages", headers=headers(admin_token)).get_json()["messages"]
    assert messages and client.post(f"/api/admin/contact-messages/{messages[0]['id']}/resolve", headers=headers(admin_token)).status_code == 200
    assert client.get("/api/admin/dashboard", headers=headers(admin_token)).status_code == 200
    assert client.get("/api/admin/analytics", headers=headers(admin_token)).status_code == 200
    assert client.get("/api/admin/notifications", headers=headers(admin_token)).status_code == 200
    assert client.delete(f"/api/admin/products/{product['id']}", headers=headers(admin_token)).status_code == 204
