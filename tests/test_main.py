import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
from api.main import app, get_engine

# ==========================================
# KONFIGURASI DATABASE BOHONGAN (MOCK)
# ==========================================
# Menggunakan SQLite di RAM agar testing tidak menyentuh database Supabase asli
SQLALCHEMY_DATABASE_URL = "sqlite://"
test_engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False}, 
    poolclass=StaticPool
)

# Membuat struktur tabel persis seperti di Supabase
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
    
    # Memasukkan Data Dummy untuk Testing
    conn.execute(text("""
        INSERT INTO tanaman_pangan (kecamatan, tanaman, produksi_ton, luas_panen_ha, produktivitas_kuintal_ha) 
        VALUES ('Pare', 'Padi', 100.0, 10.0, 10.0)
    """))
    conn.execute(text("""
        INSERT INTO master_kecamatan (kode_kecamatan, kecamatan) 
        VALUES ('01', 'Pare')
    """))

# Menimpa koneksi database asli dengan database bohongan
app.dependency_overrides[get_engine] = lambda: test_engine

client = TestClient(app)


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
    # Gunakan username acak agar tidak bentrok dengan data di Supabase
    random_username = f"admin_{uuid.uuid4().hex[:6]}"
    
    # 1. Daftarkan User Admin
    user_data = {"username": random_username, "password": "rahasia123", "role": "admin"}
    response_reg = client.post("/api/v1/auth/register", json=user_data)
    assert response_reg.status_code == 200

    # 2. Login untuk dapat token (OAuth2 butuh form data, bukan JSON)
    login_data = {"username": random_username, "password": "rahasia123"}
    response_login = client.post("/api/v1/auth/login", data=login_data)
    assert response_login.status_code == 200
    assert "access_token" in response_login.json()


# ==========================================
# TESTING KEAMANAN DATA CENTER (UPLOAD)
# ==========================================
def test_upload_tanpa_token_gagal():
    """Memastikan endpoint upload tidak bisa diakses tanpa token (Satpam bekerja)."""
    response = client.post("/api/v1/tanaman-pangan/upload")
    assert response.status_code == 401


# ==========================================
# TESTING PREDIKSI (MACHINE LEARNING SIMULASI)
# ==========================================
def test_prediksi_produksi():
    # Menguji prediksi untuk data dummy 'Pare' - 'Padi'
    request_data = {"kecamatan": "Pare", "tanaman": "Padi", "bulan_ke_depan": 1}
    response = client.post("/api/v1/prediksi", json=request_data)
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["status_sistem"] == "success"
    assert "hasil_prediksi" in data
    assert "persentase_perubahan" in data["hasil_prediksi"]