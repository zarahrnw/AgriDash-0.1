from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "AgriDash API"}

def test_get_tanaman_pangan_semua():
    response = client.get("/api/v1/tanaman-pangan")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
    assert "data" in data
    assert data["total"] > 0
    assert isinstance(data["data"], list)

def test_get_tanaman_pangan_filter_kecamatan():
    response = client.get("/api/v1/tanaman-pangan?kecamatan=Pare")
    assert response.status_code == 200
    data = response.json()
    assert data["filters"]["kecamatan"] == "Pare"
    for item in data["data"]:
        assert item["kecamatan"].lower() == "pare"

def test_get_tanaman_pangan_kecamatan_tidak_ada():
    response = client.get("/api/v1/tanaman-pangan?kecamatan=KecamatanFiktif")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert data["data"] == []

def test_get_ringkasan():
    response = client.get("/api/v1/tanaman-pangan/ringkasan")
    assert response.status_code == 200
    data = response.json()
    assert "total_produksi_ton" in data
    assert "total_luas_panen_ha" in data
    assert "jumlah_kecamatan" in data
    assert "jumlah_jenis_tanaman" in data
    assert data["total_produksi_ton"] > 0

def test_get_daftar_kecamatan():
    """Menguji endpoint untuk mengambil daftar master kecamatan."""
    response = client.get("/api/v1/kecamatan")
    assert response.status_code == 200
    
    data = response.json()
    assert "total" in data
    assert "data" in data
    assert data["total"] > 0
    assert isinstance(data["data"], list)
    
    # Pastikan datanya berupa string dan tidak ada yang duplikat
    assert len(data["data"]) == len(set(data["data"]))
