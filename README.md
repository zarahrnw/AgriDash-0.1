# AgriDash API

**Version:** 0.1.0  
**Project:** AgriDash  
**Repository:** [AgriDash-0.1](https://github.com/zarahrnw/AgriDash-0.1)

AgriDash merupakan sistem informasi pertanian dan ketahanan pangan untuk Kabupaten Kediri yang dikembangkan sebagai bagian dari program hilirisasi SINERGI. Sistem ini dirancang untuk membantu Dinas Ketahanan Pangan dan Pertanian (DKPP/Dispertabun) memantau produksi pertanian, harga pangan, kondisi cuaca, dan ketahanan pangan secara terintegrasi.

AgriDash menyediakan dukungan analisis data, prediksi, serta sistem peringatan dini (*Early Warning System*) untuk membantu proses pemantauan dan pengambilan keputusan.

## Fitur Utama

1. **Dashboard Eksekutif**  
   Menampilkan indikator kinerja utama (KPI), peringatan, tren, dan *insight* untuk mendukung pengambilan keputusan.

2. **Monitoring Wilayah**  
   Menyajikan data produksi, luas panen, dan produktivitas pertanian berdasarkan kecamatan.

3. **Monitoring Harga Pangan**  
   Mendukung pemantauan harga pangan dan analisis tren harga. Fitur ini masih dalam pengembangan.

4. **Cuaca dan Risiko**  
   Mengintegrasikan data cuaca dari API BMKG untuk mendukung pemantauan kondisi cuaca dan risiko pertanian.

5. **Prediksi dan Early Warning System**  
   Menyediakan dukungan API untuk integrasi model *machine learning* dan sistem peringatan dini.

6. **Ketahanan Pangan**  
   Mendukung pemantauan indeks dan status ketahanan pangan.

7. **Insight dan Rekomendasi**  
   Menyediakan *insight* analitis dan rekomendasi komoditas untuk mendukung perencanaan pertanian.

8. **Data Center**  
   Mendukung pengunggahan data CSV dan Excel melalui API dengan autentikasi sesuai hak akses pengguna.

## Tech Stack

| Komponen | Teknologi |
|---|---|
| Backend | FastAPI, Python 3.11 |
| Database | Supabase (PostgreSQL) |
| ORM | SQLAlchemy |
| Autentikasi | OAuth2, JWT |
| Password Hashing | Passlib, Bcrypt |
| Data Processing | Pandas |
| External API | BMKG |
| Testing | Pytest |
| Testing Database | SQLite in-memory |

## Struktur Folder

```text
AgriDash-0.1/
├── api/            # Backend API dan endpoint
├── app/            # Frontend dan antarmuka pengguna
├── data/           # Dataset raw, derived, dan external
├── docs/           # Dokumentasi proyek
├── lib/            # Shared library
├── models/         # Model machine learning dan konfigurasi
├── notebooks/      # Eksplorasi data dan eksperimen model
├── public/         # Aset statis frontend
├── src/            # Pipeline ETL, ML, dan utilitas bersama
└── tests/          # Unit test dan integration test
```

*Catatan: Struktur di atas merupakan gambaran direktori proyek. Pastikan nama folder dan lokasi modul sesuai dengan struktur aktual repositori.*

## Pembagian Tugas Tim

| Role | Penanggung Jawab | Fokus Pengembangan |
|---|---|---|
| Data Engineer | Zarah | `data/`, `src/etl/` |
| ML Engineer | Zerlina | `models/`, `src/ml/`, `notebooks/` |
| Backend/API Developer | Linda | `api/`, `src/utils/` |
| Frontend/UI Developer | Dhini | `app/`, `public/` |

## Persyaratan Sistem

Sebelum menjalankan proyek, pastikan perangkat telah memiliki:

- Python 3.11
- Git
- Akses ke database Supabase PostgreSQL
- Dependency proyek yang tercantum dalam `requirements.txt`

## Instalasi dan Konfigurasi Lokal

### 1. Clone Repository

```bash
git clone https://github.com/zarahrnw/AgriDash-0.1.git
cd AgriDash-0.1
```

### 2. Buat Virtual Environment

Jalankan perintah berikut pada Windows:

```powershell
python -m venv venv
venv\Scripts\activate
```

Pada macOS atau Linux:

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Instal Dependency

```bash
python -m pip install -r requirements.txt
```

### 4. Konfigurasi Environment Variables

Buat file `.env` di direktori utama proyek, sejajar dengan `README.md`.

Isi file `.env` dengan konfigurasi berikut:

```env
DATABASE_URL="postgresql://..."
SECRET_KEY="ganti_dengan_kunci_rahasia"
ALGORITHM="HS256"
```

Keterangan:

- `DATABASE_URL`: Connection string untuk menghubungkan aplikasi dengan database Supabase PostgreSQL.
- `SECRET_KEY`: Kunci rahasia yang digunakan untuk proses penandatanganan token JWT.
- `ALGORITHM`: Algoritma yang digunakan untuk penandatanganan token JWT.

**Penting:**
- Ganti nilai contoh dengan konfigurasi yang sesuai dengan lingkungan pengembangan.
- Mintalah connection string database kepada pengelola proyek.
- Jangan mengunggah file `.env` yang berisi kredensial asli ke GitHub.
- Pastikan nama variabel sesuai dengan yang dibaca oleh kode backend.

Untuk memudahkan konfigurasi anggota tim, sediakan file `.env.example` yang berisi nama variabel dan nilai placeholder tanpa kredensial asli.

### 5. Jalankan Backend

Jika entry point aplikasi berada di `api/main.py`, jalankan:

```bash
uvicorn api.main:app --reload
```

Secara default, aplikasi dapat diakses melalui:

```text
http://127.0.0.1:8000
```

Pastikan perintah tersebut sesuai dengan lokasi objek `app` pada kode aktual.

### 6. Jalankan Automated Testing

```bash
python -m pytest -v
```

Perintah ini menjalankan pengujian yang tersedia di direktori `tests/`.

## Dokumentasi API

AgriDash menggunakan FastAPI yang menyediakan dokumentasi API interaktif melalui Swagger UI.

Setelah backend berhasil dijalankan, buka:

**Swagger UI:** http://127.0.0.1:8000/docs

Dokumentasi alternatif tersedia melalui:

**ReDoc:** http://127.0.0.1:8000/redoc

### Endpoint Utama

Berikut adalah endpoint yang direncanakan sebagai akses utama layanan API. Ketersediaan dan metode HTTP perlu disesuaikan dengan implementasi aktual.

| Modul | Endpoint | Kegunaan |
|---|---|---|
| Autentikasi | `POST /api/v1/auth/register` | Registrasi pengguna |
| Autentikasi | `POST /api/v1/auth/login` | Login pengguna |
| Tanaman Pangan | `GET /api/v1/tanaman-pangan` | Mengakses data tanaman pangan |
| Cuaca dan EWS | `GET /api/v1/ews-cuaca/{kode_wilayah}` | Mengakses informasi cuaca dan peringatan dini |
| Data Center | `POST /api/v1/tanaman-pangan/upload` | Mengunggah data tanaman pangan |
| Prediksi | `POST /api/v1/prediksi` | Mengakses layanan prediksi |

Beberapa endpoint mungkin memerlukan autentikasi dan otorisasi tertentu. Periksa dokumentasi Swagger UI untuk mengetahui parameter, skema request dan response, serta persyaratan akses masing-masing endpoint.

## Sumber Data

| Data | Sumber |
|---|---|
| Hortikultura, perkebunan, peternakan, dan perikanan | BPS Kabupaten Kediri, publikasi *Kabupaten Kediri Dalam Angka* |
| Tanaman pangan | Estimasi berbasis proporsi luas sawah per kecamatan |
| Cuaca | API BMKG |
| Harga pangan | Siskaperbapo Jawa Timur |
| Ketahanan pangan | Badan Pangan Nasional (Bapanas) |

Untuk informasi mengenai metode pembagian estimasi tanaman pangan, lihat notebook `notebooks/Pembagian Tanaman Pangan.ipynb`, apabila file tersebut tersedia pada repositori.

## Status Pengembangan

**Status:** Dalam pengembangan aktif.

Pengembangan mencakup backend API, integrasi database, pengolahan data, integrasi sumber data eksternal, serta dukungan layanan analitik dan prediksi.

Fitur yang telah selesai, sedang dikembangkan, atau belum diimplementasikan perlu dikonfirmasi melalui kode sumber dan hasil pengujian terbaru.

## Kontributor

| Nama | Peran |
|---|---|
| Zarah | Data Engineer |
| Zerlina | ML Engineer |
| Linda | Backend/API Developer |
| Dhini | Frontend/UI Developer |

---

Dikembangkan sebagai bagian dari program hilirisasi SINERGI untuk mendukung analisis data pertanian dan ketahanan pangan Kabupaten Kediri.