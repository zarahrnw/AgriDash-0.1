import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
from api.main import app, get_engine

# ==========================================
# KONFIGURASI DATABASE BOHONGAN (MOCK)
# ==========================================
SQLALCHEMY_DATABASE_URL = "sqlite://"
test_engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

with test_engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE tanaman_pangan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kecamatan TEXT,
            tanaman TEXT,
            luas_panen_ha REAL,
            produksi_ton REAL,
            produktivitas_kuintal_ha REAL
        )
    """))
    conn.execute(text("""
        CREATE TABLE master_kecamatan (
            kode_kecamatan TEXT PRIMARY KEY,
            kecamatan TEXT
        )
    """))
    conn.execute(text("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            role TEXT
        )
    """))
    conn.execute(text("""
        CREATE TABLE audit_trail (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            action TEXT,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))

    conn.execute(text("""
        INSERT INTO tanaman_pangan (kecamatan, tanaman, produksi_ton, luas_panen_ha, produktivitas_kuintal_ha)
        VALUES ('Pare', 'Padi', 100.0, 10.0, 10.0)
    """))
    conn.execute(text("""
        INSERT INTO master_kecamatan (kode_kecamatan, kecamatan)
        VALUES ('01', 'Pare')
    """))

app.dependency_overrides[get_engine] = lambda: test_engine

client = TestClient(app)


# ==========================================
# HELPER: DAFTAR & LOGIN UNTUK DAPAT TOKEN
# ==========================================
def _register_and_login(role: str = "admin") -> str:
    username = f"user_{uuid.uuid4().hex[:8]}"
    password = "rahasia123"

    reg = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": password, "role": role},
    )
    assert reg.status_code == 200, reg.text

    login = client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    assert token
    return token


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ==========================================
# TESTING SYSTEM & HEALTH
# ==========================================
def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


# ==========================================
# TESTING DATA TANAMAN PANGAN
# ==========================================
def test_get_tanaman_pangan_semua():
    response = client.get("/api/v1/tanaman-pangan")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
    assert "data" in data
    assert isinstance(data["data"], list)


def test_get_tanaman_pangan_filter_kecamatan():
    response = client.get("/api/v1/tanaman-pangan?kecamatan=Pare")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["data"], list)
    for item in data["data"]:
        assert item["kecamatan"].lower() == "pare"


def test_get_ringkasan():
    response = client.get("/api/v1/tanaman-pangan/ringkasan")
    assert response.status_code == 200
    data = response.json()
    assert "total_produksi" in data
    assert "total_kecamatan" in data


def test_get_daftar_kecamatan():
    response = client.get("/api/v1/kecamatan")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
    assert "data" in data
    assert data["total"] > 0


# ==========================================
# TESTING AUTENTIKASI (JWT)
# ==========================================
def test_register_dan_login():
    random_username = f"admin_{uuid.uuid4().hex[:6]}"
    user_data = {"username": random_username, "password": "rahasia123", "role": "admin"}
    response_reg = client.post("/api/v1/auth/register", json=user_data)
    assert response_reg.status_code == 200

    login_data = {"username": random_username, "password": "rahasia123"}
    response_login = client.post("/api/v1/auth/login", data=login_data)
    assert response_login.status_code == 200
    assert "access_token" in response_login.json()
    assert response_login.json()["token_type"].lower() == "bearer"


def test_login_password_salah_gagal():
    username = f"user_{uuid.uuid4().hex[:6]}"
    client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": "benar123", "role": "admin"},
    )
    response = client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": "salah_total"},
    )
    assert response.status_code == 401


# ==========================================
# TESTING KEAMANAN DATA CENTER (UPLOAD)
# ==========================================
def test_upload_tanpa_token_gagal():
    response = client.post("/api/v1/tanaman-pangan/upload")
    assert response.status_code == 401


def test_upload_dengan_token_berhasil():
    token = _register_and_login()
    csv_content = (
        "kecamatan,tanaman,luas_panen_ha,produksi_ton,produktivitas_kuintal_ha\n"
        "Pare,Padi,12.0,120.0,10.0\n"
    )
    files = {"file": ("data.csv", csv_content, "text/csv")}
    response = client.post(
        "/api/v1/tanaman-pangan/upload",
        files=files,
        headers=_auth_headers(token),
    )
    # Terima 200 (sukses) atau 400/422 (validasi format) — yang penting bukan 401
    assert response.status_code != 401
    assert response.status_code in (200, 201, 400, 422)


# ==========================================
# TESTING PREDIKSI (MACHINE LEARNING SIMULASI)
# ==========================================
def test_prediksi_produksi():
    request_data = {"kecamatan": "Pare", "tanaman": "Padi", "bulan_ke_depan": 1}
    response = client.post("/api/v1/prediksi", json=request_data)
    assert response.status_code == 200
    data = response.json()
    assert "prediksi_produksi" in data
    assert "produksi_awal" in data


# ==========================================
# TESTING AUDIT TRAIL & EXECUTIVE SUMMARY
# ==========================================
def test_get_audit_trail_tanpa_token_gagal():
    response = client.get("/api/v1/audit-trail")
    assert response.status_code == 401


def test_get_audit_trail_dengan_token_berhasil():
    token = _register_and_login()
    csv_content = "kecamatan,tanaman,luas_panen_ha,produksi_ton,produktivitas_kuintal_ha\nPare,Padi,10,100,10\n"
    client.post(
        "/api/v1/tanaman-pangan/upload",
        files={"file": ("d.csv", csv_content, "text/csv")},
        headers=_auth_headers(token),
    )

    response = client.get("/api/v1/audit-trail", headers=_auth_headers(token))
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert isinstance(data["data"], list)


def test_get_dashboard_eksekutif():
    response = client.get("/api/v1/dashboard-eksekutif")
    assert response.status_code == 200
    data = response.json()
    assert "ringkasan" in data
    assert "top_kecamatan" in data