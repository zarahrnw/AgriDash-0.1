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
    """Helper untuk register + login, mengembalikan access_token."""
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
    assert response.json()["status"] == "ok"


# ==========================================
# TESTING DATA TANAMAN PANGAN
# ==========================================
def test_get_tanaman_pangan_semua():
    response = client.get("/api/v1/tanaman-pangan")
    assert response.status_code == 200
    data = response.json()
    assert "total_data_ditampilkan" in data
    assert "data" in data
    assert isinstance(data["data"], list)
    assert data["total_data_ditampilkan"] == len(data["data"])


def test_get_tanaman_pangan_filter_kecamatan():
    response = client.get("/api/v1/tanaman-pangan?kecamatan=Pare")
    assert response.status_code == 200
    data = response.json()
    assert data["filters"]["kecamatan"] == "Pare"
    for item in data["data"]:
        assert item["kecamatan"].lower() == "pare"


def test_get_ringkasan():
    response = client.get("/api/v1/tanaman-pangan/ringkasan")
    assert response.status_code == 200
    data = response.json()
    assert "total_produksi_ton" in data
    assert data["total_produksi_ton"] > 0
    assert "jumlah_kecamatan" in data
    assert data["jumlah_kecamatan"] >= 1


def test_get_daftar_kecamatan():
    response = client.get("/api/v1/kecamatan")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
    assert "data" in data
    assert data["total"] > 0
    assert isinstance(data["data"], list)
    assert isinstance(data["data"][0], str)


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
    # Upload file CSV dummy
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
    assert data["status_sistem"] == "success"
    assert "hasil_prediksi" in data
    assert "persentase_perubahan" in data["hasil_prediksi"]


def test_prediksi_input_tidak_valid_gagal():
    # bulan_ke_depan negatif / tanaman kosong -> harus 422 (validasi Pydantic)
    response = client.post(
        "/api/v1/prediksi",
        json={"kecamatan": "Pare", "tanaman": "", "bulan_ke_depan": -3},
    )
    assert response.status_code == 422


# ==========================================
# TESTING AUDIT TRAIL & EXECUTIVE SUMMARY
# ==========================================
def test_get_audit_trail_tanpa_token_gagal():
    response = client.get("/api/v1/audit-trail")
    assert response.status_code == 401


def test_get_audit_trail_dengan_token_berhasil():
    token = _register_and_login()
    # Trigger satu aksi yang tercatat (misal upload)
    csv_content = "kecamatan,tanaman,luas_panen_ha,produksi_ton,produktivitas_kuintal_ha\nPare,Padi,10,100,10\n"
    client.post(
        "/api/v1/tanaman-pangan/upload",
        files={"file": ("d.csv", csv_content, "text/csv")},
        headers=_auth_headers(token),
    )

    response = client.get("/api/v1/audit-trail", headers=_auth_headers(token))
    assert response.status_code == 200
    data = response.json()
    # Bentuk respons bisa list langsung atau {total, data}
    if isinstance(data, dict):
        assert "data" in data
        logs = data["data"]
    else:
        logs = data
    assert isinstance(logs, list)


def test_get_dashboard_eksekutif():
    response = client.get("/api/v1/dashboard-eksekutif")
    assert response.status_code == 200
    data = response.json()
    # Minimal pastikan ada ringkasan agregat
    assert isinstance(data, dict)
    assert any(
        key in data
        for key in ("ringkasan", "total_produksi_ton", "top_kecamatan", "data")
    )