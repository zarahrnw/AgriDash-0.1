import os
import io
import json
import random
import tempfile
import threading
import pickle
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
BMKG_BASE_URL = "https://api.bmkg.go.id/publik/prakiraan-cuaca"

DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123")

if SECRET_KEY == "agri-dash-secret-key-change-this":
    print("[WARNING] SECRET_KEY masih default. Atur SECRET_KEY acak di api/.env.")
if DEFAULT_ADMIN_PASSWORD == "admin123":
    print("[WARNING] Password admin default (admin123). Atur DEFAULT_ADMIN_PASSWORD di api/.env sebelum deploy.")


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
FILE_LOCK = threading.Lock()

PRIMARY_DATA_FILE = PANGAN_DIR / "tanaman_panganoutput_rekomendasi_all_scores.csv"
UPLOAD_DATA_FILE = PANGAN_DIR / "tanaman_pangan_upload.csv"

CSV_FILES = {
    "tanaman_pangan": PRIMARY_DATA_FILE,
    "clustering": PANGAN_DIR / "tanaman_panganoutput_clustering_pangan.csv",
    "rekomendasi": PANGAN_DIR / "tanaman_panganoutput_rekomendasi_pangan.csv",
    "rekomendasi_all_scores": PANGAN_DIR / "tanaman_panganoutput_rekomendasi_all_scores.csv",
    "timeseries": PANGAN_DIR / "tanaman_panganoutput_timeseries_pangan.csv",
    "model_comparison": PANGAN_DIR / "tanaman_panganoutput_model_comparison.csv",
    "dashboard_summary": PANGAN_DIR / "tanaman_panganoutput_dashboard_summary.csv",
    
    # File Hortikultura & Biofarmaka
    "hortikultura_klaster": HORTI_DIR / "klaster_kecamatan_hortikultura.csv",
    "hortikultura_prediksi": HORTI_DIR / "prediksi_ets_hortikultura.csv",
    "biofarmaka_klaster": BIO_DIR / "klaster_kecamatan_biofarmaka.csv",
    "biofarmaka_prediksi": BIO_DIR / "prediksi_ets_biofarmaka.csv"
}

REQUIRED_COLUMNS = ["kecamatan", "tanaman", "luas_panen_ha", "produksi_ton", "produktivitas_kuintal_ha"]
NUMERIC_COLUMNS = ["luas_panen_ha", "produksi_ton", "produktivitas_kuintal_ha"]

# Load Model Bundle .pkl (Tanaman Pangan)
MODEL_BUNDLE_PATH = PANGAN_DIR / "tanaman_panganagridash_model_bundle.pkl"
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

app = FastAPI(
    title="AgriDash API",
    description="API Monitoring Pertanian dan Ketahanan Pangan Kabupaten Kediri",
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
oauth2_optional = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

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
        default_admin = {"id": 1, "username": "admin", "password_hash": pwd_context.hash(DEFAULT_ADMIN_PASSWORD), "role": "super_admin"}
        AUTH_DIR.mkdir(parents=True, exist_ok=True)
        USERS_FILE.write_text(json.dumps([default_admin], indent=2), encoding="utf-8")
        return [default_admin]

    try:
        users = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        if not isinstance(users, list): raise ValueError("Format users.json tidak valid")
        return users
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=500, detail=f"Gagal membaca user: {error}")

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

def get_current_admin(user: dict = Depends(get_current_user)):
    if user.get("role") not in ["admin", "super_admin"]:
        raise HTTPException(status_code=403, detail="Akses hanya untuk admin.")
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
def register_user(user: UserCreate, token: Optional[str] = Depends(oauth2_optional)):
    with FILE_LOCK:
        users = read_users()
        if users:
            if not token: raise HTTPException(status_code=401, detail="Registrasi memerlukan admin.")
            current = user_from_token(token)
            if current["role"] not in ["admin", "super_admin"]:
                raise HTTPException(status_code=403, detail="Akses hanya admin.")

        username = user.username.strip()
        if not username or len(user.password) < 8:
            raise HTTPException(status_code=400, detail="Username wajib diisi dan password minimal 8 karakter.")
        if user.role not in ["admin", "super_admin", "user"]:
            raise HTTPException(status_code=400, detail="Role tidak valid.")
        if any(u["username"] == username for u in users):
            raise HTTPException(status_code=400, detail="Username sudah terdaftar.")

        role = "admin" if not users else user.role
        users.append({"id": max([u.get("id", 0) for u in users], default=0) + 1, "username": username, "password_hash": pwd_context.hash(user.password), "role": role})
        save_users(users)

    return {"message": "Registrasi berhasil.", "username": username, "role": role}


@app.post("/api/v1/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = next((u for u in read_users() if u["username"] == form_data.username), None)
    if not user or not pwd_context.verify(form_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Username atau password salah.")

    token = create_access_token({"sub": user["username"], "role": user["role"]})
    write_audit(user["username"], "Login", "Login berhasil")
    return {"access_token": token, "token_type": "bearer", "username": user["username"], "role": user["role"]}


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
def upload_tanaman_pangan(file: UploadFile = File(...), current_user: dict = Depends(get_current_admin)):
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

    DATA_DIR.mkdir(parents=True, exist_ok=True)
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
def get_audit_trail(user: dict = Depends(get_current_admin)):
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

    # --- top 5 komoditas & kecamatan
    top_komoditas, top_kecamatan = [], []
    if pr is not None and pr_kom and pr_val:
        s = pr.assign(_v=to_num(pr[pr_val])).groupby(pr_kom)["_v"].sum().sort_values(ascending=False)
        top_komoditas = [str(i) for i in s.head(5).index]
    if records and prod_col_kl:
        top_kecamatan = [r["kecamatan"] for r in sorted(records, key=lambda r: r["produksi_rata2_kg_per_tahun"] or 0, reverse=True)[:5]]
    elif pr is not None and pr_kec and pr_val:
        s = pr.assign(_v=to_num(pr[pr_val])).groupby(pr_kec)["_v"].sum().sort_values(ascending=False)
        top_kecamatan = [str(i) for i in s.head(5).index]

    laporan = {
        "klaster": {"filename": kl_path.name, "available": kl_path.exists(), "file_key": f"{prefix}_klaster"},
        "prediksi": {"filename": pr_path.name, "available": pr_path.exists(), "file_key": f"{prefix}_prediksi"},
    }

    return {
        "kategori": prefix,
        "statistik": stats,
        "klaster": records,
        "backtest": extract_backtest(pr),
        "laporan": laporan,
        "top_komoditas": top_komoditas,
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


@app.get("/api/v1/model/forecasting")
def frontend_forecasting():
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