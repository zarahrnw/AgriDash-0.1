# AgriDash API

**Version:** 0.1.0  
**Project:** AgriDash  
**Repository:** [AgriDash-0.1](https://github.com/zarahrnw/AgriDash-0.1)

AgriDash merupakan sistem informasi pertanian dan ketahanan pangan untuk Kabupaten Kediri yang dikembangkan sebagai bagian dari program hilirisasi SINERGI. Sistem ini dirancang untuk membantu Dinas Ketahanan Pangan dan Pertanian (DKPP/Dispertabun) dalam memantau produksi pertanian, harga pangan, kondisi cuaca, serta ketahanan pangan secara terintegrasi.

AgriDash menyediakan dukungan analisis data, pemodelan prediktif, dan sistem peringatan dini (*Early Warning System*) untuk mendukung proses pemantauan dan pengambilan keputusan berbasis data.

## Fitur Utama

1. **Dashboard Eksekutif** — Menampilkan indikator kinerja utama (KPI), peringatan, tren, dan *insight* terkait sektor pertanian dan ketahanan pangan.
2. **Monitoring Wilayah** — Menyajikan data produksi, luas panen, dan produktivitas pertanian berdasarkan kecamatan.
3. **Monitoring Harga Pangan** — Mengintegrasikan API Badan Pangan Nasional (Bapanas) untuk memperoleh informasi harga pangan wilayah Jawa Timur.
4. **Informasi Cuaca dan Risiko** — Mengintegrasikan data cuaca dari API BMKG secara *real-time* serta menyediakan analisis risiko pertanian.
5. **Prediksi dan Early Warning System** — Menyediakan layanan simulasi prediksi produksi dan informasi peringatan dini.
6. **Analitik Machine Learning** — Menerapkan K-Means, Agglomerative Clustering, PCA (*Principal Component Analysis*), *Forecasting*, dan rekomendasi komoditas.
7. **Monitoring Ketahanan Pangan** — Mendukung pemantauan indeks dan status ketahanan pangan.
8. **Data Center** — Menyediakan fitur unggah data CSV/Excel dengan autentikasi berbasis JWT.

## Tech Stack

| Komponen | Teknologi |
|---|---|
| Backend | FastAPI, Python 3.11 |
| Database | Supabase (PostgreSQL) |
| ORM | SQLAlchemy |
| Authentication | OAuth2, JWT |
| Password Hashing | Passlib, Bcrypt |
| Data Processing | Pandas, NumPy |
| Machine Learning | Scikit-learn, StandardScaler, PCA |
| External API | BMKG, API Indonesia |
| Testing Framework | Pytest |
| Testing Database | SQLite (In-Memory) |

## Struktur Folder

```text
AgriDash-0.1/
├── api/            # Backend API dan endpoint (main.py)
├── app/            # Frontend dan antarmuka pengguna
├── data/           # Dataset raw, derived, dan external
├── docs/           # Dokumentasi proyek
├── lib/            # Shared library
├── models/         # Model machine learning dan konfigurasi
├── notebooks/      # Eksplorasi data dan eksperimen model
├── output/         # Hasil pemodelan ML (clustering, PCA, dll.)
├── outputs/        # Laporan analisis
├── public/         # Aset statis frontend
├── src/            # Pipeline ETL, ML, dan utilitas bersama
└── tests/          # Unit test dan integration test (Pytest)
```

## Pembagian Tugas Tim

| Role | Penanggung Jawab | Fokus Pengembangan |
|---|---|---|
| Data Engineer | Zarah | `data/`, `src/etl/` |
| ML Engineer | Zerlina | `models/`, `src/ml/`, `notebooks/`, `output/` |
| Backend/API Developer | Linda | `api/`, `src/utils/` |
| Frontend/UI Developer | Dhini | `app/`, `public/` |

## Persyaratan Sistem

Sebelum menjalankan proyek, pastikan perangkat telah memiliki:

- Python 3.11
- Git
- Akses ke database Supabase PostgreSQL
- Seluruh dependency yang tercantum dalam `requirements.txt`

## Instalasi dan Konfigurasi Lokal

### 1. Clone Repository

```bash
git clone https://github.com/zarahrnw/AgriDash-0.1.git
cd AgriDash-0.1
```

### 2. Membuat Virtual Environment

**Windows (PowerShell):**

```powershell
python -m venv venv
venv\Scripts\activate
```

**macOS/Linux:**

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Instalasi Dependencies

```bash
python -m pip install -r requirements.txt
```

### 4. Konfigurasi Environment Variables

Buat file `.env` pada direktori utama proyek dengan konfigurasi berikut:

```env
DATABASE_URL="postgresql://..."
SECRET_KEY="ganti_dengan_kunci_rahasia_panjang"
ALGORITHM="HS256"
API_INDONESIA_KEY="aip_live_xxxxxxxxxxxxxxxxxxxxx"
```

**Keterangan:**

| Variabel | Deskripsi |
|---|---|
| `DATABASE_URL` | Connection string database Supabase PostgreSQL. Disarankan menggunakan Session Pooler. |
| `SECRET_KEY` | Kunci rahasia untuk autentikasi JWT. |
| `ALGORITHM` | Algoritma yang digunakan untuk proses signing JWT. |
| `API_INDONESIA_KEY` | API Key dari [API Indonesia](https://apiindonesia.id) untuk mengakses data harga pangan. |

**Catatan keamanan:**
- Jangan mengunggah file `.env` yang berisi kredensial asli ke GitHub.
- Pastikan `.env` tercantum dalam `.gitignore`.
- Gunakan `.env.example` sebagai template konfigurasi tanpa kredensial asli.

### 5. Menjalankan Backend

```bash
uvicorn api.main:app --reload
```

Backend dapat diakses melalui:

```text
http://127.0.0.1:8000
```

### 6. Menjalankan Automated Testing

```bash
python -m pytest -v
```

## Dokumentasi API

AgriDash menggunakan FastAPI untuk menyediakan dokumentasi endpoint secara otomatis.

| Dokumentasi | URL |
|---|---|
| Swagger UI | `http://127.0.0.1:8000/docs` |
| ReDoc | `http://127.0.0.1:8000/redoc` |

### Endpoint Utama

| Modul | Method | Endpoint | Kegunaan |
|---|---|---|---|
| Autentikasi | POST | `/api/v1/auth/register` | Registrasi pengguna |
| Autentikasi | POST | `/api/v1/auth/login` | Login pengguna |
| Tanaman Pangan | GET | `/api/v1/tanaman-pangan` | Mengakses data tanaman pangan |
| Cuaca dan EWS | GET | `/api/v1/ews-cuaca/{kode_wilayah}` | Informasi cuaca dan peringatan dini |
| Data Center | POST | `/api/v1/tanaman-pangan/upload` | Unggah data dengan token Admin |
| Harga Pangan | GET | `/api/v1/harga-pangan` | Mengakses data harga pangan Bapanas |
| Prediksi | POST | `/api/v1/prediksi` | Simulasi prediksi produksi |
| ML Clustering | GET | `/api/v1/model/clustering` | Mengakses hasil analisis clustering |
| ML PCA | GET | `/api/v1/model/pca` | Mengakses hasil analisis PCA |
| ML Forecasting | GET | `/api/v1/model/forecasting` | Mengakses hasil analisis time series |
| Dashboard | GET | `/api/v1/dashboard-eksekutif` | Mengakses ringkasan data dashboard |

## Sumber Data

| Data | Sumber |
|---|---|
| Hortikultura, perkebunan, peternakan, dan perikanan | BPS Kabupaten Kediri |
| Tanaman pangan | Estimasi berbasis proporsi luas sawah per kecamatan |
| Cuaca | API BMKG |
| Harga pangan | API Indonesia (Badan Pangan Nasional) |
| Ketahanan pangan | Badan Pangan Nasional (Bapanas) |

## Status Pengembangan

**Versi:** 0.1.0  
**Status:** Dalam pengembangan aktif.

Pengembangan mencakup integrasi Backend API, database, pengolahan data, serta implementasi model Machine Learning.

## Kontributor

| Nama | Peran |
|---|---|
| Zarah | Data Engineer |
| Zerlina | ML Engineer |
| Linda | Backend/API Developer |
| Dhini | Frontend/UI Developer |

---

AgriDash dikembangkan sebagai bagian dari program hilirisasi SINERGI untuk mendukung analisis data pertanian dan ketahanan pangan Kabupaten Kediri.