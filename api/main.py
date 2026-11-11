import os
import io
import json
import random
import tempfile
import threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import requests

from dotenv import load_dotenv
from fastapi import (
    FastAPI, HTTPException, Query,
    UploadFile, File, Depends, status
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import (
    OAuth2PasswordBearer,
    OAuth2PasswordRequestForm
)
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA


# =========================================================
# 1. KONFIGURASI PROJECT
# =========================================================

API_DIR = Path(__file__).resolve().parent
PROJECT_DIR = API_DIR.parent

# Memuat .env dari ROOT folder (folder utama proyek)
load_dotenv(PROJECT_DIR / ".env")

SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "agri-dash-secret-key-change-this"
)

ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")
)

API_INDONESIA_KEY = os.getenv("API_INDONESIA_KEY")

BMKG_BASE_URL = (
    "https://api.bmkg.go.id/publik/prakiraan-cuaca"
)

if SECRET_KEY == "agri-dash-secret-key-change-this":
    print(
        "[WARNING] SECRET_KEY masih default. "
        "Atur SECRET_KEY acak di api/.env."
    )


# =========================================================
# 2. KONFIGURASI DATASET
# =========================================================

DATA_DIR = PROJECT_DIR / "output" / "tanaman_pangan"

REPORT_DIR = PROJECT_DIR / "outputs" / "reports"

PRIMARY_DATA_FILE = (
    DATA_DIR / "output_rekomendasi_all_scores.csv"
)

UPLOAD_DATA_FILE = (
    DATA_DIR / "tanaman_pangan_upload.csv"
)

AUTH_DIR = API_DIR / "local_data"

USERS_FILE = AUTH_DIR / "users.json"
AUDIT_FILE = AUTH_DIR / "audit.jsonl"

FILE_LOCK = threading.RLock()

CSV_FILES = {
    "tanaman_pangan": PRIMARY_DATA_FILE,
    "clustering": (
        DATA_DIR / "output_clustering_pangan.csv"
    ),
    "rekomendasi": (
        DATA_DIR / "output_rekomendasi_pangan.csv"
    ),
    "rekomendasi_all_scores": (
        DATA_DIR / "output_rekomendasi_all_scores.csv"
    ),
    "timeseries": (
        DATA_DIR / "output_timeseries_pangan.csv"
    ),
    "model_comparison": (
        DATA_DIR / "output_model_comparison.csv"
    )
}

REQUIRED_COLUMNS = [
    "kecamatan",
    "tanaman",
    "luas_panen_ha",
    "produksi_ton",
    "produktivitas_kuintal_ha"
]

NUMERIC_COLUMNS = [
    "luas_panen_ha",
    "produksi_ton",
    "produktivitas_kuintal_ha"
]


# =========================================================
# 3. FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="AgriDash API",
    description=(
        "API Monitoring Pertanian dan Ketahanan Pangan "
        "Kabupaten Kediri Berbasis CSV/Excel"
    ),
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)


# =========================================================
# 4. HELPER DATASET
# =========================================================

def normalize_columns(df):
    df.columns = [
        str(col)
        .strip()
        .lower()
        .replace(" ", "_")
        for col in df.columns
    ]
    return df


def normalize_text(value):
    if value is None or pd.isna(value):
        return ""

    return " ".join(
        str(value).strip().casefold().split()
    )


def read_csv_excel(path):
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Dataset tidak ditemukan: {path}"
        )

    try:
        if path.suffix.lower() == ".csv":
            try:
                return pd.read_csv(
                    path,
                    encoding="utf-8-sig",
                    sep=None,
                    engine="python"
                )
            except UnicodeDecodeError:
                return pd.read_csv(
                    path,
                    encoding="cp1252",
                    sep=None,
                    engine="python"
                )

        return pd.read_excel(path)

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=f"Gagal membaca dataset: {error}"
        )


def active_master_file():
    if UPLOAD_DATA_FILE.exists():
        return UPLOAD_DATA_FILE

    return PRIMARY_DATA_FILE


def read_dataset(path):
    df = normalize_columns(
        read_csv_excel(path)
    )

    mapping = {
        "prod_mean": "produksi_ton",
        "luas_mean": "luas_panen_ha",
        "produktivitas_mean": (
            "produktivitas_kuintal_ha"
        )
    }

    df = df.rename(columns=mapping)

    missing = [
        col for col in REQUIRED_COLUMNS
        if col not in df.columns
    ]

    if missing:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Kolom wajib belum tersedia: {missing}. "
                f"Kolom ditemukan: {list(df.columns)}"
            )
        )

    df = df[REQUIRED_COLUMNS].copy()

    for col in ["kecamatan", "tanaman"]:
        df[col] = (
            df[col]
            .astype("string")
            .str.strip()
        )

    for col in NUMERIC_COLUMNS:
        df[col] = pd.to_numeric(
            df[col],
            errors="coerce"
        )

    return df


def load_tanaman():
    return read_dataset(active_master_file())


def read_agri_csv(path):
    return read_csv_excel(path)


def dataframe_records(df):
    clean_df = (
        df.replace([np.inf, -np.inf], np.nan)
        .astype(object)
        .where(pd.notna(df), None)
    )

    return clean_df.to_dict(orient="records")


def find_column(df, candidates):
    normalized = {
        str(col).lower().strip().replace(" ", "_"): col
        for col in df.columns
    }

    for candidate in candidates:
        key = (
            candidate.lower()
            .strip()
            .replace(" ", "_")
        )

        if key in normalized:
            return normalized[key]

    return None


def get_cluster_column(df):
    return find_column(
        df,
        [
            "cluster_id",
            "cluster",
            "cluster_label",
            "klaster",
            "label_cluster"
        ]
    )


def get_kecamatan_column(df):
    return find_column(
        df,
        [
            "kecamatan",
            "nama_kecamatan",
            "wilayah"
        ]
    )


def safe_float(value):
    try:
        if pd.isna(value):
            return None

        number = float(value)

        return number if np.isfinite(number) else None

    except (TypeError, ValueError):
        return None


def aggregate_summary(df):

    def optional_number(value):
        return safe_float(value)

    return {
        "total_data": int(len(df)),
        "total_kecamatan": int(
            df["kecamatan"].nunique()
        ),
        "total_komoditas": int(
            df["tanaman"].nunique()
        ),
        "total_luas_panen": optional_number(
            df["luas_panen_ha"].sum(min_count=1)
        ),
        "total_produksi": optional_number(
            df["produksi_ton"].sum(min_count=1)
        ),
        "rata_produktivitas": optional_number(
            df["produktivitas_kuintal_ha"].mean()
        )
    }


# =========================================================
# 5. HELPER STATUS WILAYAH
# =========================================================

def get_status_color_label(label):
    text = normalize_text(label)

    if "tinggi" in text:
        return "Potensi Tinggi"

    if "sedang" in text:
        return "Potensi Sedang"

    if "rendah" in text:
        return "Potensi Rendah"

    return "Belum Dikategorikan"


def get_status_color(status_label):
    status_label = get_status_color_label(status_label)

    colors = {
        "Potensi Tinggi": "#265322",
        "Potensi Sedang": "#60982c",
        "Potensi Rendah": "#dfe8d5",
        "Belum Dikategorikan": "#e5e7eb"
    }

    return colors[status_label]


def load_cluster_status():
    df = normalize_columns(
        read_agri_csv(CSV_FILES["clustering"])
    )

    kecamatan_col = get_kecamatan_column(df)

    status_col = find_column(
        df,
        [
            "label_cluster",
            "label_cluster_agg"
        ]
    )

    if not kecamatan_col or not status_col:
        raise HTTPException(
            status_code=422,
            detail=(
                "CSV clustering harus memiliki "
                "kolom kecamatan dan label_cluster."
            )
        )

    result = df[
        [kecamatan_col, status_col]
    ].copy()

    result.columns = [
        "kecamatan",
        "status_wilayah"
    ]

    result = result.dropna(
        subset=["kecamatan"]
    )

    result["kecamatan"] = (
        result["kecamatan"]
        .astype(str)
        .str.strip()
    )

    result["kecamatan_key"] = (
        result["kecamatan"]
        .map(normalize_text)
    )

    konflik = (
        result.groupby("kecamatan_key")
        ["status_wilayah"]
        .nunique()
    )

    if (konflik > 1).any():
        raise HTTPException(
            status_code=422,
            detail=(
                "Terdapat kecamatan dengan lebih "
                "dari satu label cluster."
            )
        )

    result = result.drop_duplicates(
        subset=["kecamatan_key"]
    )

    result["status_wilayah"] = (
        result["status_wilayah"]
        .map(get_status_color_label)
    )

    return result


def build_status_wilayah():
    df = load_tanaman()

    df = df.dropna(
        subset=["kecamatan"]
    ).copy()

    df["kecamatan_key"] = (
        df["kecamatan"]
        .map(normalize_text)
    )

    rekap = (
        df.groupby(
            "kecamatan_key",
            as_index=False
        )
        .agg(
            kecamatan=("kecamatan", "first"),
            total_produksi=("produksi_ton", "sum"),
            total_luas_panen=("luas_panen_ha", "sum"),
            rata_produktivitas=(
                "produktivitas_kuintal_ha",
                "mean"
            )
        )
    )

    cluster = load_cluster_status()

    merged = pd.merge(
        rekap,
        cluster[
            ["kecamatan_key", "status_wilayah"]
        ],
        on="kecamatan_key",
        how="left",
        validate="one_to_one"
    )

    rows = []

    for _, row in merged.iterrows():
        status_label = get_status_color_label(
            row["status_wilayah"]
        )

        rows.append({
            "kecamatan": row["kecamatan"],
            "total_produksi": safe_float(
                row["total_produksi"]
            ),
            "total_luas_panen": safe_float(
                row["total_luas_panen"]
            ),
            "rata_produktivitas": safe_float(
                row["rata_produktivitas"]
            ),
            "status_wilayah": status_label,
            "warna": get_status_color(status_label)
        })

    return sorted(
        rows,
        key=lambda x: x["kecamatan"]
    )


# =========================================================
# 6. AUTHENTICATION
# =========================================================

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login"
)

oauth2_optional = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login",
    auto_error=False
)


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "admin"


class PrediksiRequest(BaseModel):
    kecamatan: str
    tanaman: str
    bulan_ke_depan: int = 1


def read_users():
    if not USERS_FILE.exists():
        # Jika file belum ada, buat default admin
        default_admin = {
            "id": 1,
            "username": "admin",
            "password_hash": pwd_context.hash("admin123"),
            "role": "super_admin"
        }
        AUTH_DIR.mkdir(parents=True, exist_ok=True)
        USERS_FILE.write_text(
            json.dumps([default_admin], indent=2), 
            encoding="utf-8"
        )
        return [default_admin]

    try:
        users = json.loads(
            USERS_FILE.read_text(
                encoding="utf-8"
            )
        )

        if not isinstance(users, list):
            raise ValueError("Format users.json tidak valid")

        return users

    except (OSError, ValueError) as error:
        raise HTTPException(
            status_code=500,
            detail=f"Gagal membaca user: {error}"
        )


def save_users(users):
    AUTH_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=AUTH_DIR,
        suffix=".json",
        delete=False
    ) as temp:
        json.dump(
            users,
            temp,
            ensure_ascii=False,
            indent=2
        )
        temp_path = Path(temp.name)

    temp_path.replace(USERS_FILE)


def create_access_token(data):
    payload = data.copy()

    expire = datetime.utcnow() + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload["exp"] = expire

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def user_from_token(token):
    error = HTTPException(
        status_code=401,
        detail="Token tidak valid atau kedaluwarsa.",
        headers={"WWW-Authenticate": "Bearer"}
    )

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        username = payload.get("sub")

        if not username:
            raise error

    except JWTError:
        raise error

    user = next(
        (
            u for u in read_users()
            if u["username"] == username
        ),
        None
    )

    if not user:
        raise error

    return user


def get_current_user(
    token: str = Depends(oauth2_scheme)
):
    return user_from_token(token)


def get_current_admin(
    user: dict = Depends(get_current_user)
):
    if user.get("role") not in [
        "admin",
        "super_admin"
    ]:
        raise HTTPException(
            status_code=403,
            detail="Akses hanya untuk admin."
        )

    return user


def write_audit(username, action, details=""):
    AUTH_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    entry = {
        "username": username,
        "aktivitas": action,
        "details": details,
        "waktu": datetime.now().strftime(
            "%d-%m-%Y %H:%M:%S"
        )
    }

    with FILE_LOCK:
        with AUDIT_FILE.open(
            "a",
            encoding="utf-8"
        ) as file:
            file.write(
                json.dumps(
                    entry,
                    ensure_ascii=False
                ) + "\n"
            )


# =========================================================
# 7. HEALTH CHECK
# =========================================================

@app.get("/health")
def health_check():
    master = active_master_file()

    result = {
        "status": (
            "healthy"
            if master.exists()
            else "dataset_missing"
        ),
        "storage": "csv_excel",
        "database": "not_used",
        "master_file": str(master),
        "master_exists": master.exists(),
        "tanaman_pangan_rows": None,
        "csv_files": {
            name: path.exists()
            for name, path in CSV_FILES.items()
        },
        "timestamp": datetime.now().isoformat()
    }

    if master.exists():
        result["tanaman_pangan_rows"] = len(
            load_tanaman()
        )

    return result


# =========================================================
# 8. REGISTER DAN LOGIN
# =========================================================

@app.post("/api/v1/auth/register")
def register_user(
    user: UserCreate,
    token: Optional[str] = Depends(oauth2_optional)
):
    with FILE_LOCK:
        users = read_users()

        if users:
            if not token:
                raise HTTPException(
                    status_code=401,
                    detail="Registrasi memerlukan admin."
                )

            current = user_from_token(token)

            if current["role"] not in [
                "admin",
                "super_admin"
            ]:
                raise HTTPException(
                    status_code=403,
                    detail="Akses hanya admin."
                )

        username = user.username.strip()

        if not username or len(user.password) < 8:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Username wajib diisi dan password "
                    "minimal 8 karakter."
                )
            )

        if user.role not in [
            "admin",
            "super_admin",
            "user"
        ]:
            raise HTTPException(
                status_code=400,
                detail="Role tidak valid."
            )

        if any(
            u["username"] == username
            for u in users
        ):
            raise HTTPException(
                status_code=400,
                detail="Username sudah terdaftar."
            )

        role = "admin" if not users else user.role

        users.append({
            "id": max(
                [u.get("id", 0) for u in users],
                default=0
            ) + 1,
            "username": username,
            "password_hash": pwd_context.hash(
                user.password
            ),
            "role": role
        })

        save_users(users)

    return {
        "message": "Registrasi berhasil.",
        "username": username,
        "role": role
    }


@app.post("/api/v1/auth/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends()
):
    user = next(
        (
            u for u in read_users()
            if u["username"] == form_data.username
        ),
        None
    )

    if (
        not user
        or not pwd_context.verify(
            form_data.password,
            user["password_hash"]
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Username atau password salah."
        )

    token = create_access_token({
        "sub": user["username"],
        "role": user["role"]
    })

    write_audit(
        user["username"],
        "Login",
        "Login berhasil"
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"]
    }


# =========================================================
# 9. MASTER KECAMATAN
# =========================================================

@app.get("/api/v1/kecamatan")
def get_kecamatan():
    df = load_tanaman()

    names = sorted(
        df["kecamatan"]
        .dropna()
        .unique()
        .tolist()
    )

    rows = [
        {"kecamatan": name}
        for name in names
    ]

    return {
        "total": len(rows),
        "data": rows
    }


# =========================================================
# 10. REKAP KECAMATAN
# =========================================================

@app.get("/api/v1/rekap-kecamatan")
def get_rekap_kecamatan():
    df = load_tanaman()

    grouped = (
        df.dropna(subset=["kecamatan"])
        .groupby(
            "kecamatan",
            as_index=False
        )
        .agg(
            total_luas_panen=(
                "luas_panen_ha", "sum"
            ),
            total_produksi=(
                "produksi_ton", "sum"
            ),
            rata_produktivitas=(
                "produktivitas_kuintal_ha",
                "mean"
            )
        )
        .sort_values(
            "total_produksi",
            ascending=False
        )
    )

    return {
        "total": len(grouped),
        "data": dataframe_records(grouped)
    }


# =========================================================
# 11. DATA TANAMAN PANGAN
# =========================================================

@app.get("/api/v1/tanaman-pangan")
def get_tanaman_pangan(
    kecamatan: Optional[str] = None,
    tanaman: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    sort_by: str = Query("produksi_ton")
):
    if sort_by not in NUMERIC_COLUMNS:
        raise HTTPException(
            status_code=400,
            detail="Kolom pengurutan tidak valid."
        )

    df = load_tanaman()

    if kecamatan:
        df = df[
            df["kecamatan"].str.casefold()
            == kecamatan.casefold()
        ]

    if tanaman:
        df = df[
            df["tanaman"].str.casefold()
            == tanaman.casefold()
        ]

    df = (
        df.sort_values(
            sort_by,
            ascending=False,
            na_position="last"
        )
        .head(limit)
    )

    return {
        "total": len(df),
        "data": dataframe_records(df)
    }


# =========================================================
# 12. RINGKASAN DASHBOARD
# =========================================================

@app.get("/api/v1/tanaman-pangan/ringkasan")
def get_ringkasan_tanaman():
    df = load_tanaman()

    return aggregate_summary(df)


# =========================================================
# 13. UPLOAD DATA
# =========================================================

@app.post("/api/v1/tanaman-pangan/upload")
def upload_tanaman_pangan(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_admin)
):
    filename = (file.filename or "").lower()

    if not filename.endswith(
        (".csv", ".xlsx", ".xls")
    ):
        raise HTTPException(
            status_code=400,
            detail="Format file harus CSV atau Excel."
        )

    content = file.file.read()

    if len(content) > 30 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Ukuran maksimal 30 MB."
        )

    try:
        if filename.endswith(".csv"):
            try:
                df = pd.read_csv(
                    io.BytesIO(content),
                    encoding="utf-8-sig",
                    sep=None,
                    engine="python"
                )
            except UnicodeDecodeError:
                df = pd.read_csv(
                    io.BytesIO(content),
                    encoding="cp1252",
                    sep=None,
                    engine="python"
                )
        else:
            df = pd.read_excel(
                io.BytesIO(content)
            )

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Gagal membaca file: {error}"
        )

    df = normalize_columns(df)

    df = df.rename(columns={
        "prod_mean": "produksi_ton",
        "luas_mean": "luas_panen_ha",
        "produktivitas_mean": (
            "produktivitas_kuintal_ha"
        )
    })

    missing = [
        col for col in REQUIRED_COLUMNS
        if col not in df.columns
    ]

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Kolom tidak ditemukan: {missing}"
        )

    df = df[REQUIRED_COLUMNS].copy()

    if df.empty:
        raise HTTPException(
            status_code=400,
            detail="Dataset tidak boleh kosong."
        )

    for col in NUMERIC_COLUMNS:
        df[col] = pd.to_numeric(
            df[col],
            errors="coerce"
        )

    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    with FILE_LOCK:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8-sig",
            suffix=".csv",
            dir=DATA_DIR,
            newline="",
            delete=False
        ) as temp:
            df.to_csv(temp, index=False)
            temp_path = Path(temp.name)

        temp_path.replace(UPLOAD_DATA_FILE)

    write_audit(
        current_user["username"],
        "Upload Data Tanaman Pangan",
        f"Mengunggah {file.filename}"
    )

    return {
        "message": "Upload berhasil.",
        "total_data": len(df)
    }


# =========================================================
# 14. MONITORING STATUS WILAYAH
# =========================================================

@app.get("/api/v1/monitoring/status-wilayah")
def get_status_wilayah():
    rows = build_status_wilayah()

    counts = {
        "Potensi Tinggi": 0,
        "Potensi Sedang": 0,
        "Potensi Rendah": 0,
        "Belum Dikategorikan": 0
    }

    for row in rows:
        counts[row["status_wilayah"]] += 1

    return {
        "total": len(rows),
        "sumber_status": (
            "output_clustering_pangan.csv"
        ),
        "metode_status": "label_cluster",
        "sumber_indikator": (
            active_master_file().name
        ),
        "ringkasan_status": counts,
        "legenda": [
            {"status": "Potensi Tinggi", "warna": "#265322"},
            {"status": "Potensi Sedang", "warna": "#60982c"},
            {"status": "Potensi Rendah", "warna": "#dfe8d5"},
            {"status": "Belum Dikategorikan", "warna": "#e5e7eb"}
        ],
        "data": rows
    }


@app.get("/api/v1/monitoring/status-wilayah/{nama_kecamatan}")
def get_detail_status_wilayah(nama_kecamatan: str):
    rows = build_status_wilayah()

    selected = next(
        (
            row for row in rows
            if normalize_text(row["kecamatan"])
            == normalize_text(nama_kecamatan)
        ),
        None
    )

    if not selected:
        raise HTTPException(
            status_code=404,
            detail="Kecamatan tidak ditemukan."
        )

    df = load_tanaman()
    df = df[
        df["kecamatan"].map(normalize_text)
        == normalize_text(nama_kecamatan)
    ]

    return {
        "kecamatan": selected["kecamatan"],
        "status_wilayah": selected["status_wilayah"],
        "warna": selected["warna"],
        "total_produksi": selected["total_produksi"],
        "total_luas_panen": selected["total_luas_panen"],
        "rata_produktivitas": selected["rata_produktivitas"],
        "komoditas": dataframe_records(df)
    }


@app.get("/api/v1/monitoring/ringkasan-status")
def get_ringkasan_status():
    rows = build_status_wilayah()

    summary = {
        "Potensi Tinggi": 0,
        "Potensi Sedang": 0,
        "Potensi Rendah": 0,
        "Belum Dikategorikan": 0
    }

    for row in rows:
        summary[row["status_wilayah"]] += 1

    return {
        "total_kecamatan": len(rows),
        "jumlah_potensi_tinggi": summary["Potensi Tinggi"],
        "jumlah_potensi_sedang": summary["Potensi Sedang"],
        "jumlah_potensi_rendah": summary["Potensi Rendah"],
        "belum_dikategorikan": summary["Belum Dikategorikan"],
        "data": summary
    }


# =========================================================
# 15. CUACA BMKG
# =========================================================

def fetch_bmkg(kode_kecamatan):
    try:
        response = requests.get(
            BMKG_BASE_URL,
            params={"adm4": kode_kecamatan},
            timeout=20
        )

        response.raise_for_status()
        return response.json()

    except requests.RequestException as error:
        raise HTTPException(
            status_code=502,
            detail=f"Gagal mengambil data BMKG: {error}"
        )


def extract_bmkg_forecast(data):
    forecasts = []

    for item in data.get("data", []):
        for cuaca in item.get("cuaca", []):
            for forecast in cuaca:
                forecasts.append(forecast)

    return forecasts


@app.get("/api/v1/cuaca/{kode_kecamatan}")
def get_cuaca(kode_kecamatan: str):
    data = fetch_bmkg(kode_kecamatan)
    forecasts = extract_bmkg_forecast(data)

    if not forecasts:
        raise HTTPException(
            status_code=404,
            detail="Data prakiraan cuaca tidak tersedia."
        )

    return {
        "lokasi": data.get("lokasi", {}),
        "cuaca": forecasts[0],
        "prakiraan": forecasts[:8]
    }


# =========================================================
# 16. EARLY WARNING SYSTEM CUACA
# =========================================================

@app.get("/api/v1/ews-cuaca/{kode_kecamatan}")
def get_ews_cuaca(kode_kecamatan: str):
    data = fetch_bmkg(kode_kecamatan)
    forecasts = extract_bmkg_forecast(data)

    if not forecasts:
        raise HTTPException(
            status_code=404,
            detail="Data cuaca tidak tersedia."
        )

    current = forecasts[0]

    rainfall = safe_float(current.get("tp")) or 0
    humidity = safe_float(current.get("hu")) or 0
    temperature = safe_float(current.get("t")) or 0

    status_ews = "AMAN"
    message = "Kondisi cuaca relatif aman."

    if rainfall > 50:
        status_ews = "BAHAYA"
        message = "Curah hujan tinggi. Waspadai genangan."
    elif humidity > 80 and rainfall > 10:
        status_ews = "WASPADA"
        message = "Kelembapan dan curah hujan tinggi."
    elif temperature > 34:
        status_ews = "WASPADA"
        message = "Suhu tinggi. Perhatikan kebutuhan air."

    return {
        "status": status_ews,
        "pesan": message,
        "parameter": {
            "curah_hujan": rainfall,
            "kelembapan": humidity,
            "suhu": temperature
        },
        "waktu": current.get("local_datetime")
    }


# =========================================================
# 17. SIMULASI PREDIKSI PRODUKSI
# =========================================================

@app.post("/api/v1/prediksi")
def prediksi_produksi(request: PrediksiRequest):
    if request.bulan_ke_depan < 1:
        raise HTTPException(
            status_code=400,
            detail="Bulan prediksi minimal 1."
        )

    df = load_tanaman()

    matches = df[
        (
            df["kecamatan"].str.casefold()
            == request.kecamatan.casefold()
        )
        &
        (
            df["tanaman"].str.casefold()
            == request.tanaman.casefold()
        )
    ]

    if matches["produksi_ton"].count() == 0:
        raise HTTPException(
            status_code=404,
            detail="Data produksi tidak ditemukan."
        )

    produksi_awal = float(
        matches["produksi_ton"].sum()
    )

    faktor = 1 + 0.05 * request.bulan_ke_depan
    fluktuasi = random.uniform(-0.02, 0.02)

    hasil = produksi_awal * faktor * (1 + fluktuasi)

    return {
        "kecamatan": request.kecamatan,
        "tanaman": request.tanaman,
        "produksi_awal": round(produksi_awal, 2),
        "bulan_ke_depan": request.bulan_ke_depan,
        "prediksi_produksi": round(hasil, 2),
        "keterangan": (
            "Simulasi, bukan hasil model machine learning."
        )
    }


# =========================================================
# 18. HARGA PANGAN
# =========================================================

@app.get("/api/v1/harga-pangan")
def get_harga_pangan():
    if not API_INDONESIA_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "API_INDONESIA_KEY belum dikonfigurasi."
            )
        )

    url = (
        "https://use.apiindonesia.id/"
        "api/v1/harga-pangan/harga"
    )

    headers = {
        "x-api-key": API_INDONESIA_KEY
    }

    params = {
        "tingkat": "konsumen",
        "wilayah": "provinsi",
        "provinsi": "jawa timur",
        "limit": 100
    }

    try:
        response = requests.get(
            url,
            headers=headers,
            params=params,
            timeout=20
        )

        response.raise_for_status()
        return response.json()

    except requests.RequestException as error:
        raise HTTPException(
            status_code=502,
            detail=f"Gagal mengambil harga pangan: {error}"
        )


# =========================================================
# 19. AUDIT TRAIL
# =========================================================

@app.get("/api/v1/audit-trail")
def get_audit_trail(
    user: dict = Depends(get_current_admin)
):
    if not AUDIT_FILE.exists():
        return {
            "total": 0,
            "data": []
        }

    with FILE_LOCK:
        lines = AUDIT_FILE.read_text(
            encoding="utf-8"
        ).splitlines()

    rows = [
        json.loads(line)
        for line in lines[-50:]
        if line.strip()
    ][::-1]

    return {
        "total": len(rows),
        "data": rows
    }


# =========================================================
# 20. DASHBOARD EKSEKUTIF
# =========================================================

@app.get("/api/v1/dashboard-eksekutif")
def dashboard_eksekutif():
    df = load_tanaman()

    summary = aggregate_summary(df)

    top = (
        df.dropna(subset=["kecamatan"])
        .groupby(
            "kecamatan",
            as_index=False
        )["produksi_ton"]
        .sum()
    )

    top = (
        top.rename(
            columns={
                "produksi_ton": "total_produksi"
            }
        )
        .sort_values(
            "total_produksi",
            ascending=False
        )
        .head(5)
    )

    return {
        "ringkasan": summary,
        "top_kecamatan": dataframe_records(top)
    }


# =========================================================
# 21. HASIL CLUSTERING
# =========================================================

@app.get("/api/v1/model/clustering")
def get_clustering():
    df = read_agri_csv(
        CSV_FILES["clustering"]
    )

    return {
        "total_data": len(df),
        "columns": list(df.columns),
        "kecamatan_column": get_kecamatan_column(df),
        "cluster_column": get_cluster_column(df),
        "data": dataframe_records(df)
    }


# =========================================================
# 22. PCA
# =========================================================

@app.get("/api/v1/model/pca")
def get_pca():
    df = read_agri_csv(
        CSV_FILES["clustering"]
    )

    if len(df) < 2:
        raise HTTPException(
            status_code=400,
            detail="Data tidak cukup untuk PCA."
        )

    cluster_col = get_cluster_column(df)
    kecamatan_col = get_kecamatan_column(df)

    numeric_df = df.select_dtypes(
        include=[np.number]
    ).copy()

    exclude = {
        "id",
        "no",
        "nomor",
        "cluster_id",
        "cluster_agg_id",
        "total_produksi_mean"
    }

    if cluster_col:
        exclude.add(
            str(cluster_col).lower()
        )

    numeric_df = numeric_df[
        [
            col for col in numeric_df.columns
            if str(col).lower() not in exclude
        ]
    ]

    numeric_df = numeric_df.replace(
        [np.inf, -np.inf],
        np.nan
    )

    numeric_df = numeric_df.dropna(
        axis=1,
        how="all"
    )

    if numeric_df.shape[1] < 2:
        raise HTTPException(
            status_code=400,
            detail="PCA membutuhkan dua fitur numerik."
        )

    numeric_df = numeric_df.fillna(
        numeric_df.median()
    )

    scaled = StandardScaler().fit_transform(
        numeric_df
    )

    pca = PCA(n_components=2)
    coordinates = pca.fit_transform(scaled)

    output = []

    for i, (x, y) in enumerate(coordinates):
        cluster = (
            str(df.iloc[i][cluster_col])
            if (
                cluster_col
                and pd.notna(df.iloc[i][cluster_col])
            )
            else "Tidak diketahui"
        )

        kecamatan = (
            str(df.iloc[i][kecamatan_col])
            if (
                kecamatan_col
                and pd.notna(df.iloc[i][kecamatan_col])
            )
            else f"Data {i + 1}"
        )

        output.append({
            "kecamatan": kecamatan,
            "cluster": cluster,
            "pca_1": round(float(x), 4),
            "pca_2": round(float(y), 4)
        })

    return {
        "explained_variance": [
            round(float(v), 4)
            for v in pca.explained_variance_ratio_
        ],
        "total_data": len(output),
        "data": output
    }


# =========================================================
# 23. HEATMAP KECAMATAN
# =========================================================

@app.get("/api/v1/model/heatmap-kecamatan")
def get_heatmap_kecamatan():
    df = read_agri_csv(
        CSV_FILES["clustering"]
    )

    kecamatan_col = get_kecamatan_column(df)
    cluster_col = get_cluster_column(df)

    if not kecamatan_col:
        raise HTTPException(
            status_code=400,
            detail="Kolom kecamatan tidak ditemukan."
        )

    numeric_cols = [
        col
        for col in df.select_dtypes(
            include=[np.number]
        ).columns
        if col not in [
            "cluster_id",
            "cluster_agg_id",
            cluster_col
        ]
    ]

    return {
        "kecamatan_column": kecamatan_col,
        "cluster_column": cluster_col,
        "numeric_columns": numeric_cols,
        "data": dataframe_records(df)
    }


# =========================================================
# 24. REKOMENDASI KOMODITAS
# =========================================================

@app.get("/api/v1/model/rekomendasi")
def get_rekomendasi():
    df = read_agri_csv(
        CSV_FILES["rekomendasi"]
    )

    return {
        "total_rekomendasi": len(df),
        "columns": list(df.columns),
        "data": dataframe_records(df)
    }


@app.get("/api/v1/model/rekomendasi-all-scores")
def get_rekomendasi_all_scores():
    df = read_agri_csv(
        CSV_FILES["rekomendasi_all_scores"]
    )

    return {
        "total_data": len(df),
        "columns": list(df.columns),
        "data": dataframe_records(df)
    }


# =========================================================
# 25. FORECASTING
# =========================================================

@app.get("/api/v1/model/forecasting")
def get_forecasting():
    df = read_agri_csv(
        CSV_FILES["timeseries"]
    )

    return {
        "total_data": len(df),
        "columns": list(df.columns),
        "data": dataframe_records(df)
    }


# =========================================================
# 26. PERBANDINGAN MODEL
# =========================================================

@app.get("/api/v1/model/comparison")
def get_model_comparison():
    df = read_agri_csv(
        CSV_FILES["model_comparison"]
    )

    return {
        "total_model": len(df),
        "columns": list(df.columns),
        "data": dataframe_records(df)
    }


# =========================================================
# 27. DATA CENTER
# =========================================================

@app.get("/api/v1/data-center")
def get_data_center():
    files = []

    folders = [
        ("Dataset Pemodelan", DATA_DIR),
        ("Laporan Analisis", REPORT_DIR)
    ]

    for category, folder in folders:
        if not folder.exists():
            continue

        for path in sorted(folder.iterdir()):
            if not path.is_file():
                continue

            if path.suffix.lower() not in [
                ".csv",
                ".xlsx",
                ".xls"
            ]:
                continue

            files.append({
                "nama": path.name,
                "kategori": category,
                "ukuran_kb": round(
                    path.stat().st_size / 1024,
                    2
                ),
                "endpoint": (
                    "/api/v1/data-center/download/"
                    + category.replace(
                        " ", "_"
                    ).lower()
                    + "/"
                    + path.name
                )
            })

    return {
        "total_file": len(files),
        "data": files
    }


# =========================================================
# 28. DOWNLOAD DATA CENTER
# =========================================================

@app.get(
    "/api/v1/data-center/download/"
    "{category}/{filename}"
)
def download_data_center(
    category: str,
    filename: str
):
    allowed = {
        "dataset_pemodelan": DATA_DIR,
        "laporan_analisis": REPORT_DIR
    }

    folder = allowed.get(category)

    if not folder:
        raise HTTPException(
            status_code=404,
            detail="Kategori tidak ditemukan."
        )

    file_path = (folder / filename).resolve()

    if (
        file_path.parent != folder.resolve()
        or file_path.suffix.lower() not in [
            ".csv",
            ".xlsx",
            ".xls"
        ]
        or not file_path.exists()
    ):
        raise HTTPException(
            status_code=404,
            detail="File tidak ditemukan."
        )

    return FileResponse(
        path=file_path,
        filename=file_path.name
    )


# =========================================================
# 29. ROOT ENDPOINT
# =========================================================

@app.get("/")
def root():
    return {
        "application": "AgriDash API",
        "version": "0.1.0",
        "storage": "CSV / Excel",
        "database_required": False,
        "master_dataset": active_master_file().name,
        "features": [
            "Dashboard",
            "Monitoring Wilayah",
            "Status Wilayah",
            "Clustering",
            "PCA",
            "Forecasting",
            "Rekomendasi",
            "Data Center",
            "Audit Trail"
        ],
        "documentation": "/docs",
        "health": "/health",
        "status": "running"
    }