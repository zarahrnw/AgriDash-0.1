import os
import io
import json
import random
import tempfile
import threading
import pickle
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
import pandas as pd
import requests

from dotenv import load_dotenv
from fastapi import (
    FastAPI, HTTPException, Query,
    UploadFile, File, Depends
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

load_dotenv(PROJECT_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "agri-dash-secret-key-change-this")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
API_INDONESIA_KEY = os.getenv("API_INDONESIA_KEY")
APP_ENVIRONMENT = os.getenv("AGRIDASH_ENVIRONMENT", os.getenv("APP_ENV", "development")).strip().lower()
BMKG_BASE_URL = "https://api.bmkg.go.id/publik/prakiraan-cuaca"

if SECRET_KEY == "agri-dash-secret-key-change-this":
    print("[WARNING] SECRET_KEY masih default. Atur SECRET_KEY acak di api/.env.")


# =========================================================
# 2. KONFIGURASI DATASET & MODEL BUNDLE (FOLDER BARU)
# =========================================================

DATA_DIR = PROJECT_DIR / "output"
REPORT_DIR = PROJECT_DIR / "outputs" / "reports"

PANGAN_DIR = DATA_DIR / "tanaman_pangan"
HORTI_DIR = DATA_DIR / "hortikultura"
BIO_DIR = DATA_DIR / "biofarmaka"

# Auth & audit trail (FIX: sebelumnya tidak terdefinisi -> NameError saat login/upload/audit)
AUTH_DIR = API_DIR / "auth"
USERS_FILE = AUTH_DIR / "users.json"
AUDIT_FILE = AUTH_DIR / "audit_trail.jsonl"
FILE_LOCK = threading.RLock()

# Folder hasil pemodelan. Data bisa ada di output/ (hasil notebook) atau data/model_ready/ (hasil preprocessing).
MODEL_READY_DIR = PROJECT_DIR / "data" / "model_ready"
PANGAN_SEARCH_DIRS = [PANGAN_DIR, MODEL_READY_DIR / "tanaman_pangan"]


def find_output(directories, suffix):
    """Cari file berdasarkan akhiran nama (tahan terhadap perbedaan prefix, mis. tanaman_pangan_ vs tanaman_pangan)."""
    for directory in directories:
        if directory.exists():
            hits = sorted(directory.glob(f"*{suffix}"))
            if hits:
                return hits[0]
    return directories[0] / suffix


PRIMARY_DATA_FILE = find_output(PANGAN_SEARCH_DIRS, "output_rekomendasi_all_scores.csv")
UPLOAD_DATA_FILE = PANGAN_DIR / "tanaman_pangan_upload.csv"

CSV_FILES = {
    "tanaman_pangan": PRIMARY_DATA_FILE,
    "clustering": find_output(PANGAN_SEARCH_DIRS, "output_clustering_pangan.csv"),
    "rekomendasi": find_output(PANGAN_SEARCH_DIRS, "output_rekomendasi_pangan.csv"),
    "rekomendasi_all_scores": PRIMARY_DATA_FILE,
    "timeseries": find_output(PANGAN_SEARCH_DIRS, "output_timeseries_pangan.csv"),
    "model_comparison": find_output(PANGAN_SEARCH_DIRS, "output_model_comparison.csv"),
    "dashboard_summary": find_output(PANGAN_SEARCH_DIRS, "output_dashboard_summary.csv"),

    # Hortikultura & Biofarmaka (output/)
    "hortikultura_klaster": HORTI_DIR / "klaster_kecamatan_hortikultura.csv",
    "hortikultura_prediksi": HORTI_DIR / "prediksi_ets_hortikultura.csv",
    "biofarmaka_klaster": BIO_DIR / "klaster_kecamatan_biofarmaka.csv",
    "biofarmaka_prediksi": BIO_DIR / "prediksi_ets_biofarmaka.csv",

    # Laporan analisis (data/model_ready/)
    "biofarmaka_backtest": MODEL_READY_DIR / "backtest_forecast_biofarmaka.csv",
    "hortikultura_backtest": MODEL_READY_DIR / "backtest_forecast_hortikultura.csv",
    "biofarmaka_evaluasi_klaster": MODEL_READY_DIR / "evaluasi_klaster_biofarmaka.csv",
    "hortikultura_evaluasi_klaster": MODEL_READY_DIR / "evaluasi_klaster_hortikultura.csv",
    "dokumentasi_preprocessing": MODEL_READY_DIR / "dokumentasi_preprocessing.csv",
    "konflik_satuan": MODEL_READY_DIR / "konflik_satuan.csv",
    "inspeksi_dataset": MODEL_READY_DIR / "ringkasan_inspeksi_dataset.csv",
    "statistik_keseluruhan": MODEL_READY_DIR / "statistik_deskriptif_keseluruhan.csv",
    "statistik_per_komoditas": MODEL_READY_DIR / "statistik_deskriptif_per_komoditas.csv",
    "hortikultura_produktivitas_ekstrem": MODEL_READY_DIR / "produktivitas_ekstrem_hortikultura.csv",
}

FORECAST_ACTUAL_FILES = {
    "biofarmaka": {
        "kabupaten": PROJECT_DIR / "data" / "clean" / "biofarmaka" / "biofarmaka_keseluruhan.csv",
        "kecamatan": PROJECT_DIR / "data" / "clean" / "biofarmaka" / "biofarmaka_kecamatan.csv",
    },
    "hortikultura": {
        "kabupaten": PROJECT_DIR / "data" / "clean" / "hortikultura" / "hortikultura_kabupaten_clean.csv",
        "kecamatan": PROJECT_DIR / "data" / "clean" / "hortikultura" / "hortikultura_kecamatan_clean.csv",
    },
}

REQUIRED_COLUMNS = ["kecamatan", "tanaman", "luas_panen_ha", "produksi_ton", "produktivitas_kuintal_ha"]
NUMERIC_COLUMNS = ["luas_panen_ha", "produksi_ton", "produktivitas_kuintal_ha"]

# Load Model Bundle .pkl (Tanaman Pangan)
MODEL_BUNDLE_PATH = find_output(PANGAN_SEARCH_DIRS, "agridash_model_bundle.pkl")
MODEL_BUNDLE = None

def load_bundle():
    global MODEL_BUNDLE
    if MODEL_BUNDLE_PATH.exists():
        try:
            with open(MODEL_BUNDLE_PATH, "rb") as f:
                MODEL_BUNDLE = pickle.load(f)
            print("[INFO] Model bundle .pkl (Tanaman Pangan) berhasil dimuat.")
        except Exception as e:
            print(f"[ERROR] Gagal memuat .pkl: {e}")

load_bundle()


# =========================================================
# 3. FASTAPI APPLICATION
# =========================================================

@asynccontextmanager
async def lifespan(_app):
    require_changed_demo_passwords_in_production()
    yield


app = FastAPI(
    title="AgriDash API",
    description="API Monitoring Pertanian dan Ketahanan Pangan Kabupaten Kediri",
    version="0.1.0",
    lifespan=lifespan,
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
    df.columns = [str(col).strip().lower().replace(" ", "_") for col in df.columns]
    return df

def normalize_text(value):
    if value is None or pd.isna(value): return ""
    return " ".join(str(value).strip().casefold().split())

def read_csv_excel(path):
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset tidak ditemukan: {path}")
    try:
        if path.suffix.lower() == ".csv":
            try:
                return pd.read_csv(path, encoding="utf-8-sig", sep=None, engine="python")
            except UnicodeDecodeError:
                return pd.read_csv(path, encoding="cp1252", sep=None, engine="python")
        return pd.read_excel(path)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Gagal membaca dataset: {error}")

def active_master_file():
    if UPLOAD_DATA_FILE.exists(): return UPLOAD_DATA_FILE
    return PRIMARY_DATA_FILE

def read_dataset(path):
    df = normalize_columns(read_csv_excel(path))
    mapping = {"prod_mean": "produksi_ton", "luas_mean": "luas_panen_ha", "produktivitas_mean": "produktivitas_kuintal_ha"}
    df = df.rename(columns=mapping)

    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        raise HTTPException(status_code=422, detail=f"Kolom wajib belum tersedia: {missing}")

    df = df[REQUIRED_COLUMNS].copy()
    for col in ["kecamatan", "tanaman"]:
        df[col] = df[col].astype("string").str.strip()
    for col in NUMERIC_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df

def load_tanaman():
    return read_dataset(active_master_file())

def read_agri_csv(path):
    return read_csv_excel(path)

def dataframe_records(df):
    clean_df = df.replace([np.inf, -np.inf], np.nan).astype(object).where(pd.notna(df), None)
    return clean_df.to_dict(orient="records")

def find_column(df, candidates):
    normalized = {str(col).lower().strip().replace(" ", "_"): col for col in df.columns}
    for candidate in candidates:
        key = candidate.lower().strip().replace(" ", "_")
        if key in normalized: return normalized[key]
    return None

def get_cluster_column(df):
    return find_column(df, ["cluster_id", "cluster", "cluster_label", "klaster", "label_cluster"])

def get_kecamatan_column(df):
    return find_column(df, ["kecamatan", "nama_kecamatan", "wilayah"])

def safe_float(value):
    try:
        if pd.isna(value): return None
        number = float(value)
        return number if np.isfinite(number) else None
    except (TypeError, ValueError):
        return None

def to_num(series):
    if pd.api.types.is_numeric_dtype(series):
        return series
    return pd.to_numeric(series.astype(str).str.strip().str.replace(",", ".", regex=False), errors="coerce")


KOM_CANDS = ["komoditas", "tanaman", "jenis_tanaman", "nama_komoditas", "commodity"]
VAL_CANDS = ["produksi_kg", "produksi", "produksi_ton", "prediksi", "forecast", "yhat", "nilai", "value", "y"]
TYPE_CANDS = ["tipe", "type", "jenis_data", "status_data"]
YEAR_CANDS = ["tahun", "year", "periode"]
PROD_CANDS_KL = ["produksi_rata2_kg_per_tahun", "produksi_rata2", "produksi_rata_rata", "rata_rata_produksi", "prod_mean", "produksi"]
TOP3_CANDS = ["top3_komoditas", "top3", "komoditas_dominan", "komoditas_unggulan"]


def aggregate_summary(df):
    return {
        "total_data": int(len(df)),
        "total_kecamatan": int(df["kecamatan"].nunique()),
        "total_komoditas": int(df["tanaman"].nunique()),
        "total_luas_panen": safe_float(df["luas_panen_ha"].sum(min_count=1)),
        "total_produksi": safe_float(df["produksi_ton"].sum(min_count=1)),
        "rata_produktivitas": safe_float(df["produktivitas_kuintal_ha"].mean())
    }


# =========================================================
# 5. HELPER STATUS WILAYAH
# =========================================================

def get_status_color_label(label):
    text = normalize_text(label)
    if "tinggi" in text: return "Potensi Tinggi"
    if "sedang" in text: return "Potensi Sedang"
    if "rendah" in text: return "Potensi Rendah"
    return "Belum Dikategorikan"

def get_status_color(status_label):
    status_label = get_status_color_label(status_label)
    colors = {"Potensi Tinggi": "#265322", "Potensi Sedang": "#60982c", "Potensi Rendah": "#dfe8d5", "Belum Dikategorikan": "#e5e7eb"}
    return colors[status_label]

def load_cluster_status():
    df = normalize_columns(read_agri_csv(CSV_FILES["clustering"]))
    kecamatan_col = get_kecamatan_column(df)
    status_col = find_column(df, ["label_cluster", "label_cluster_agg"])

    if not kecamatan_col or not status_col:
        raise HTTPException(status_code=422, detail="CSV clustering harus memiliki kolom kecamatan dan label_cluster.")

    result = df[[kecamatan_col, status_col]].copy()
    result.columns = ["kecamatan", "status_wilayah"]
    result = result.dropna(subset=["kecamatan"])
    result["kecamatan"] = result["kecamatan"].astype(str).str.strip()
    result["kecamatan_key"] = result["kecamatan"].map(normalize_text)

    if (result.groupby("kecamatan_key")["status_wilayah"].nunique() > 1).any():
        raise HTTPException(status_code=422, detail="Terdapat kecamatan dengan lebih dari satu label cluster.")

    result = result.drop_duplicates(subset=["kecamatan_key"])
    result["status_wilayah"] = result["status_wilayah"].map(get_status_color_label)
    return result

def build_status_wilayah():
    df = load_tanaman().dropna(subset=["kecamatan"]).copy()
    df["kecamatan_key"] = df["kecamatan"].map(normalize_text)

    rekap = df.groupby("kecamatan_key", as_index=False).agg(
        kecamatan=("kecamatan", "first"),
        total_produksi=("produksi_ton", "sum"),
        total_luas_panen=("luas_panen_ha", "sum"),
        rata_produktivitas=("produktivitas_kuintal_ha", "mean")
    )

    cluster = load_cluster_status()
    merged = pd.merge(rekap, cluster[["kecamatan_key", "status_wilayah"]], on="kecamatan_key", how="left")

    rows = []
    for _, row in merged.iterrows():
        status_label = get_status_color_label(row["status_wilayah"])
        rows.append({
            "kecamatan": row["kecamatan"],
            "total_produksi": safe_float(row["total_produksi"]),
            "total_luas_panen": safe_float(row["total_luas_panen"]),
            "rata_produktivitas": safe_float(row["rata_produktivitas"]),
            "status_wilayah": status_label,
            "warna": get_status_color(status_label)
        })
    return sorted(rows, key=lambda x: x["kecamatan"])


# =========================================================
# 6. AUTHENTICATION
# =========================================================

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

BOOTSTRAP_ACCOUNTS = (
    {"username": "superadmin", "role": "super_admin", "password": os.getenv("AGRIDASH_SUPERADMIN_INITIAL_PASSWORD", "super123")},
    {"username": "user", "role": "user", "password": os.getenv("AGRIDASH_USER_INITIAL_PASSWORD", "user123")},
)
BOOTSTRAP_ACCOUNT_VERSION = 1

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class PrediksiRequest(BaseModel):
    kecamatan: str
    tanaman: str
    bulan_ke_depan: int = 1

def read_users():
    with FILE_LOCK:
        if not USERS_FILE.exists():
            users = []
        else:
            try:
                users = json.loads(USERS_FILE.read_text(encoding="utf-8"))
                if not isinstance(users, list) or any(not isinstance(user, dict) for user in users):
                    raise ValueError("Format users.json tidak valid")
            except (OSError, ValueError) as error:
                raise HTTPException(status_code=500, detail=f"Gagal membaca user: {error}")

        changed = False
        for account in BOOTSTRAP_ACCOUNTS:
            username = account["username"]
            matching = [
                index for index, user in enumerate(users)
                if str(user.get("username", "")).casefold() == username.casefold()
            ]

            if matching:
                user = users[matching[0]]
                duplicate_indices = set(matching[1:])
                if duplicate_indices:
                    users = [entry for index, entry in enumerate(users) if index not in duplicate_indices]
                    changed = True
                if user.get("username") != username:
                    user["username"] = username
                    changed = True
                if user.get("role") != account["role"]:
                    user["role"] = account["role"]
                    changed = True
                if (
                    user.get("bootstrap_version") != BOOTSTRAP_ACCOUNT_VERSION
                    or not user.get("password_hash")
                    or "must_change_password" not in user
                ):
                    user["password_hash"] = pwd_context.hash(account["password"])
                    user["must_change_password"] = True
                    user["bootstrap_version"] = BOOTSTRAP_ACCOUNT_VERSION
                    changed = True
            else:
                next_id = max(
                    (entry.get("id", 0) for entry in users if isinstance(entry.get("id", 0), int)),
                    default=0,
                ) + 1
                users.append({
                    "id": next_id,
                    "username": username,
                    "password_hash": pwd_context.hash(account["password"]),
                    "role": account["role"],
                    "must_change_password": True,
                    "bootstrap_version": BOOTSTRAP_ACCOUNT_VERSION,
                })
                changed = True

        if changed:
            save_users(users)
        return users


def require_changed_demo_passwords_in_production():
    if APP_ENVIRONMENT not in {"production", "prod"}:
        return
    users = read_users()
    bootstrap_usernames = {account["username"] for account in BOOTSTRAP_ACCOUNTS}
    if any(
        user.get("username") in bootstrap_usernames and user.get("must_change_password")
        for user in users
    ):
        raise RuntimeError("Change all initial demo passwords before starting in production.")

def save_users(users):
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=AUTH_DIR, suffix=".json", delete=False) as temp:
        json.dump(users, temp, ensure_ascii=False, indent=2)
        temp_path = Path(temp.name)
    temp_path.replace(USERS_FILE)

def create_access_token(data):
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def user_from_token(token):
    error = HTTPException(status_code=401, detail="Token tidak valid atau kedaluwarsa.", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username: raise error
    except JWTError: raise error

    user = next((u for u in read_users() if u["username"] == username), None)
    if not user: raise error
    return user

def get_current_user(token: str = Depends(oauth2_scheme)):
    return user_from_token(token)

def get_current_super_admin(user: dict = Depends(get_current_user)):
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Akses hanya untuk Super Admin.")
    if user.get("must_change_password"):
        raise HTTPException(status_code=403, detail="Ganti password awal sebelum menggunakan fitur Super Admin.")
    return user

def write_audit(username, action, details=""):
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    entry = {"username": username, "aktivitas": action, "details": details, "waktu": datetime.now().strftime("%d-%m-%Y %H:%M:%S")}
    with FILE_LOCK:
        with AUDIT_FILE.open("a", encoding="utf-8") as file:
            file.write(json.dumps(entry, ensure_ascii=False) + "\n")


# =========================================================
# 7. HEALTH CHECK
# =========================================================

@app.get("/health")
def health_check():
    master = active_master_file()
    result = {
        "status": "healthy" if master.exists() else "dataset_missing",
        "storage": "csv_excel",
        "database": "not_used",
        "master_file": str(master),
        "master_exists": master.exists(),
        "tanaman_pangan_rows": None,
        "pkl_loaded": MODEL_BUNDLE is not None,
        "csv_files": {name: path.exists() for name, path in CSV_FILES.items()},
        "timestamp": datetime.now().isoformat()
    }
    if master.exists():
        result["tanaman_pangan_rows"] = len(load_tanaman())
    return result


# =========================================================
# 8. REGISTER DAN LOGIN
# =========================================================

@app.post("/api/v1/auth/register")
def register_user(user: UserCreate, current_user: dict = Depends(get_current_super_admin)):
    with FILE_LOCK:
        users = read_users()

        username = user.username.strip()
        if not username or len(user.password) < 8:
            raise HTTPException(status_code=400, detail="Username wajib diisi dan password minimal 8 karakter.")
        if user.role not in ["admin", "super_admin", "user"]:
            raise HTTPException(status_code=400, detail="Role tidak valid.")
        if any(u["username"] == username for u in users):
            raise HTTPException(status_code=400, detail="Username sudah terdaftar.")

        role = user.role
        users.append({
            "id": max([u.get("id", 0) for u in users], default=0) + 1,
            "username": username,
            "password_hash": pwd_context.hash(user.password),
            "role": role,
            "must_change_password": True,
        })
        save_users(users)

    return {"message": "Registrasi berhasil.", "username": username, "role": role}


@app.post("/api/v1/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = next((u for u in read_users() if u["username"] == form_data.username), None)
    if not user or not pwd_context.verify(form_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Username atau password salah.")

    token = create_access_token({"sub": user["username"], "role": user["role"]})
    write_audit(user["username"], "Login", "Login berhasil")
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
        "must_change_password": bool(user.get("must_change_password", False)),
    }


@app.get("/api/v1/auth/me")
def get_authenticated_user(user: dict = Depends(get_current_user)):
    return {
        "username": user["username"],
        "role": user["role"],
        "must_change_password": bool(user.get("must_change_password", False)),
    }


@app.post("/api/v1/auth/change-password")
def change_password(change: PasswordChange, current_user: dict = Depends(get_current_user)):
    new_password_bytes = change.new_password.encode("utf-8")
    if len(change.new_password) < 12 or len(new_password_bytes) > 72:
        raise HTTPException(status_code=400, detail="Password baru harus 12–72 byte.")
    try:
        current_password_matches = pwd_context.verify(change.current_password, current_user["password_hash"])
        password_is_unchanged = pwd_context.verify(change.new_password, current_user["password_hash"])
    except ValueError:
        current_password_matches = False
        password_is_unchanged = False
    if not current_password_matches:
        raise HTTPException(status_code=400, detail="Password saat ini tidak sesuai.")
    if password_is_unchanged:
        raise HTTPException(status_code=400, detail="Password baru harus berbeda dari password saat ini.")

    with FILE_LOCK:
        users = read_users()
        user = next((entry for entry in users if entry.get("username") == current_user["username"]), None)
        if not user:
            raise HTTPException(status_code=401, detail="Akun tidak ditemukan.")
        user["password_hash"] = pwd_context.hash(change.new_password)
        user["must_change_password"] = False
        save_users(users)

    write_audit(current_user["username"], "Password changed")
    return {"message": "Password berhasil diperbarui.", "must_change_password": False}


# =========================================================
# 9. MASTER KECAMATAN & REKAP
# =========================================================

@app.get("/api/v1/kecamatan")
def get_kecamatan():
    df = load_tanaman()
    names = sorted(df["kecamatan"].dropna().unique().tolist())
    return {"total": len(names), "data": [{"kecamatan": name} for name in names]}

@app.get("/api/v1/rekap-kecamatan")
def get_rekap_kecamatan():
    df = load_tanaman()
    grouped = df.dropna(subset=["kecamatan"]).groupby("kecamatan", as_index=False).agg(
        total_luas_panen=("luas_panen_ha", "sum"),
        total_produksi=("produksi_ton", "sum"),
        rata_produktivitas=("produktivitas_kuintal_ha", "mean")
    ).sort_values("total_produksi", ascending=False)
    return {"total": len(grouped), "data": dataframe_records(grouped)}


# =========================================================
# 10. DATA TANAMAN PANGAN
# =========================================================

@app.get("/api/v1/tanaman-pangan")
def get_tanaman_pangan(kecamatan: Optional[str] = None, tanaman: Optional[str] = None, limit: int = Query(50, ge=1, le=500), sort_by: str = Query("produksi_ton")):
    if sort_by not in NUMERIC_COLUMNS:
        raise HTTPException(status_code=400, detail="Kolom pengurutan tidak valid.")
    df = load_tanaman()
    if kecamatan: df = df[df["kecamatan"].str.casefold() == kecamatan.casefold()]
    if tanaman: df = df[df["tanaman"].str.casefold() == tanaman.casefold()]
    df = df.sort_values(sort_by, ascending=False, na_position="last").head(limit)
    return {"total": len(df), "data": dataframe_records(df)}

@app.get("/api/v1/tanaman-pangan/ringkasan")
def get_ringkasan_tanaman():
    return aggregate_summary(load_tanaman())


# =========================================================
# 11. UPLOAD DATA
# =========================================================

@app.post("/api/v1/tanaman-pangan/upload")
def upload_tanaman_pangan(file: UploadFile = File(...), current_user: dict = Depends(get_current_super_admin)):
    filename = (file.filename or "").lower()
    if not filename.endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Format file harus CSV atau Excel.")

    content = file.file.read()
    if len(content) > 30 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Ukuran maksimal 30 MB.")

    try:
        if filename.endswith(".csv"):
            try:
                df = pd.read_csv(io.BytesIO(content), encoding="utf-8-sig", sep=None, engine="python")
            except UnicodeDecodeError:
                df = pd.read_csv(io.BytesIO(content), encoding="cp1252", sep=None, engine="python")
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Gagal membaca file: {error}")

    df = normalize_columns(df).rename(columns={"prod_mean": "produksi_ton", "luas_mean": "luas_panen_ha", "produktivitas_mean": "produktivitas_kuintal_ha"})
    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing: raise HTTPException(status_code=400, detail=f"Kolom tidak ditemukan: {missing}")

    df = df[REQUIRED_COLUMNS].copy()
    if df.empty: raise HTTPException(status_code=400, detail="Dataset tidak boleh kosong.")

    for col in NUMERIC_COLUMNS: df[col] = pd.to_numeric(df[col], errors="coerce")

    PANGAN_DIR.mkdir(parents=True, exist_ok=True)
    with FILE_LOCK:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8-sig", suffix=".csv", dir=PANGAN_DIR, newline="", delete=False) as temp:
            df.to_csv(temp, index=False)
            temp_path = Path(temp.name)
        temp_path.replace(UPLOAD_DATA_FILE)

    write_audit(current_user["username"], "Upload Data Tanaman Pangan", f"Mengunggah {file.filename}")
    return {"message": "Upload berhasil.", "total_data": len(df)}


# =========================================================
# 12. MONITORING STATUS WILAYAH
# =========================================================

@app.get("/api/v1/monitoring/status-wilayah")
def get_status_wilayah():
    rows = build_status_wilayah()
    counts = {"Potensi Tinggi": 0, "Potensi Sedang": 0, "Potensi Rendah": 0, "Belum Dikategorikan": 0}
    for row in rows: counts[row["status_wilayah"]] += 1

    return {
        "total": len(rows),
        "sumber_status": "output_clustering_pangan.csv",
        "metode_status": "label_cluster",
        "sumber_indikator": active_master_file().name,
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
    selected = next((row for row in rows if normalize_text(row["kecamatan"]) == normalize_text(nama_kecamatan)), None)
    if not selected: raise HTTPException(status_code=404, detail="Kecamatan tidak ditemukan.")

    df = load_tanaman()
    df = df[df["kecamatan"].map(normalize_text) == normalize_text(nama_kecamatan)]
    return {**selected, "komoditas": dataframe_records(df)}

@app.get("/api/v1/monitoring/ringkasan-status")
def get_ringkasan_status():
    rows = build_status_wilayah()
    summary = {"Potensi Tinggi": 0, "Potensi Sedang": 0, "Potensi Rendah": 0, "Belum Dikategorikan": 0}
    for row in rows: summary[row["status_wilayah"]] += 1

    return {
        "total_kecamatan": len(rows),
        "jumlah_potensi_tinggi": summary["Potensi Tinggi"],
        "jumlah_potensi_sedang": summary["Potensi Sedang"],
        "jumlah_potensi_rendah": summary["Potensi Rendah"],
        "belum_dikategorikan": summary["Belum Dikategorikan"],
        "data": summary
    }


# =========================================================
# 13. CUACA BMKG & EWS
# =========================================================

def fetch_bmkg(kode_kecamatan):
    try:
        response = requests.get(BMKG_BASE_URL, params={"adm4": kode_kecamatan}, timeout=20)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Gagal mengambil data BMKG: {error}")

def extract_bmkg_forecast(data):
    forecasts = []
    for item in data.get("data", []):
        for cuaca in item.get("cuaca", []):
            for forecast in cuaca: forecasts.append(forecast)
    return forecasts

@app.get("/api/v1/cuaca/{kode_kecamatan}")
def get_cuaca(kode_kecamatan: str):
    data = fetch_bmkg(kode_kecamatan)
    forecasts = extract_bmkg_forecast(data)
    if not forecasts: raise HTTPException(status_code=404, detail="Data prakiraan cuaca tidak tersedia.")
    return {"lokasi": data.get("lokasi", {}), "cuaca": forecasts[0], "prakiraan": forecasts[:8]}

@app.get("/api/v1/ews-cuaca/{kode_kecamatan}")
def get_ews_cuaca(kode_kecamatan: str):
    data = fetch_bmkg(kode_kecamatan)
    forecasts = extract_bmkg_forecast(data)
    if not forecasts: raise HTTPException(status_code=404, detail="Data cuaca tidak tersedia.")

    current = forecasts[0]
    rainfall = safe_float(current.get("tp")) or 0
    humidity = safe_float(current.get("hu")) or 0
    temperature = safe_float(current.get("t")) or 0

    status_ews, message = "AMAN", "Kondisi cuaca relatif aman."
    if rainfall > 50:
        status_ews, message = "BAHAYA", "Curah hujan tinggi. Waspadai genangan."
    elif humidity > 80 and rainfall > 10:
        status_ews, message = "WASPADA", "Kelembapan dan curah hujan tinggi."
    elif temperature > 34:
        status_ews, message = "WASPADA", "Suhu tinggi. Perhatikan kebutuhan air."

    return {"status": status_ews, "pesan": message, "parameter": {"curah_hujan": rainfall, "kelembapan": humidity, "suhu": temperature}, "waktu": current.get("local_datetime")}


# =========================================================
# 14. PREDIKSI & HARGA PANGAN
# =========================================================

@app.post("/api/v1/prediksi")
def prediksi_produksi(request: PrediksiRequest):
    if request.bulan_ke_depan < 1: raise HTTPException(status_code=400, detail="Bulan prediksi minimal 1.")
    df = load_tanaman()
    matches = df[(df["kecamatan"].str.casefold() == request.kecamatan.casefold()) & (df["tanaman"].str.casefold() == request.tanaman.casefold())]

    if matches["produksi_ton"].count() == 0: raise HTTPException(status_code=404, detail="Data produksi tidak ditemukan.")

    produksi_awal = float(matches["produksi_ton"].sum())
    faktor = 1 + 0.05 * request.bulan_ke_depan
    hasil = produksi_awal * faktor * (1 + random.uniform(-0.02, 0.02))

    return {"kecamatan": request.kecamatan, "tanaman": request.tanaman, "produksi_awal": round(produksi_awal, 2), "bulan_ke_depan": request.bulan_ke_depan, "prediksi_produksi": round(hasil, 2), "keterangan": "Simulasi, bukan hasil model machine learning."}

@app.get("/api/v1/harga-pangan")
def get_harga_pangan():
    if not API_INDONESIA_KEY: raise HTTPException(status_code=503, detail="API_INDONESIA_KEY belum dikonfigurasi.")
    try:
        response = requests.get("https://use.apiindonesia.id/api/v1/harga-pangan/harga", headers={"x-api-key": API_INDONESIA_KEY}, params={"tingkat": "konsumen", "wilayah": "provinsi", "provinsi": "jawa timur", "limit": 100}, timeout=20)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Gagal mengambil harga pangan: {error}")


# =========================================================
# 15. AUDIT TRAIL
# =========================================================

@app.get("/api/v1/audit-trail")
def get_audit_trail(user: dict = Depends(get_current_super_admin)):
    if not AUDIT_FILE.exists(): return {"total": 0, "data": []}
    with FILE_LOCK:
        lines = AUDIT_FILE.read_text(encoding="utf-8").splitlines()
    rows = [json.loads(line) for line in lines[-50:] if line.strip()][::-1]
    return {"total": len(rows), "data": rows}


# =========================================================
# 16. CLUSTERING (DATA + PCA) - PAKAI .PKL & CSV BARU
# =========================================================

def load_clustering_df():
    if MODEL_BUNDLE and "cluster_assignments" in MODEL_BUNDLE:
        df = MODEL_BUNDLE["cluster_assignments"].copy()
        return normalize_columns(df)
    
    df = normalize_columns(read_agri_csv(CSV_FILES["clustering"]))
    text_cols = {"kecamatan", "nama_kecamatan", "wilayah", "label_cluster", "label_cluster_agg", "cluster_label", "klaster", "cluster", "cluster_id"}
    for col in df.columns:
        if col in text_cols: continue
        series = df[col]
        if pd.api.types.is_numeric_dtype(series):
            df[col] = pd.to_numeric(series, errors="coerce")
            continue
        cleaned = series.astype(str).str.strip().str.replace("\u00a0", " ", regex=False).str.replace(" ", "", regex=False).str.replace(",", ".", regex=False)
        converted = pd.to_numeric(cleaned, errors="coerce")
        if converted.notna().mean() >= 0.5: df[col] = converted
    return df

@app.get("/api/v1/clustering")
def get_clustering():
    df = load_clustering_df()
    return {"total": len(df), "columns": list(df.columns), "cluster_column": get_cluster_column(df), "data": dataframe_records(df)}

@app.get("/api/v1/clustering/pca")
def get_pca():
    df = load_clustering_df()
    # FIX: kolom id cluster (numerik) tidak boleh ikut jadi fitur PCA (kebocoran label)
    cluster_col = get_cluster_column(df)
    numeric_df = (
        df.select_dtypes(include=[np.number])
        .drop(columns=[c for c in [cluster_col] if c], errors="ignore")
        .dropna(axis=1, how="all")
    )
    if numeric_df.shape[1] > 0: numeric_df = numeric_df.loc[:, numeric_df.std(numeric_only=True) > 0]
    numeric_df = numeric_df.dropna(axis=0, how="any")

    if numeric_df.shape[0] < 2 or numeric_df.shape[1] < 2:
        raise HTTPException(status_code=422, detail=f"Data numerik tidak cukup untuk PCA. Ditemukan {numeric_df.shape[0]} baris dan {numeric_df.shape[1]} kolom numerik.")

    scaled = StandardScaler().fit_transform(numeric_df)
    pca = PCA(n_components=2)
    components = pca.fit_transform(scaled)

    kecamatan_col = get_kecamatan_column(df)
    label_col = find_column(df, ["label_cluster", "label_cluster_agg", "cluster_label"])

    points = []
    for i, (idx, original_row) in enumerate(df.loc[numeric_df.index].iterrows()):
        points.append({
            "kecamatan": str(original_row[kecamatan_col]) if kecamatan_col else f"Data-{i}",
            "cluster": str(original_row[cluster_col]) if cluster_col else (str(original_row[label_col]) if label_col else "Unknown"),
            "label_cluster": str(original_row[label_col]) if label_col else None,
            "pc1": float(components[i][0]),
            "pc2": float(components[i][1])
        })

    return {"n_samples": int(numeric_df.shape[0]), "n_features": int(numeric_df.shape[1]), "features": list(numeric_df.columns), "explained_variance_ratio": [float(v) for v in pca.explained_variance_ratio_], "explained_variance_total": float(pca.explained_variance_ratio_.sum()), "data": points}


# =========================================================
# 17. REKOMENDASI & TIMESERIES
# =========================================================

@app.get("/api/v1/rekomendasi")
def get_rekomendasi(kecamatan: Optional[str] = None, limit: int = Query(50, ge=1, le=500)):
    source = CSV_FILES["rekomendasi_all_scores"] if CSV_FILES["rekomendasi_all_scores"].exists() else CSV_FILES["rekomendasi"]
    df = normalize_columns(read_agri_csv(source))
    if kecamatan:
        col = get_kecamatan_column(df)
        if col: df = df[df[col].astype(str).str.casefold() == kecamatan.casefold()]
    df = df.head(limit)
    return {"total": len(df), "data": dataframe_records(df)}

@app.get("/api/v1/timeseries")
def get_timeseries(kecamatan: Optional[str] = None, tanaman: Optional[str] = None):
    df = normalize_columns(read_agri_csv(CSV_FILES["timeseries"]))
    if kecamatan:
        col = get_kecamatan_column(df)
        if col: df = df[df[col].astype(str).str.casefold() == kecamatan.casefold()]
    if tanaman:
        col = find_column(df, ["tanaman", "komoditas"])
        if col: df = df[df[col].astype(str).str.casefold() == tanaman.casefold()]
    return {"total": len(df), "columns": list(df.columns), "data": dataframe_records(df)}

@app.get("/api/v1/model-comparison")
def get_model_comparison():
    df = normalize_columns(read_agri_csv(CSV_FILES["model_comparison"]))
    return {"total": len(df), "columns": list(df.columns), "data": dataframe_records(df)}


# =========================================================
# 18. UNDUH DATASET / LAPORAN
# =========================================================

@app.get("/api/v1/download/{file_key}")
def download_file(file_key: str):
    if file_key in CSV_FILES: path = CSV_FILES[file_key]
    elif file_key == "master": path = active_master_file()
    elif REPORT_DIR.exists() and (REPORT_DIR / file_key).exists(): path = REPORT_DIR / file_key
    else: raise HTTPException(status_code=404, detail="File tidak ditemukan.")

    if not path.exists(): raise HTTPException(status_code=404, detail=f"File tidak ditemukan: {path.name}")

    return FileResponse(path, media_type="text/csv", filename=path.name)


# =========================================================
# 19. JEMBATAN FRONTEND (ALIAS) - MENGGUNAKAN .PKL & FOLDER BARU
# =========================================================

@app.get("/api/v1/model/clustering")
def frontend_clustering():
    df = load_clustering_df()
    return {"total": len(df), "columns": list(df.columns), "cluster_column": get_cluster_column(df), "data": dataframe_records(df)}

@app.get("/api/v1/model/crop-clustering")
def frontend_crop_clustering(kategori: str = Query(...)):
    category = normalize_text(kategori)
    if category not in {"biofarmaka", "hortikultura"}:
        raise HTTPException(status_code=400, detail="Kategori harus biofarmaka atau hortikultura.")

    cluster_path = CSV_FILES[f"{category}_klaster"]
    production_path = FORECAST_ACTUAL_FILES[category]["kecamatan"]
    if not cluster_path.is_file() or not production_path.is_file():
        raise HTTPException(status_code=404, detail=f"Data klaster atau produksi {category} tidak ditemukan.")

    cluster_df = normalize_columns(read_agri_csv(cluster_path))
    production_df = normalize_columns(read_agri_csv(production_path))
    cluster_region = get_kecamatan_column(cluster_df)
    cluster_column = get_cluster_column(cluster_df)
    average_column = find_column(cluster_df, PROD_CANDS_KL)
    top3_column = find_column(cluster_df, TOP3_CANDS)
    production_region = get_kecamatan_column(production_df)
    commodity_column = find_column(production_df, KOM_CANDS)
    value_column = find_column(production_df, ["produksi_kg", "produksi"])

    if not all([cluster_region, cluster_column, average_column, top3_column]):
        raise HTTPException(status_code=422, detail=f"Kolom hasil klaster {category} belum lengkap.")
    if not all([production_region, commodity_column, value_column]):
        raise HTTPException(status_code=422, detail=f"Kolom produksi aktual {category} belum lengkap.")

    clusters = cluster_df[[cluster_region, cluster_column, average_column, top3_column]].copy()
    clusters.columns = ["kecamatan", "cluster", "produksi_rata2_kg_per_tahun", "top3_komoditas"]
    production = production_df[[production_region, commodity_column, value_column]].copy()
    production.columns = ["kecamatan", "komoditas", "produksi"]
    return {
        "kategori": category,
        "clusters": dataframe_records(clusters),
        "production": dataframe_records(production),
    }

@app.get("/api/v1/model/pca")
def frontend_pca():
    return get_pca()

@app.get("/api/v1/model/rekomendasi")
def frontend_rekomendasi(kecamatan: Optional[str] = None, limit: int = Query(50, ge=1, le=500)):
    if MODEL_BUNDLE and "recommendations" in MODEL_BUNDLE:
        df = normalize_columns(MODEL_BUNDLE["recommendations"].copy())
    else:
        source = CSV_FILES["rekomendasi_all_scores"] if CSV_FILES["rekomendasi_all_scores"].exists() else CSV_FILES["rekomendasi"]
        df = normalize_columns(read_agri_csv(source))

    if kecamatan:
        col = get_kecamatan_column(df)
        if col: df = df[df[col].astype(str).str.casefold() == kecamatan.casefold()]

    df = df.head(limit)
    df = df.rename(columns={"score": "skor_rekomendasi", "skor": "skor_rekomendasi", "nilai": "skor_rekomendasi"})
    return {"total": len(df), "data": dataframe_records(df)}

def pivot_heatmap(df, kec_col, kom_col, val_col):
    d = df[[kec_col, kom_col, val_col]].copy()
    d[val_col] = to_num(d[val_col])
    d = d.dropna(subset=[kec_col, kom_col])
    pv = d.pivot_table(index=kec_col, columns=kom_col, values=val_col, aggfunc="mean").reset_index()
    pv = pv.rename(columns={kec_col: "kecamatan"})
    pv.columns.name = None
    return pv


@app.get("/api/v1/model/heatmap-kecamatan")
def frontend_heatmap(kategori: str = Query("tanaman_pangan")):
    key = normalize_text(kategori)
    prefix = "biofarmaka" if "bio" in key else ("hortikultura" if "horti" in key else None)

    if prefix is None:
        # FIX: pivot langsung dari data produksi (kolom komoditas sebelumnya tidak cocok dengan JS)
        df = load_tanaman().dropna(subset=["kecamatan", "tanaman"])
        pv = pivot_heatmap(df, "kecamatan", "tanaman", "produksi_ton")
        satuan = "ton"
    else:
        path = CSV_FILES[f"{prefix}_prediksi"]
        df = normalize_columns(read_agri_csv(path))
        kec, kom, val = get_kecamatan_column(df), find_column(df, KOM_CANDS), find_column(df, VAL_CANDS)
        if not (kec and kom and val):
            raise HTTPException(
                status_code=422,
                detail=f"Kolom kecamatan/komoditas/produksi tidak ditemukan di {path.name}. Kolom tersedia: {list(df.columns)}",
            )
        typ = find_column(df, TYPE_CANDS)
        if typ:
            actual = df[df[typ].astype(str).str.lower().str.contains("aktual|actual|historis", regex=True)]
            if not actual.empty:
                df = actual
        pv = pivot_heatmap(df, kec, kom, val)
        satuan = "kg"

    return {
        "kategori": prefix or "tanaman_pangan",
        "satuan": satuan,
        "kecamatan_column": "kecamatan",
        "komoditas": [c for c in pv.columns if c != "kecamatan"],
        "total": len(pv),
        "data": dataframe_records(pv),
    }


def _year_str(value):
    try:
        return str(int(float(value)))
    except (TypeError, ValueError):
        return str(value)


def extract_backtest(pr):
    """Ambil tabel evaluasi (WAPE dll) dari CSV prediksi, hanya jika kolomnya memang ada."""
    if pr is None:
        return []
    wape = find_column(pr, ["wape_%", "wape", "wape_persen", "wape_pct"])
    model = find_column(pr, ["model", "metode", "best_model"])
    if not wape or not model:
        return []
    mae = find_column(pr, ["mae"])
    mdape = find_column(pr, ["mdape_%", "mdape"])
    level = find_column(pr, ["level", "tingkat"])
    target = find_column(pr, ["target"])
    year = find_column(pr, ["uji_tahun", "tahun_uji", "test_year", "tahun"])
    out = []
    for _, r in pr.iterrows():
        out.append({
            "level": str(r[level]).strip().lower() if level else "kabupaten",
            "target": str(r[target]).strip().lower() if target else "produksi",
            "uji_tahun": _year_str(r[year]) if year else "2023",
            "model": str(r[model]),
            "WAPE_%": safe_float(r[wape]),
            "MAE": safe_float(r[mae]) if mae else None,
            "MdAPE_%": safe_float(r[mdape]) if mdape else None,
        })
    return out


def _count_col(df, cands):
    col = find_column(df, cands)
    return int(df[col].notna().sum()) if col else 0


STAT_ALIASES = {
    "tahun": ["tahun", "year", "periode"],
    "kecamatan": ["kecamatan", "wilayah"],
    "komoditas": ["komoditas", "tanaman", "jenis_tanaman"],
    "produksi": ["produksi", "produksi_kg", "produksi_ton"],
    "luas": ["luas", "luas_panen", "luas_panen_ha", "luas_ha"],
    "produktivitas": ["produktivitas", "produktivitas_kuintal_ha", "produktivitas_kg_ha"],
}
STAT_LABELS = {"count", "unique", "mean", "std", "min", "max", "top", "freq"}


def _stat_value(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    number = safe_float(value)
    return number if number is not None else str(value)


def load_stats_file(path):
    """Baca statistik_deskriptif_*.csv (format describe()) -> {variabel: {count, unique, ...}}."""
    if not path or not path.exists():
        return {}
    try:
        df = normalize_columns(read_csv_excel(path))
    except Exception:
        return {}
    if df.empty or len(df.columns) < 2:
        return {}
    first = df.columns[0]
    labels = df[first].astype(str).str.strip().str.lower()
    raw = {}
    if labels.isin(STAT_LABELS).any():  # baris = statistik, kolom = variabel
        for col in df.columns[1:]:
            raw[col] = {lab: _stat_value(v) for lab, v in zip(labels, df[col])}
    elif any(c in STAT_LABELS for c in df.columns):  # baris = variabel
        for _, row in df.iterrows():
            key = normalize_text(row[first]).replace(" ", "_")
            raw[key] = {c: _stat_value(row[c]) for c in df.columns[1:] if c in STAT_LABELS}
    out = {}
    for target, cands in STAT_ALIASES.items():
        for cand in cands:
            if cand in raw:
                out[target] = raw[cand]
                break
    return out


def build_overview(prefix):
    kl_path = CSV_FILES[f"{prefix}_klaster"]
    pr_path = CSV_FILES[f"{prefix}_prediksi"]
    kl = normalize_columns(read_agri_csv(kl_path)) if kl_path.exists() else None
    pr = normalize_columns(read_agri_csv(pr_path)) if pr_path.exists() else None
    if kl is None and pr is None:
        raise HTTPException(status_code=404, detail=f"File {prefix} (klaster/prediksi) tidak ditemukan di {kl_path.parent}.")

    base = pr if pr is not None else kl

    # --- klaster per kecamatan
    records, kec_names = [], set()
    prod_col_kl = None
    if kl is not None:
        kec = get_kecamatan_column(kl)
        clus = get_cluster_column(kl)
        prod_col_kl = find_column(kl, PROD_CANDS_KL)
        top3 = find_column(kl, TOP3_CANDS)
        if kec:
            for _, row in kl.iterrows():
                kec_names.add(str(row[kec]))
                records.append({
                    "kecamatan": str(row[kec]),
                    "klaster": str(row[clus]) if clus else "0",
                    "produksi_rata2_kg_per_tahun": safe_float(row[prod_col_kl]) if prod_col_kl else None,
                    "top3_komoditas": str(row[top3]) if top3 and pd.notna(row[top3]) else "—",
                })

    # --- statistik (semua dihitung dari data, tidak ada angka hardcode)
    pr_kec = get_kecamatan_column(pr) if pr is not None else None
    pr_kom = find_column(pr, KOM_CANDS) if pr is not None else None
    pr_val = find_column(pr, VAL_CANDS) if pr is not None else None
    if pr_kec:
        kec_names |= set(pr[pr_kec].dropna().astype(str))
    n_kom = int(pr[pr_kom].nunique()) if pr_kom else 0

    stats = {
        "tahun": {"count": int(len(base))},
        "kecamatan": {"unique": len(kec_names)},
        "komoditas": {"unique": n_kom},
        "produksi": {"count": _count_col(base, VAL_CANDS + PROD_CANDS_KL)},
        "luas": {"count": _count_col(base, ["luas", "luas_panen", "luas_panen_ha", "luas_ha", "luas_mean"])},
        "produktivitas": {"count": _count_col(base, ["produktivitas", "produktivitas_kuintal_ha", "produktivitas_mean"])},
    }

    # Statistik resmi dari data/model_ready/statistik_deskriptif_keseluruhan.csv menimpa hitungan sementara
    for key, value in load_stats_file(CSV_FILES.get("statistik_keseluruhan")).items():
        stats[key] = {**stats.get(key, {}), **value}

    
    # =====================================================
    # TOP 5 KOMODITAS DAN KECAMATAN
    # Berdasarkan laporan klaster, bukan penjumlahan prediksi
    # =====================================================

    from collections import Counter

    top_komoditas = []
    top_kecamatan = []

    # 1. TOP 5 KOMODITAS
    # Frekuensi kemunculan dalam Top 3 tiap kecamatan

    frekuensi = Counter()

    if kl is not None:
        top3_col = find_column(kl, TOP3_CANDS)

        if top3_col:
            for value in kl[top3_col].dropna():
                nama_komoditas = {
                    nama.strip().replace("_", " ").title()
                    for nama in str(value).replace(";", ",").split(",")
                    if nama.strip() and nama.strip() != "—"
                }

                frekuensi.update(nama_komoditas)

    top_komoditas = [
        nama
        for nama, jumlah in sorted(
            frekuensi.items(),
            key=lambda item: (-item[1], item[0])
        )[:5]
    ]

    # Detail frekuensi untuk visualisasi
    top_komoditas_detail = [
        {
            "komoditas": nama,
            "jumlah_kecamatan": frekuensi[nama]
        }
        for nama in top_komoditas
    ]


    # 2. TOP 5 KECAMATAN
    # Produksi rata-rata berdasarkan laporan klaster

    if records and prod_col_kl:
        valid_records = [
            row for row in records
            if row["produksi_rata2_kg_per_tahun"] is not None
        ]

        top_kecamatan = [
            row["kecamatan"]
            for row in sorted(
                valid_records,
                key=lambda row: row["produksi_rata2_kg_per_tahun"],
                reverse=True
            )[:5]
        ]

    report_keys = {
        "backtest": f"{prefix}_backtest",
        "preprocessing": "dokumentasi_preprocessing",
        "evaluasi_klaster": f"{prefix}_evaluasi_klaster",
        "klaster": f"{prefix}_klaster",
        "konflik_satuan": "konflik_satuan",
        "inspeksi": "inspeksi_dataset",
        "statistik": "statistik_keseluruhan",
        "statistik_komoditas": "statistik_per_komoditas",
    }
    laporan = {}
    for label, file_key in report_keys.items():
        path = CSV_FILES[file_key]
        laporan[label] = {"filename": path.name, "available": path.exists(), "file_key": file_key}

    backtest = []
    bt_path = CSV_FILES.get(f"{prefix}_backtest")
    if bt_path and bt_path.exists():
        try:
            backtest = extract_backtest(normalize_columns(read_csv_excel(bt_path)))
        except Exception:
            backtest = []
    if not backtest:
        backtest = extract_backtest(pr)

    return {
        "kategori": prefix,
        "statistik": stats,
        "klaster": records,
        "backtest": backtest,
        "laporan": laporan,
        "top_komoditas": top_komoditas,
        "top_komoditas_detail": top_komoditas_detail,
        "top_komoditas_metode": "Frekuensi kemunculan dalam Top 3 kecamatan",
        "top_kecamatan": top_kecamatan,
        "kolom": {
            "klaster": list(kl.columns) if kl is not None else [],
            "prediksi": list(pr.columns) if pr is not None else [],
        },
    }


@app.get("/api/v1/biofarmaka/overview")
def frontend_biofarmaka():
    return build_overview("biofarmaka")


@app.get("/api/v1/hortikultura/overview")
def frontend_hortikultura():
    return build_overview("hortikultura")


def standardize_forecast_columns(df):
    """Samakan nama kolom umum supaya frontend bisa mengenali tahun/komoditas."""
    ren = {}
    for target, cands in (("tahun", ["tahun", "year", "periode"]), ("tanaman", ["tanaman", "komoditas", "commodity"])):
        col = find_column(df, cands)
        if col and col != target and target not in df.columns:
            ren[col] = target
    return df.rename(columns=ren)


def build_crop_forecasting(category):
    prediction_path = CSV_FILES.get(f"{category}_prediksi")
    if not prediction_path or not prediction_path.exists():
        raise HTTPException(status_code=404, detail=f"File prediksi {category} tidak ditemukan.")

    predictions = normalize_columns(read_agri_csv(prediction_path))
    level_col = find_column(predictions, ["level"])
    target_col = find_column(predictions, ["target"])
    commodity_col = find_column(predictions, KOM_CANDS)
    year_col = find_column(predictions, ["tahun", "year"])
    value_col = find_column(predictions, ["prediksi", "forecast", "yhat"])
    region_col = get_kecamatan_column(predictions)
    unit_col = find_column(predictions, ["unit", "satuan"])
    if not all([level_col, target_col, commodity_col, year_col, value_col]):
        raise HTTPException(status_code=422, detail=f"Kolom wajib file prediksi {category} belum lengkap.")

    production_predictions = predictions[
        predictions[target_col].astype(str).str.strip().str.casefold().eq("produksi")
    ]
    unit_by_series = {}
    forecast_rows = []
    for _, row in production_predictions.iterrows():
        level = normalize_text(row[level_col])
        commodity = str(row[commodity_col]).strip()
        region = str(row[region_col]).strip() if region_col and pd.notna(row[region_col]) else ""
        unit = str(row[unit_col]).strip() if unit_col and pd.notna(row[unit_col]) else ""
        series_key = (level, normalize_text(commodity), normalize_text(region))
        if unit:
            unit_by_series.setdefault(series_key, unit)
        value = safe_float(row[value_col])
        if value is None:
            continue
        forecast_rows.append({
            "tahun": _year_str(row[year_col]),
            "kecamatan": region or None,
            "komoditas": commodity,
            "target": "produksi",
            "nilai": value,
            "tipe": "Prediksi",
            "level": level,
            "unit": unit or None,
        })

    actual_rows = []
    for level, path in FORECAST_ACTUAL_FILES[category].items():
        if not path.exists():
            continue
        actual = normalize_columns(read_agri_csv(path))
        actual_year_col = find_column(actual, ["tahun", "year"])
        actual_commodity_col = find_column(actual, KOM_CANDS)
        actual_value_col = find_column(actual, ["produksi", "produksi_kg", "produksi_ton", "nilai", "value"])
        actual_region_col = get_kecamatan_column(actual)
        if not all([actual_year_col, actual_commodity_col, actual_value_col]):
            raise HTTPException(status_code=422, detail=f"Kolom aktual file {path.name} belum lengkap.")

        for _, row in actual.iterrows():
            value = safe_float(row[actual_value_col])
            commodity = str(row[actual_commodity_col]).strip() if pd.notna(row[actual_commodity_col]) else ""
            region = str(row[actual_region_col]).strip() if actual_region_col and pd.notna(row[actual_region_col]) else ""
            if value is None or not commodity or (level == "kecamatan" and not region):
                continue
            series_key = (level, normalize_text(commodity), normalize_text(region))
            actual_rows.append({
                "tahun": _year_str(row[actual_year_col]),
                "kecamatan": region or None,
                "komoditas": commodity,
                "target": "produksi",
                "nilai": value,
                "tipe": "Aktual",
                "level": level,
                "unit": unit_by_series.get(series_key),
            })

    backtest_path = CSV_FILES.get(f"{category}_backtest")
    backtest = []
    if backtest_path and backtest_path.exists():
        backtest = extract_backtest(normalize_columns(read_agri_csv(backtest_path)))

    data = actual_rows + forecast_rows
    return {
        "kategori": category,
        "total": len(data),
        "columns": list(data[0].keys()) if data else [],
        "data": data,
        "backtest": backtest,
    }


@app.get("/api/v1/model/forecasting")
def frontend_forecasting(kategori: str = "tanaman_pangan"):
    category = normalize_text(kategori).replace(" ", "_")
    if category in FORECAST_ACTUAL_FILES:
        return build_crop_forecasting(category)
    if category != "tanaman_pangan":
        raise HTTPException(status_code=400, detail="Kategori forecasting tidak valid.")

    if MODEL_BUNDLE and "forecast_long" in MODEL_BUNDLE:
        df = standardize_forecast_columns(normalize_columns(MODEL_BUNDLE["forecast_long"].copy()))
        return {"total": len(df), "columns": list(df.columns), "data": dataframe_records(df)}

    path = CSV_FILES.get("timeseries")
    if not path or not path.exists(): raise HTTPException(status_code=404, detail="File timeseries tidak ditemukan.")

    df = normalize_columns(read_agri_csv(path))
    if "tahun" not in df.columns:
        df = df.rename(columns={"year": "tahun"}) if "year" in df.columns else df.assign(tahun="2023")
    if "tanaman" not in df.columns:
        df["tanaman"] = df["komoditas"] if "komoditas" in df.columns else "Padi"
    if "nilai" not in df.columns:
        prod_col = find_column(df, ["produksi_ton", "produksi", "value", "y"])
        if prod_col: df["nilai"] = df[prod_col]
        else: df["nilai"] = 0
    if "tipe" not in df.columns:
        df["tipe"] = df["tahun"].apply(lambda x: "Aktual" if str(x).isdigit() and int(x) <= 2023 else "Prediksi")

    df["target"] = "produksi"
    return {"total": len(df), "columns": list(df.columns), "data": dataframe_records(df)}

@app.get("/api/v1/model/comparison")
def frontend_model_comparison():
    if MODEL_BUNDLE and "cv_wape" in MODEL_BUNDLE:
        df = normalize_columns(MODEL_BUNDLE["cv_wape"].copy())
        return {"total": len(df), "columns": list(df.columns), "data": dataframe_records(df)}
        
    df = normalize_columns(read_agri_csv(CSV_FILES["model_comparison"]))
    return {"total": len(df), "columns": list(df.columns), "data": dataframe_records(df)}

DATA_CENTER_META = {
    "clustering": "K-Means Clustering",
    "rekomendasi": "Rekomendasi Komoditas",
    "rekomendasi_all_scores": "Rekomendasi (semua skor)",
    "timeseries": "Time Series / Forecasting",
    "model_comparison": "Perbandingan Model",
    "dashboard_summary": "Ringkasan Dashboard",
}


def _count_rows(path):
    try:
        return len(read_csv_excel(path))
    except Exception:
        return None


def _file_item(key, path, kategori, jenis):
    return {
        "key": key,
        "nama": path.name,
        "kategori": kategori,
        "jenis": jenis,
        "ukuran_kb": round(path.stat().st_size / 1024, 1),
        "jumlah_record": _count_rows(path),
        "status": "Aktif" if kategori == "dataset" else "Tersedia",
        "endpoint": f"/api/v1/download/{key}",
    }


@app.get("/api/v1/data-center")
def frontend_data_center():
    # FIX: sebelumnya mengembalikan health_check() sehingga JS tidak menemukan list file.
    items = []
    master = active_master_file()
    if master.exists():
        jenis = "Dataset upload admin" if master == UPLOAD_DATA_FILE else "Dataset utama"
        items.append(_file_item("master", master, "dataset", jenis))
    for key, path in CSV_FILES.items():
        if key == "tanaman_pangan" or not path.exists() or path == master:
            continue
        if key in DATA_CENTER_META:
            items.append(_file_item(key, path, "model", DATA_CENTER_META[key]))
        else:
            items.append(_file_item(key, path, "laporan", key.replace("_", " ").title()))
    try:
        health = health_check()
    except HTTPException as error:
        health = {"status": "error", "detail": error.detail}
    return {"total": len(items), "data": items, "health": health}


@app.get("/api/v1/debug/schema")
def debug_schema():
    """Lihat kolom semua CSV & isi bundle .pkl. Aktifkan dengan env DEBUG_SCHEMA=1 (hanya untuk development)."""
    if os.getenv("DEBUG_SCHEMA") != "1":
        raise HTTPException(status_code=404, detail="Not found")
    out = {"csv": {}, "bundle": {}}
    for key, path in CSV_FILES.items():
        if not path.exists():
            out["csv"][key] = "FILE TIDAK ADA"
            continue
        try:
            df = read_csv_excel(path)
            out["csv"][key] = {"rows": len(df), "columns": list(df.columns), "head": dataframe_records(df.head(2))}
        except Exception as error:
            out["csv"][key] = f"ERROR: {error}"
    if MODEL_BUNDLE:
        for name, obj in MODEL_BUNDLE.items():
            if isinstance(obj, pd.DataFrame):
                out["bundle"][name] = {"rows": len(obj), "columns": list(obj.columns), "head": dataframe_records(obj.head(2))}
            else:
                out["bundle"][name] = type(obj).__name__
    return out


# =========================================================
# 20. ROOT ENDPOINT
# =========================================================

@app.get("/")
def root():
    return {
        "app": "AgriDash API",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
        "timestamp": datetime.now().isoformat()
    }


# =========================================================
# DASHBOARD HORTIKULTURA
# =========================================================

@app.get("/api/v1/hortikultura/dashboard")
def get_dashboard_hortikultura():

    klaster_path = CSV_FILES["hortikultura_klaster"]
    prediksi_path = CSV_FILES["hortikultura_prediksi"]

    def baca_data(path):
        if not path.is_file():
            return {
                "available": False,
                "columns": [],
                "data": []
            }

        df = normalize_columns(read_csv_excel(path))

        return {
            "available": True,
            "columns": list(df.columns),
            "data": dataframe_records(df)
        }

    klaster = baca_data(klaster_path)
    prediksi = baca_data(prediksi_path)

    if not klaster["available"] and not prediksi["available"]:
        raise HTTPException(
            status_code=404,
            detail="Dataset Hortikultura tidak ditemukan."
        )

    kecamatan = set()

    for sumber in [klaster, prediksi]:
        for row in sumber["data"]:
            nama = row.get("kecamatan")
            if nama is not None and str(nama).strip():
                kecamatan.add(str(nama).strip())

    return {
        "sumber": "output/hortikultura",
        "total_kecamatan": len(kecamatan),
        "klaster": klaster,
        "prediksi": prediksi
    }
