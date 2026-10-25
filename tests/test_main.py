from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_health_check():
    """Menguji apakah endpoint /health berjalan dengan baik."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "AgriDash API"
    }


def test_get_tanaman_pangan_semua():
    """Menguji endpoint data tanaman pangan tanpa filter."""
    response = client.get("/api/v1/tanaman-pangan")
    assert response.status_code == 200
    
    data = response.json()
    # Ubah pengecekan dari 'total' menjadi 'total_data_tersedia'
    assert "total_data_tersedia" in data 
    assert "data" in data
    assert data["total_data_tersedia"] > 0
    assert isinstance(data["data"], list)


def test_get_tanaman_pangan_filter_kecamatan():
    """Menguji filter berdasarkan kecamatan (misal: Pare)."""
    response = client.get("/api/v1/tanaman-pangan?kecamatan=Pare")
    assert response.status_code == 200
    
    data = response.json()
    assert data["filters"]["kecamatan"] == "Pare"
    
    for item in data["data"]:
        assert item["kecamatan"].lower() == "pare"


def test_get_tanaman_pangan_kecamatan_tidak_ada():
    """Menguji jika mencari kecamatan yang tidak ada di database."""
    response = client.get("/api/v1/tanaman-pangan?kecamatan=KecamatanFiktif")
    assert response.status_code == 200
    
    data = response.json()
    # Ubah pengecekan dari 'total' menjadi 'total_data_tersedia'
    assert data["total_data_tersedia"] == 0
    assert data["data"] == []


def test_get_ringkasan():
    """Menguji apakah data ringkasan mengembalikan angka yang valid."""
    response = client.get("/api/v1/tanaman-pangan/ringkasan")
    assert response.status_code == 200
    
    data = response.json()
    assert "total_produksi_ton" in data
    assert "total_luas_panen_ha" in data
    assert "jumlah_kecamatan" in data
    assert "jumlah_jenis_tanaman" in data
    
    assert data["total_produksi_ton"] > 0
    assert data["jumlah_kecamatan"] > 0


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


def test_get_rekap_kecamatan():
    """Menguji apakah backend berhasil menjumlahkan data per kecamatan."""
    response = client.get("/api/v1/rekap-kecamatan")
    assert response.status_code == 200
    data = response.json()
    
    assert "total_kecamatan" in data
    assert "data" in data
    assert data["total_kecamatan"] > 0
    
    # Pastikan urutannya sudah dari produksi terbesar (descending)
    data_rekap = data["data"]
    if len(data_rekap) > 1:
        assert data_rekap[0]["produksi_ton"] >= data_rekap[1]["produksi_ton"]


def test_pagination_dan_sorting():
    """Menguji fitur limit dan sorting pada data tanaman pangan."""
    # Ambil 5 data teratas berdasarkan produksi
    response = client.get("/api/v1/tanaman-pangan?limit=5&sort_by=produksi_ton")
    assert response.status_code == 200
    data = response.json()
    
    assert data["data_ditampilkan"] == 5
    assert len(data["data"]) == 5