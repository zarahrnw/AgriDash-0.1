import csv
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

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

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = (
    BASE_DIR
    / "data"
    / "derived"
    / "Tanaman Pangan Per Kecamatan.csv"
)

NUMERIC_COLUMNS = (
    "luas_panen_ha",
    "produksi_ton",
    "produktivitas_kuintal_ha",
)


def load_crop_data() -> list[dict]:
    """Membaca data tanaman pangan dari file CSV dengan penanganan error."""
    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"File dataset tidak ditemukan di path: {DATA_FILE}"
        )

    rows = []
    try:
        with DATA_FILE.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            for row in reader:
                for column in NUMERIC_COLUMNS:
                    value = (row.get(column) or "").strip()
                    if not value:
                        row[column] = None
                        continue
                    try:
                        row[column] = float(value)
                    except ValueError:
                        raise ValueError(
                            f"Nilai tidak valid pada baris {reader.line_num}, "
                            f"kolom {column}: {value!r}"
                        )
                rows.append(row)
    except UnicodeDecodeError:
        raise ValueError("Format file CSV tidak valid (gagal decode).")

    return rows


@app.get("/health", tags=["System"])
def health_check():
    """Memeriksa apakah API berjalan."""
    return {"status": "ok", "service": "AgriDash API"}


@app.get("/api/v1/kecamatan", tags=["Master Data"])
def get_daftar_kecamatan():
    """Mengambil daftar unik kecamatan yang tersedia."""
    try:
        rows = load_crop_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    kecamatan_set = {
        row["kecamatan"].strip() for row in rows if row.get("kecamatan")
    }

    return {"total": len(kecamatan_set), "data": sorted(list(kecamatan_set))}


# ==========================================
# FITUR BARU 1: REKAP DATA (BACKEND MENGHITUNG)
# ==========================================
@app.get("/api/v1/rekap-kecamatan", tags=["Tanaman Pangan"])
def get_rekap_kecamatan():
    """
    Mengambil total produksi dan luas panen yang sudah dijumlahkan per kecamatan.
    Frontend tinggal menampilkan, tidak perlu hitung manual lagi.
    """
    try:
        rows = load_crop_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    rekap = {}
    for row in rows:
        kecamatan = row.get("kecamatan")
        if not kecamatan:
            continue

        if kecamatan not in rekap:
            rekap[kecamatan] = {"produksi_ton": 0, "luas_panen_ha": 0}

        # Tambahkan angka produksi dan luas
        rekap[kecamatan]["produksi_ton"] += row.get("produksi_ton") or 0
        rekap[kecamatan]["luas_panen_ha"] += row.get("luas_panen_ha") or 0

    # Ubah format menjadi list dan bulatkan angkanya
    hasil = []
    for kecamatan, nilai in rekap.items():
        hasil.append({
            "kecamatan": kecamatan,
            "produksi_ton": round(nilai["produksi_ton"], 2),
            "luas_panen_ha": round(nilai["luas_panen_ha"], 2)
        })

    # Urutkan berdasarkan produksi terbesar secara default
    hasil.sort(key=lambda x: x["produksi_ton"], reverse=True)

    return {"total_kecamatan": len(hasil), "data": hasil}


# ==========================================
# FITUR BARU 2: SORTING & PAGINATION
# ==========================================
@app.get("/api/v1/tanaman-pangan", tags=["Tanaman Pangan"])
def get_tanaman_pangan(
    kecamatan: Optional[str] = Query(default=None, description="Filter berdasarkan nama kecamatan"),
    tanaman: Optional[str] = Query(default=None, description="Filter berdasarkan jenis tanaman"),
    limit: int = Query(default=50, description="Batasi jumlah data yang ditarik (Pagination)"),
    sort_by: str = Query(default="produksi_ton", description="Urutkan berdasarkan: produksi_ton / luas_panen_ha"),
):
    """Mengambil data tanaman pangan dengan filter, sorting, dan limit."""
    try:
        rows = load_crop_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # 1. Filtering
    if kecamatan:
        kecamatan_filter = kecamatan.strip().casefold()
        rows = [r for r in rows if r.get("kecamatan", "").strip().casefold() == kecamatan_filter]

    if tanaman:
        tanaman_filter = tanaman.strip().casefold()
        rows = [r for r in rows if r.get("tanaman", "").strip().casefold() == tanaman_filter]

    # 2. Sorting (Hanya untuk kolom numerik)
    if sort_by in ["produksi_ton", "luas_panen_ha", "produktivitas_kuintal_ha"]:
        rows = sorted(rows, key=lambda x: x.get(sort_by) or 0, reverse=True)

    # 3. Pagination (Membatasi jumlah data)
    total_sebelum_limit = len(rows)
    rows = rows[:limit]

    return {
        "total_data_tersedia": total_sebelum_limit,
        "data_ditampilkan": len(rows),
        "filters": {"kecamatan": kecamatan, "tanaman": tanaman, "sort_by": sort_by},
        "data": rows,
    }


@app.get("/api/v1/tanaman-pangan/ringkasan", tags=["Tanaman Pangan"])
def get_ringkasan_tanaman_pangan():
    """Menyediakan ringkasan statistik tanaman pangan."""
    try:
        rows = load_crop_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    total_produksi = sum(r["produksi_ton"] for r in rows if r.get("produksi_ton") is not None)
    total_luas_panen = sum(r["luas_panen_ha"] for r in rows if r.get("luas_panen_ha") is not None)
    jumlah_kecamatan = len({r["kecamatan"].strip().casefold() for r in rows if r.get("kecamatan")})
    jumlah_jenis_tanaman = len({r["tanaman"].strip().casefold() for r in rows if r.get("tanaman")})

    return {
        "total_produksi_ton": round(total_produksi, 2),
        "total_luas_panen_ha": round(total_luas_panen, 2),
        "jumlah_kecamatan": jumlah_kecamatan,
        "jumlah_jenis_tanaman": jumlah_jenis_tanaman,
    }