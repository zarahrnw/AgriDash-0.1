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

# Konfigurasi CORS agar Frontend (HTML/JS) bisa mengakses API
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
    return {
        "status": "ok",
        "service": "AgriDash API",
    }


@app.get("/api/v1/kecamatan", tags=["Master Data"])
def get_daftar_kecamatan():
    """Mengambil daftar unik kecamatan yang tersedia."""
    try:
        rows = load_crop_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Mengambil nama kecamatan unik, menghapus spasi, dan mengurutkan
    kecamatan_set = {
        row["kecamatan"].strip()
        for row in rows
        if row.get("kecamatan")
    }

    return {
        "total": len(kecamatan_set),
        "data": sorted(list(kecamatan_set)),
    }


@app.get("/api/v1/tanaman-pangan", tags=["Tanaman Pangan"])
def get_tanaman_pangan(
    kecamatan: Optional[str] = Query(
        default=None, description="Filter berdasarkan nama kecamatan"
    ),
    tanaman: Optional[str] = Query(
        default=None, description="Filter berdasarkan jenis tanaman"
    ),
):
    """Mengambil data tanaman pangan dengan filter opsional."""
    try:
        rows = load_crop_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if kecamatan:
        kecamatan_filter = kecamatan.strip().casefold()
        rows = [
            row
            for row in rows
            if row.get("kecamatan", "").strip().casefold() == kecamatan_filter
        ]

    if tanaman:
        tanaman_filter = tanaman.strip().casefold()
        rows = [
            row
            for row in rows
            if row.get("tanaman", "").strip().casefold() == tanaman_filter
        ]

    return {
        "total": len(rows),
        "filters": {
            "kecamatan": kecamatan,
            "tanaman": tanaman,
        },
        "data": rows,
    }


@app.get("/api/v1/tanaman-pangan/ringkasan", tags=["Tanaman Pangan"])
def get_ringkasan_tanaman_pangan():
    """Menyediakan ringkasan statistik tanaman pangan."""
    try:
        rows = load_crop_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    total_produksi = sum(
        row["produksi_ton"]
        for row in rows
        if row.get("produksi_ton") is not None
    )

    total_luas_panen = sum(
        row["luas_panen_ha"]
        for row in rows
        if row.get("luas_panen_ha") is not None
    )

    jumlah_kecamatan = len({
        row["kecamatan"].strip().casefold()
        for row in rows
        if row.get("kecamatan")
    })

    jumlah_jenis_tanaman = len({
        row["tanaman"].strip().casefold()
        for row in rows
        if row.get("tanaman")
    })

    return {
        "total_produksi_ton": round(total_produksi, 2),
        "total_luas_panen_ha": round(total_luas_panen, 2),
        "jumlah_kecamatan": jumlah_kecamatan,
        "jumlah_jenis_tanaman": jumlah_jenis_tanaman,
    }