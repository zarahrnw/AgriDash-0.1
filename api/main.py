
import os
import io
import random
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import requests
import numpy as np
import pandas as pd

from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    UploadFile,
    File,
    Depends,
    status
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from fastapi.security import (
    OAuth2PasswordBearer,
    OAuth2PasswordRequestForm
)

from pydantic import BaseModel
from sqlalchemy import create_engine, text

from passlib.context import CryptContext
from jose import JWTError, jwt

from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA


# =========================================================
# 1. ENVIRONMENT & KONFIGURASI
# =========================================================

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

SECRET_KEY = os.getenv("SECRET_KEY", "agr idash-secret-key-change-this")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")
)

API_INDONESIA_KEY = os.getenv("API_INDONESIA_KEY")

BMKG_BASE_URL = (
    "https://api.bmkg.go.id/publik/prakiraan-cuaca"
)

# Lokasi root project.
BASE_DIR = Path(__file__).resolve().parent

# Mendukung struktur:
# AgriDash/
#   backend/main.py
#   output/
#   outputs/
if (
    not (BASE_DIR / "output").exists()
    and (BASE_DIR.parent / "output").exists()
):
    BASE_DIR = BASE_DIR.parent

DATA_DIR = BASE_DIR / "output" / "tanaman_pangan"
REPORT_DIR = BASE_DIR / "outputs" / "reports"

CSV_FILES = {
    "clustering": DATA_DIR / "output_clustering_pangan.csv",
    "rekomendasi": DATA_DIR / "output_rekomendasi_pangan.csv",
    "timeseries": DATA_DIR / "output_timeseries_pangan.csv",
    "model_comparison": DATA_DIR / "output_model_comparison.csv",
}


# =========================================================
# 2. FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="AgriDash API",
    description="API data pertanian dan ketahanan pangan Kabupaten Kediri",
    version="0.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# 3. DATABASE CONFIGURATION
# =========================================================

def get_engine():
    if not DATABASE_URL:
        raise HTTPException(
            status_code=500,
            detail="DATABASE_URL belum dikonfigurasi."
        )

    return create_engine(
        DATABASE_URL,
        pool_pre_ping=True
    )


# =========================================================
# 4. AUTHENTICATION & JWT
# =========================================================

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login"
)


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "admin"


class PrediksiRequest(BaseModel):
    kecamatan: str
    tanaman: str
    bulan_ke_depan: int = 1


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(
        plain_password,
        hashed_password
    )


def get_password_hash(password):
    return pwd_context.hash(password)


def create_access_token(data: dict):
    to_encode = data.copy()

    expire = datetime.utcnow() + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    to_encode.update({
        "exp": expire
    })

    return jwt.encode(
        to_encode,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token tidak valid atau sudah kedaluwarsa.",
        headers={"WWW-Authenticate": "Bearer"}
    )

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        username = payload.get("sub")

        if username is None:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    engine = get_engine()

    with engine.connect() as conn:
        result = conn.execute(
            text("""
                SELECT id, username, role
                FROM users
                WHERE username = :username
            """),
            {"username": username}
        ).mappings().first()

    if not result:
        raise credentials_exception

    return dict(result)


def get_current_admin(
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") not in ["admin", "super_admin"]:
        raise HTTPException(
            status_code=403,
            detail="Akses hanya untuk admin."
        )

    return current_user


# =========================================================
# 5. PYDANTIC MODELS
# =========================================================

# UserCreate dan PrediksiRequest didefinisikan di atas.


# =========================================================
# 6. HELPER CSV
# =========================================================

def read_agri_csv(file_path: Path):
    """
    Membaca file CSV lokal.
    File tidak perlu diunggah ulang melalui frontend.
    """

    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File tidak ditemukan: {file_path.name}"
        )

    try:
        df = pd.read_csv(
            file_path,
            encoding="utf-8-sig"
        )

        return df

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Gagal membaca {file_path.name}: {str(error)}"
        )


def dataframe_records(df: pd.DataFrame):
    """
    Mengubah DataFrame menjadi format JSON.
    Nilai NaN diubah menjadi None.
    """

    clean_df = df.astype(object).where(
        pd.notna(df),
        None
    )

    return clean_df.to_dict(
        orient="records"
    )


def find_column(df: pd.DataFrame, candidates: list):
    """
    Mencari nama kolom berdasarkan beberapa kemungkinan.
    """

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


def safe_float(value):
    try:
        if pd.isna(value):
            return None

        return float(value)

    except (TypeError, ValueError):
        return None


def get_cluster_column(df):
    return find_column(
        df,
        [
            "cluster",
            "cluster_label",
            "klaster",
            "label_cluster",
            "cluster_kmeans"
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


# =========================================================
# 7. HEALTH CHECK
# =========================================================

@app.get("/health")
def health_check():

    try:
        engine = get_engine()

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))

        return {
            "status": "healthy",
            "database": "connected",
            "timestamp": datetime.now().isoformat()
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(error)}"
        )


# =========================================================
# 8. AUTH REGISTER
# =========================================================

@app.post("/api/v1/auth/register")
def register_user(user: UserCreate):

    engine = get_engine()

    hashed_password = get_password_hash(
        user.password
    )

    try:
        with engine.begin() as conn:

            existing = conn.execute(
                text("""
                    SELECT id
                    FROM users
                    WHERE username = :username
                """),
                {"username": user.username}
            ).first()

            if existing:
                raise HTTPException(
                    status_code=400,
                    detail="Username sudah digunakan."
                )

            conn.execute(
                text("""
                    INSERT INTO users (
                        username,
                        password,
                        role
                    )
                    VALUES (
                        :username,
                        :password,
                        :role
                    )
                """),
                {
                    "username": user.username,
                    "password": hashed_password,
                    "role": user.role
                }
            )

        return {
            "message": "Registrasi berhasil.",
            "username": user.username
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


# =========================================================
# 9. AUTH LOGIN
# =========================================================

@app.post("/api/v1/auth/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends()
):

    engine = get_engine()

    with engine.connect() as conn:

        user = conn.execute(
            text("""
                SELECT id, username, password, role
                FROM users
                WHERE username = :username
            """),
            {"username": form_data.username}
        ).mappings().first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Username atau password salah."
        )

    if not verify_password(
        form_data.password,
        user["password"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Username atau password salah."
        )

    access_token = create_access_token({
        "sub": user["username"],
        "role": user["role"]
    })

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"]
    }


# =========================================================
# 10. MASTER KECAMATAN
# =========================================================

@app.get("/api/v1/kecamatan")
def get_kecamatan():

    engine = get_engine()

    with engine.connect() as conn:

        result = conn.execute(
            text("""
                SELECT DISTINCT kecamatan
                FROM master_kecamatan
                ORDER BY kecamatan
            """)
        ).mappings().all()

    return {
        "total": len(result),
        "data": [dict(row) for row in result]
    }


# =========================================================
# 11. REKAP KECAMATAN
# =========================================================

@app.get("/api/v1/rekap-kecamatan")
def get_rekap_kecamatan():

    engine = get_engine()

    with engine.connect() as conn:

        result = conn.execute(
            text("""
                SELECT
                    kecamatan,
                    SUM(luas_panen_ha) AS total_luas_panen,
                    SUM(produksi_ton) AS total_produksi,
                    AVG(produktivitas_kuintal_ha) AS rata_produktivitas
                FROM tanaman_pangan
                GROUP BY kecamatan
                ORDER BY total_produksi DESC
            """)
        ).mappings().all()

    return {
        "total": len(result),
        "data": [dict(row) for row in result]
    }


# =========================================================
# 12. DATA TANAMAN PANGAN
# =========================================================

@app.get("/api/v1/tanaman-pangan")
def get_tanaman_pangan(
    kecamatan: Optional[str] = None,
    tanaman: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    sort_by: str = Query("produksi_ton")
):

    allowed_sort = [
        "produksi_ton",
        "luas_panen_ha",
        "produktivitas_kuintal_ha"
    ]

    if sort_by not in allowed_sort:
        raise HTTPException(
            status_code=400,
            detail="Kolom pengurutan tidak diizinkan."
        )

    query = """
        SELECT *
        FROM tanaman_pangan
        WHERE
            (:kecamatan IS NULL OR kecamatan = :kecamatan)
            AND
            (:tanaman IS NULL OR tanaman = :tanaman)
        ORDER BY
    """

    query += sort_by + " DESC LIMIT :limit"

    engine = get_engine()

    with engine.connect() as conn:

        result = conn.execute(
            text(query),
            {
                "kecamatan": kecamatan,
                "tanaman": tanaman,
                "limit": limit
            }
        ).mappings().all()

    return {
        "total": len(result),
        "data": [dict(row) for row in result]
    }


# =========================================================
# 13. RINGKASAN TANAMAN PANGAN
# =========================================================

@app.get("/api/v1/tanaman-pangan/ringkasan")
def get_ringkasan_tanaman():

    engine = get_engine()

    with engine.connect() as conn:

        result = conn.execute(
            text("""
                SELECT
                    COUNT(*) AS total_data,
                    COUNT(DISTINCT kecamatan) AS total_kecamatan,
                    COUNT(DISTINCT tanaman) AS total_komoditas,
                    SUM(luas_panen_ha) AS total_luas_panen,
                    SUM(produksi_ton) AS total_produksi,
                    AVG(produktivitas_kuintal_ha) AS rata_produktivitas
                FROM tanaman_pangan
            """)
        ).mappings().first()

    return dict(result) if result else {}


# =========================================================
# 14. UPLOAD DATA TANAMAN PANGAN
# =========================================================

@app.post("/api/v1/tanaman-pangan/upload")
def upload_tanaman_pangan(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_admin)
):

    filename = file.filename.lower()

    if not filename.endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Format file harus CSV atau Excel."
        )

    try:
        content = file.file.read()

        if filename.endswith(".csv"):
            df = pd.read_csv(
                io.BytesIO(content),
                encoding="utf-8-sig"
            )
        else:
            df = pd.read_excel(
                io.BytesIO(content)
            )

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Gagal membaca file: {str(error)}"
        )

    required_columns = [
        "kecamatan",
        "tanaman",
        "luas_panen_ha",
        "produksi_ton",
        "produktivitas_kuintal_ha"
    ]

    missing = [
        col for col in required_columns
        if col not in df.columns
    ]

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Kolom tidak ditemukan: {missing}"
        )

    df = df[required_columns].copy()

    df = df.replace({np.nan: None})

    engine = get_engine()

    try:
        with engine.begin() as conn:

            conn.execute(
                text("TRUNCATE TABLE tanaman_pangan")
            )

            for _, row in df.iterrows():

                conn.execute(
                    text("""
                        INSERT INTO tanaman_pangan (
                            kecamatan,
                            tanaman,
                            luas_panen_ha,
                            produksi_ton,
                            produktivitas_kuintal_ha
                        )
                        VALUES (
                            :kecamatan,
                            :tanaman,
                            :luas_panen_ha,
                            :produksi_ton,
                            :produktivitas_kuintal_ha
                        )
                    """),
                    {
                        "kecamatan": row["kecamatan"],
                        "tanaman": row["tanaman"],
                        "luas_panen_ha": row["luas_panen_ha"],
                        "produksi_ton": row["produksi_ton"],
                        "produktivitas_kuintal_ha":
                            row["produktivitas_kuintal_ha"]
                    }
                )

            conn.execute(
                text("""
                    INSERT INTO audit_trail (
                        username,
                        aktivitas,
                        waktu
                    )
                    VALUES (
                        :username,
                        :aktivitas,
                        :waktu
                    )
                """),
                {
                    "username": current_user["username"],
                    "aktivitas": (
                        f"Upload data tanaman pangan: {file.filename}"
                    ),
                    "waktu": datetime.now()
                }
            )

        return {
            "message": "Upload berhasil.",
            "total_data": len(df)
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Gagal menyimpan data: {str(error)}"
        )


# =========================================================
# 15. CUACA BMKG
# =========================================================

def fetch_bmkg(kode_kecamatan: str):

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
            detail=f"Gagal mengambil data BMKG: {str(error)}"
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

    current = forecasts[0]

    return {
        "lokasi": data.get("lokasi", {}),
        "cuaca": current
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

    rainfall = safe_float(
        current.get("tp")
    ) or 0

    humidity = safe_float(
        current.get("hu")
    ) or 0

    temperature = safe_float(
        current.get("t")
    ) or 0

    status_ews = "AMAN"
    message = "Kondisi cuaca relatif aman."

    if rainfall > 50:
        status_ews = "BAHAYA"
        message = "Curah hujan tinggi. Waspadai potensi genangan."

    elif humidity > 80 and rainfall > 10:
        status_ews = "WASPADA"
        message = "Kelembapan dan curah hujan cukup tinggi."

    elif temperature > 34:
        status_ews = "WASPADA"
        message = "Suhu tinggi. Perhatikan kebutuhan air tanaman."

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
# 17. PREDIKSI PRODUKSI
# =========================================================

@app.post("/api/v1/prediksi")
def prediksi_produksi(request: PrediksiRequest):

    if request.bulan_ke_depan < 1:
        raise HTTPException(
            status_code=400,
            detail="Bulan prediksi minimal 1."
        )

    engine = get_engine()

    with engine.connect() as conn:

        result = conn.execute(
            text("""
                SELECT
                    SUM(produksi_ton) AS produksi
                FROM tanaman_pangan
                WHERE kecamatan = :kecamatan
                AND tanaman = :tanaman
            """),
            {
                "kecamatan": request.kecamatan,
                "tanaman": request.tanaman
            }
        ).mappings().first()

    if not result or result["produksi"] is None:
        raise HTTPException(
            status_code=404,
            detail="Data produksi tidak ditemukan."
        )

    produksi_awal = float(result["produksi"])

    # Simulasi lama dipertahankan.
    # Endpoint ini bukan hasil model forecasting CSV.
    faktor_pertumbuhan = (
        1 + (0.05 * request.bulan_ke_depan)
    )

    fluktuasi = random.uniform(-0.02, 0.02)

    hasil_prediksi = (
        produksi_awal
        * faktor_pertumbuhan
        * (1 + fluktuasi)
    )

    return {
        "kecamatan": request.kecamatan,
        "tanaman": request.tanaman,
        "produksi_awal": round(produksi_awal, 2),
        "bulan_ke_depan": request.bulan_ke_depan,
        "prediksi_produksi": round(hasil_prediksi, 2),
        "keterangan": "Simulasi backend, bukan hasil model ML."
    }


# =========================================================
# 18. HARGA PANGAN
# =========================================================

@app.get("/api/v1/harga-pangan")
def get_harga_pangan():

    if not API_INDONESIA_KEY:
        raise HTTPException(
            status_code=503,
            detail="API_INDONESIA_KEY belum dikonfigurasi."
        )

    url = (
        "https://use.apiindonesia.id/api/v1/"
        "harga-pangan/harga"
    )

    headers = {
        "x-api-key": API_INDONESIA_KEY
    }

    params = {
        "province": "Jawa Timur",
        "level": "consumer"
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
            detail=f"Gagal mengambil harga pangan: {str(error)}"
        )


# =========================================================
# 19. AUDIT TRAIL
# =========================================================

@app.get("/api/v1/audit-trail")
def get_audit_trail(
    current_user: dict = Depends(get_current_admin)
):

    engine = get_engine()

    with engine.connect() as conn:

        result = conn.execute(
            text("""
                SELECT *
                FROM audit_trail
                ORDER BY waktu DESC
                LIMIT 50
            """)
        ).mappings().all()

    return {
        "total": len(result),
        "data": [dict(row) for row in result]
    }


# =========================================================
# 20. DASHBOARD EKSEKUTIF
# =========================================================

@app.get("/api/v1/dashboard-eksekutif")
def dashboard_eksekutif():

    engine = get_engine()

    with engine.connect() as conn:

        summary = conn.execute(
            text("""
                SELECT
                    COUNT(*) AS total_data,
                    COUNT(DISTINCT kecamatan) AS total_kecamatan,
                    COUNT(DISTINCT tanaman) AS total_komoditas,
                    SUM(luas_panen_ha) AS total_luas_panen,
                    SUM(produksi_ton) AS total_produksi,
                    AVG(produktivitas_kuintal_ha) AS rata_produktivitas
                FROM tanaman_pangan
            """)
        ).mappings().first()

        top_kecamatan = conn.execute(
            text("""
                SELECT
                    kecamatan,
                    SUM(produksi_ton) AS total_produksi
                FROM tanaman_pangan
                GROUP BY kecamatan
                ORDER BY total_produksi DESC
                LIMIT 5
            """)
        ).mappings().all()

    return {
        "ringkasan": dict(summary) if summary else {},
        "top_kecamatan": [
            dict(row) for row in top_kecamatan
        ]
    }


# =========================================================
# 21. HASIL CLUSTERING
# =========================================================

@app.get("/api/v1/model/clustering")
def get_clustering():

    df = read_agri_csv(
        CSV_FILES["clustering"]
    )

    kecamatan_col = get_kecamatan_column(df)
    cluster_col = get_cluster_column(df)

    return {
        "total_data": len(df),
        "columns": list(df.columns),
        "kecamatan_column": kecamatan_col,
        "cluster_column": cluster_col,
        "data": dataframe_records(df)
    }


# =========================================================
# 22. PCA CLUSTERING
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

    # Hilangkan kolom ID atau nomor urut.
    numeric_df = numeric_df.loc[
        :,
        [
            col for col in numeric_df.columns
            if str(col).lower() not in [
                "id",
                "no",
                "nomor"
            ]
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

    if numeric_df.shape[1] == 0:
        raise HTTPException(
            status_code=400,
            detail="Tidak ditemukan fitur numerik."
        )

    numeric_df = numeric_df.fillna(
        numeric_df.median()
    )

    if numeric_df.shape[1] < 2:
        raise HTTPException(
            status_code=400,
            detail="PCA membutuhkan minimal dua fitur numerik."
        )

    scaler = StandardScaler()

    scaled_data = scaler.fit_transform(
        numeric_df
    )

    pca = PCA(n_components=2)

    coordinates = pca.fit_transform(
        scaled_data
    )

    output = []

    for i, (x, y) in enumerate(coordinates):

        cluster = (
            str(df.iloc[i][cluster_col])
            if cluster_col and pd.notna(
                df.iloc[i][cluster_col]
            )
            else "Tidak diketahui"
        )

        kecamatan = (
            str(df.iloc[i][kecamatan_col])
            if kecamatan_col and pd.notna(
                df.iloc[i][kecamatan_col]
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
            round(float(value), 4)
            for value in pca.explained_variance_ratio_
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

    numeric_cols = list(
        df.select_dtypes(
            include=[np.number]
        ).columns
    )

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

        for file_path in sorted(
            folder.glob("*.csv")
        ):

            files.append({
                "nama": file_path.name,
                "kategori": category,
                "ukuran_kb": round(
                    file_path.stat().st_size / 1024,
                    2
                ),
                "endpoint": (
                    "/api/v1/data-center/download/"
                    + category.replace(" ", "_").lower()
                    + "/"
                    + file_path.name
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
    "/api/v1/data-center/download/{category}/{filename}"
)
def download_data_center(
    category: str,
    filename: str
):

    allowed_folders = {
        "dataset_pemodelan": DATA_DIR,
        "laporan_analisis": REPORT_DIR
    }

    folder = allowed_folders.get(category)

    if not folder:
        raise HTTPException(
            status_code=404,
            detail="Kategori tidak ditemukan."
        )

    file_path = (
        folder / filename
    ).resolve()

    if (
        file_path.parent != folder.resolve()
        or file_path.suffix.lower() != ".csv"
        or not file_path.exists()
    ):
        raise HTTPException(
            status_code=404,
            detail="File tidak ditemukan."
        )

    return FileResponse(
        path=file_path,
        filename=file_path.name,
        media_type="text/csv"
    )


# =========================================================
# 29. ROOT
# =========================================================

@app.get("/")
def root():

    return {
        "application": "AgriDash API",
        "version": "0.2.0",
        "description": (
            "API monitoring, pemodelan, dan "
            "ketahanan pangan Kabupaten Kediri."
        ),
        "documentation": "/docs",
        "status": "running"
    }
