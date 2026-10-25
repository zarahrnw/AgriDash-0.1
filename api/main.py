import csv
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
# TAMBAHAN 1: Import CORS Middleware
from fastapi.middleware.cors import CORSMiddleware 

app = FastAPI(
    title="AgriDash API",
    description="API data pertanian dan ketahanan pangan Kabupaten Kediri",
    version="0.1.0",
)

# TAMBAHAN 2: Konfigurasi agar Frontend diizinkan mengakses API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Mengizinkan semua alamat frontend (untuk development)
    allow_credentials=True,
    allow_methods=["*"],  # Mengizinkan GET, POST, dll
    allow_headers=["*"],  # Mengizinkan semua header
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
    """Membaca data tanaman pangan dari file CSV."""
    if not DATA_FILE.exists():
        raise HTTPException(
            status_code=500,
            detail="File dataset tanaman pangan tidak ditemukan.",
        )

    rows = []

    with DATA_FILE.open(
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as file:
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
                    raise HTTPException(
                        status_code=500,
                        detail=(
                            f"Nilai tidak valid pada baris "
                            f"{reader.line_num}, kolom {column}: "
                            f"{value!r}"
                        ),
                    )

            rows.append(row)

    return rows


@app.get("/health", tags=["System"])
def health_check():
    """Memeriksa apakah API berjalan."""
    return {
        "status": "ok",
        "service": "AgriDash API",
    }


@app.get(
    "/api/v1/tanaman-pangan",
    tags=["Tanaman Pangan"],
)
def get_tanaman_pangan(
    kecamatan: Optional[str] = Query(default=None),
    tanaman: Optional[str] = Query(default=None),
):
    """Mengambil data tanaman pangan dengan filter opsional."""
    rows = load_crop_data()

    if kecamatan:
        kecamatan_filter = kecamatan.strip().casefold()
        rows = [
            row
            for row in rows
            if row["kecamatan"].strip().casefold()
            == kecamatan_filter
        ]

    if tanaman:
        tanaman_filter = tanaman.strip().casefold()
        rows = [
            row
            for row in rows
            if row["tanaman"].strip().casefold()
            == tanaman_filter
        ]

    return {
        "total": len(rows),
        "filters": {
            "kecamatan": kecamatan,
            "tanaman": tanaman,
        },
        "data": rows,
    }


@app.get(
    "/api/v1/tanaman-pangan/ringkasan",
    tags=["Tanaman Pangan"],
)
def get_ringkasan_tanaman_pangan():
    """Menyediakan ringkasan statistik tanaman pangan."""
    rows = load_crop_data()

    total_produksi = sum(
        row["produksi_ton"]
        for row in rows
        if row["produksi_ton"] is not None
    )

    total_luas_panen = sum(
        row["luas_panen_ha"]
        for row in rows
        if row["luas_panen_ha"] is not None
    )

    jumlah_kecamatan = len({
        row["kecamatan"].strip().casefold()
        for row in rows
        if row["kecamatan"].strip()
    })

    jumlah_jenis_tanaman = len({
        row["tanaman"].strip().casefold()
        for row in rows
        if row["tanaman"].strip()
    })

    return {
        "total_produksi_ton": round(total_produksi, 2),
        "total_luas_panen_ha": round(total_luas_panen, 2),
        "jumlah_kecamatan": jumlah_kecamatan,
        "jumlah_jenis_tanaman": jumlah_jenis_tanaman,
    }