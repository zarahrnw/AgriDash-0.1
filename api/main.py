import os
import io
import pandas as pd
from typing import Optional
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import requests # <--- Tambahkan ini

# Library Autentikasi
from passlib.context import CryptContext
from jose import JWTError, jwt
from pydantic import BaseModel

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

# Koneksi Database
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

# Konfigurasi Keamanan
SECRET_KEY = os.getenv("SECRET_KEY", "fallback_secret")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # Token berlaku 1 hari

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# --- SCHEMA UNTUK USER ---
class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "admin"

# --- FUNGSI BANTUAN ---
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# --- SATPAM (DEPENDENCY): Memvalidasi Token ---
def get_current_admin(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token tidak valid atau sudah kedaluwarsa",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM users WHERE username = :username"), {"username": username}).fetchone()
        if not result:
            raise credentials_exception
    return dict(result._mapping)


# ==========================================
# ENDPOINT AUTENTIKASI
# ==========================================
@app.post("/api/v1/auth/register", tags=["Authentication"])
def register_user(user: UserCreate):
    """Mendaftarkan user/admin baru (Hash password otomatis)."""
    hashed_password = get_password_hash(user.password)
    try:
        with engine.begin() as conn:
            # Cek apakah username sudah dipakai
            existing = conn.execute(text("SELECT id FROM users WHERE username = :username"), {"username": user.username}).fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="Username sudah terdaftar")
                
            conn.execute(text("""
                INSERT INTO users (username, password_hash, role)
                VALUES (:username, :password_hash, :role)
            """), {"username": user.username, "password_hash": hashed_password, "role": user.role})
        return {"status": "success", "message": "User berhasil didaftarkan."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/auth/login", tags=["Authentication"])
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    """Login untuk mendapatkan Token JWT (Kunci akses)."""
    try:
        with engine.connect() as conn:
            user = conn.execute(text("SELECT * FROM users WHERE username = :username"), {"username": form_data.username}).fetchone()
            
            if not user or not verify_password(form_data.password, user.password_hash):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Username atau password salah",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            
            access_token = create_access_token(data={"sub": user.username, "role": user.role})
            return {"access_token": access_token, "token_type": "bearer"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health", tags=["System"])
def health_check():
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
    try:
        with engine.connect() as conn:
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
    try:
        with engine.connect() as conn:
            query = text("""
                SELECT kecamatan, SUM(produksi_ton) as total_produksi, SUM(luas_panen_ha) as total_luas
                FROM tanaman_pangan GROUP BY kecamatan ORDER BY total_produksi DESC
            """)
            result = conn.execute(query)
            data = [{"kecamatan": row.kecamatan, "produksi_ton": round(row.total_produksi or 0, 2), "luas_panen_ha": round(row.total_luas or 0, 2)} for row in result]
        return {"total_kecamatan": len(data), "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# ENDPOINT DATA TANAMAN PANGAN (Dari Supabase)
# ==========================================
@app.get("/api/v1/tanaman-pangan", tags=["Tanaman Pangan"])
def get_tanaman_pangan(
    kecamatan: Optional[str] = Query(default=None),
    tanaman: Optional[str] = Query(default=None),
    limit: int = Query(default=50),
    sort_by: str = Query(default="produksi_ton"),
):
    try:
        with engine.connect() as conn:
            query_str = "SELECT * FROM tanaman_pangan WHERE 1=1"
            params = {}
            if kecamatan:
                query_str += " AND LOWER(kecamatan) = LOWER(:kecamatan)"
                params["kecamatan"] = kecamatan
            if tanaman:
                query_str += " AND LOWER(tanaman) = LOWER(:tanaman)"
                params["tanaman"] = tanaman
            
            if sort_by not in ["produksi_ton", "luas_panen_ha", "produktivitas_kuintal_ha"]:
                sort_by = "produksi_ton"

            query_str += f" ORDER BY {sort_by} DESC LIMIT :limit"
            params["limit"] = limit
            result = conn.execute(text(query_str), params)
            rows = [dict(row._mapping) for row in result]
        return {"total_data_ditampilkan": len(rows), "filters": {"kecamatan": kecamatan, "tanaman": tanaman, "sort_by": sort_by}, "data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# ENDPOINT RINGKASAN DASHBOARD (Dari Supabase)
# ==========================================
@app.get("/api/v1/tanaman-pangan/ringkasan", tags=["Tanaman Pangan"])
def get_ringkasan_tanaman_pangan():
    try:
        with engine.connect() as conn:
            result_sum = conn.execute(text("SELECT SUM(produksi_ton) as total_prod, SUM(luas_panen_ha) as total_luas FROM tanaman_pangan")).fetchone()
            result_count = conn.execute(text("SELECT COUNT(DISTINCT kecamatan) as jml_kec, COUNT(DISTINCT tanaman) as jml_tanaman FROM tanaman_pangan")).fetchone()
        return {
            "total_produksi_ton": round(result_sum.total_prod or 0, 2),
            "total_luas_panen_ha": round(result_sum.total_luas or 0, 2),
            "jumlah_kecamatan": result_count.jml_kec,
            "jumlah_jenis_tanaman": result_count.jml_tanaman,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# FITUR DATA CENTER: UPLOAD CSV (PROTECTED)
# ==========================================
@app.post("/api/v1/tanaman-pangan/upload", tags=["Data Center"])
async def upload_tanaman_pangan(
    file: UploadFile = File(...),
    current_admin: dict = Depends(get_current_admin) # <--- INI SATPAMNYA
):
    """
    Mengunggah file CSV/Excel. Endpoint ini dilindungi, butuh Token Login.
    """
    if not file.filename.endswith(('.csv', '.xlsx')):
        raise HTTPException(status_code=400, detail="Format file harus CSV atau Excel (.xlsx)")

    try:
        contents = await file.read()
        df = pd.read_csv(io.BytesIO(contents)) if file.filename.endswith('.csv') else pd.read_excel(io.BytesIO(contents))

        required_columns = ['kecamatan', 'tanaman', 'luas_panen_ha', 'produksi_ton', 'produktivitas_kuintal_ha']
        for col in required_columns:
            if col not in df.columns:
                raise HTTPException(status_code=400, detail=f"Kolom '{col}' tidak ditemukan.")

        df = df.replace({pd.NA: None, float('nan'): None})
        data_to_insert = df.to_dict(orient='records')

        query = text("""
            INSERT INTO tanaman_pangan (kecamatan, tanaman, luas_panen_ha, produksi_ton, produktivitas_kuintal_ha)
            VALUES (:kecamatan, :tanaman, :luas_panen_ha, :produksi_ton, :produktivitas_kuintal_ha)
        """)
        
        with engine.begin() as conn:
            conn.execute(text("TRUNCATE TABLE tanaman_pangan RESTART IDENTITY"))
            conn.execute(query, data_to_insert)

        return {
            "status": "success",
            "message": f"Berhasil mengganti data lama dengan {len(df)} baris data baru secara instan oleh Admin: {current_admin['username']}",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal memproses file: {str(e)}")

# ==========================================
# FITUR INTEGRASI API CUACA BMKG
# ==========================================
@app.get("/api/v1/cuaca/{kode_kecamatan}", tags=["Cuaca & Risiko"])
def get_cuaca_bmkg(kode_kecamatan: str):
    """
    Mengambil data prakiraan cuaca dari API BMKG.
    Menggunakan kode kecamatan (contoh: 3506010 untuk Mojo).
    """
    try:
        # 1. Tembak API BMKG
        url = f"https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode_kecamatan}"
        response = requests.get(url, timeout=10)
        
        # Cek jika respons dari BMKG error
        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="Data cuaca untuk kode wilayah tersebut tidak ditemukan di BMKG.")
            
        data_bmkg = response.json()

        # 2. Validasi jika data kosong
        if not data_bmkg.get("data"):
            raise HTTPException(status_code=404, detail="Data cuaca kosong.")

        # 3. Ambil data prakiraan pertama (hari ini)
        cuaca_hari_ini = data_bmkg["data"][0]["cuaca"][0]
        
        # 4. Ambil 3 parameter utama (suhu, kelembapan, cuaca)
        # Data BMKG biasanya merilis beberapa jam. Kita ambil jam pertama.
        prakiraan_pertama = cuaca_hari_ini[0] if cuaca_hari_ini else {}

        return {
            "status": "success",
            "lokasi": data_bmkg["data"][0]["lokasi"],
            "prakiraan_terdekat": {
                "waktu_lokal": prakiraan_pertama.get("local_datetime"),
                "suhu_celsius": prakiraan_pertama.get("t"),
                "kelembapan_persen": prakiraan_pertama.get("hu"),
                "curah_hujan_mm": prakiraan_pertama.get("tp"),
                "kondisi_cuaca": prakiraan_pertama.get("weather_desc"),
                "kecepatan_angin_km_jam": prakiraan_pertama.get("ws")
            }
        }

    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Koneksi ke server BMKG timeout.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# FITUR EARLY WARNING SYSTEM (EWS) CUACA
# ==========================================
@app.get("/api/v1/ews-cuaca/{kode_kecamatan}", tags=["Cuaca & Risiko"])
def get_ews_cuaca(kode_kecamatan: str):
    """
    Menganalisis data cuaca BMKG dan memberikan status peringatan dini (EWS) untuk pertanian.
    """
    try:
        # 1. Ambil data dari API BMKG (sama seperti endpoint sebelumnya)
        url = f"https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode_kecamatan}"
        response = requests.get(url, timeout=10)
        
        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="Data cuaca untuk kode wilayah tersebut tidak ditemukan.")
            
        data_bmkg = response.json()
        if not data_bmkg.get("data"):
            raise HTTPException(status_code=404, detail="Data cuaca kosong.")

        cuaca_hari_ini = data_bmkg["data"][0]["cuaca"][0]
        prakiraan = cuaca_hari_ini[0] if cuaca_hari_ini else {}

        # 2. Ekstrak variabel cuaca
        suhu = prakiraan.get("t", 0)
        kelembapan = prakiraan.get("hu", 0)
        curah_hujan = prakiraan.get("tp", 0)
        kondisi = prakiraan.get("weather_desc", "")

        # 3. LOGIKA EARLY WARNING SYSTEM (EWS)
        status_ews = "AMAN"
        pesan_ews = "Kondisi cuaca normal untuk aktivitas pertanian."
        rekomendasi = "Lanjutkan aktivitas pertanian seperti biasa."

        # Skenario 1: Hujan Ekstrem (Risiko Banjir / Gagal Panen)
        if curah_hujan > 50.0:
            status_ews = "BAHAYA"
            pesan_ews = f"Curah hujan sangat tinggi ({curah_hujan} mm)."
            rekomendasi = "Tunda pemupukan dan segera lakukan pengecekan drainase untuk mencegah genangan."

        # Skenario 2: Kelembapan Tinggi + Hujan (Risiko Jamur / Hama)
        elif kelembapan > 80 and curah_hujan > 10.0:
            status_ews = "WASPADA"
            pesan_ews = f"Kelembapan tinggi ({kelembapan}%) disertai hujan."
            rekomendasi = "Waspadai serangan jamur dan hama. Pastikan sirkulasi udara tanaman baik."

        # Skenario 3: Suhu Sangat Panas (Risiko Kekeringan)
        elif suhu > 34.0:
            status_ews = "WASPADA"
            pesan_ews = f"Suhu udara sangat panas ({suhu}°C)."
            rekomendasi = "Lakukan penyiraman tambahan pada pagi/sore hari untuk menjaga kelembapan tanah."

        # 4. Kembalikan respons
        return {
            "status_sistem": "success",
            "lokasi": {
                "kecamatan": data_bmkg["data"][0]["lokasi"].get("kecamatan"),
                "desa": data_bmkg["data"][0]["lokasi"].get("desa")
            },
            "parameter_cuaca": {
                "suhu": suhu,
                "kelembapan": kelembapan,
                "curah_hujan": curah_hujan,
                "kondisi": kondisi
            },
            "analisis_ews": {
                "status": status_ews,
                "pesan": pesan_ews,
                "rekomendasi": rekomendasi
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))