import os
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Memuat kredensial dari file .env
load_dotenv()

app = FastAPI(
    title="AgriDash API",
    description="API data pertanian dan ketahanan pangan Kabupaten Kediri",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Koneksi ke Database Supabase
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL tidak ditemukan di file .env")

engine = create_engine(DATABASE_URL)


@app.get("/health", tags=["System"])
def health_check():
    """Memeriksa apakah API dan Database berjalan."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "service": "AgriDash API", "database": "connected"}
    except Exception as e:
        return {"status": "error", "service": "AgriDash API", "database": str(e)}


# ==========================================
# ENDPOINT MASTER KECAMATAN (Dari Supabase)
# ==========================================
@app.get("/api/v1/kecamatan", tags=["Master Data"])
def get_daftar_kecamatan():
    """Mengambil daftar unik kecamatan dari tabel master_kecamatan."""
    try:
        with engine.connect() as conn:
            # Mengambil daftar nama kecamatan dan mengurutkannya
            result = conn.execute(text("SELECT kecamatan FROM master_kecamatan ORDER BY kecamatan ASC"))
            kecamatan_list = [row[0] for row in result]
            
        return {"total": len(kecamatan_list), "data": kecamatan_list}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# ENDPOINT REKAP KECAMATAN (Dari Supabase)
# ==========================================
@app.get("/api/v1/rekap-kecamatan", tags=["Tanaman Pangan"])
def get_rekap_kecamatan():
    """Menjumlahkan total produksi dan luas panen per kecamatan langsung dari Database."""
    try:
        with engine.connect() as conn:
            # Query SQL untuk SUM data dari tabel tanaman_pangan
            query = text("""
                SELECT 
                    kecamatan, 
                    SUM(produksi_ton) as total_produksi, 
                    SUM(luas_panen_ha) as total_luas
                FROM tanaman_pangan
                GROUP BY kecamatan
                ORDER BY total_produksi DESC
            """)
            result = conn.execute(query)
            
            # Format hasil menjadi list of dictionaries
            data = [
                {
                    "kecamatan": row.kecamatan,
                    "produksi_ton": round(row.total_produksi or 0, 2),
                    "luas_panen_ha": round(row.total_luas or 0, 2)
                }
                for row in result
            ]
            
        return {"total_kecamatan": len(data), "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# ENDPOINT DATA TANAMAN PANGAN (Dari Supabase)
# ==========================================
@app.get("/api/v1/tanaman-pangan", tags=["Tanaman Pangan"])
def get_tanaman_pangan(
    kecamatan: Optional[str] = Query(default=None, description="Filter berdasarkan nama kecamatan"),
    tanaman: Optional[str] = Query(default=None, description="Filter berdasarkan jenis tanaman"),
    limit: int = Query(default=50, description="Batasi jumlah data yang ditarik"),
    sort_by: str = Query(default="produksi_ton", description="Urutkan berdasarkan: produksi_ton / luas_panen_ha"),
):
    """Mengambil data tanaman pangan dari database dengan filter, sorting, dan limit."""
    try:
        with engine.connect() as conn:
            # Base query
            query_str = "SELECT * FROM tanaman_pangan WHERE 1=1"
            params = {}

            # Tambahkan filter jika ada
            if kecamatan:
                query_str += " AND LOWER(kecamatan) = LOWER(:kecamatan)"
                params["kecamatan"] = kecamatan
            
            if tanaman:
                query_str += " AND LOWER(tanaman) = LOWER(:tanaman)"
                params["tanaman"] = tanaman

            # Validasi kolom sorting agar aman dari SQL Injection
            valid_sorts = ["produksi_ton", "luas_panen_ha", "produktivitas_kuintal_ha"]
            if sort_by not in valid_sorts:
                sort_by = "produksi_ton"

            # Tambahkan sorting dan limit
            query_str += f" ORDER BY {sort_by} DESC LIMIT :limit"
            params["limit"] = limit

            result = conn.execute(text(query_str), params)
            
            # Mengambil hasil query
            rows = [dict(row._mapping) for row in result]

        return {
            "total_data_ditampilkan": len(rows),
            "filters": {"kecamatan": kecamatan, "tanaman": tanaman, "sort_by": sort_by},
            "data": rows,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# ENDPOINT RINGKASAN DASHBOARD (Dari Supabase)
# ==========================================
@app.get("/api/v1/tanaman-pangan/ringkasan", tags=["Tanaman Pangan"])
def get_ringkasan_tanaman_pangan():
    """Menyediakan ringkasan statistik untuk Dashboard."""
    try:
        with engine.connect() as conn:
            # Query untuk total produksi dan luas
            query_sum = text("""
                SELECT 
                    SUM(produksi_ton) as total_prod, 
                    SUM(luas_panen_ha) as total_luas
                FROM tanaman_pangan
            """)
            result_sum = conn.execute(query_sum).fetchone()

            # Query untuk menghitung jumlah kecamatan unik
            query_count = text("SELECT COUNT(DISTINCT kecamatan) as jml_kec, COUNT(DISTINCT tanaman) as jml_tanaman FROM tanaman_pangan")
            result_count = conn.execute(query_count).fetchone()

        total_produksi = result_sum.total_prod or 0
        total_luas = result_sum.total_luas or 0

        return {
            "total_produksi_ton": round(total_produksi, 2),
            "total_luas_panen_ha": round(total_luas, 2),
            "jumlah_kecamatan": result_count.jml_kec,
            "jumlah_jenis_tanaman": result_count.jml_tanaman,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))