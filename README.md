# AgriDash-0.1

Sistem informasi pertanian dan ketahanan pangan untuk Kabupaten Kediri, dikembangkan sebagai bagian dari program hilirisasi SINERGI. Agri-Dash membantu DKPP/Dispertabun memantau produksi pertanian, harga pangan, cuaca, dan ketahanan pangan secara terintegrasi, lengkap dengan prediksi dan peringatan dini (Early Warning System).

## Fitur Utama

1. **Dashboard Eksekutif** — KPI, alert, tren, dan smart insight untuk pimpinan
2. **Monitoring Wilayah** — Peta produksi, luas panen, produktivitas, dan wilayah prioritas
3. **Harga Pangan** — Monitoring harga, tren, volatilitas, dan alert
4. **Cuaca & Risiko** — Cuaca, prakiraan, dan risiko pertanian
5. **Prediksi & Early Warning** — Forecast produksi/produktivitas/harga dan peringatan dini
6. **Ketahanan Pangan** — Indeks, peta, tren, faktor dominan, dan prioritas
7. **Insight & Rekomendasi** — Rekomendasi komoditas dan insight otomatis
8. **Data Center** — Flexible upload, API, validasi, histori, dan tata kelola data

## Tech Stack

- **Backend**: FastAPI, PostgreSQL, SQLAlchemy
- **Data & ML**: pandas, scikit-learn, statsmodels, Prophet
- **Frontend**: (lihat `app/`)
- **Sumber data eksternal**: BMKG (cuaca), Siskaperbapo Jatim (harga pangan), Badan Pangan Nasional (ketahanan pangan)

## Struktur Folder

```
AgriDash-0.1/
├── api/            # Backend/API (routers, schemas, services)
├── app/            # Frontend/UI (components, pages, styles)
├── data/           # Dataset (raw, derived, external)
├── docs/           # Dokumentasi (data dictionary, API docs)
├── lib/            # Shared library
├── models/         # ML models (trained, configs)
├── notebooks/      # Eksplorasi & eksperimen data/model
├── public/         # Asset statis frontend
├── src/            # Pipeline & shared logic (etl, ml, utils)
└── tests/          # Unit & integration test
```

## Pembagian Role

| Role | Penanggung Jawab | Fokus Folder |
|---|---|---|
| Data Engineer | Zarah | `data/`, `src/etl/` |
| ML Engineer | Zerlina | `models/`, `src/ml/`, `notebooks/` |
| Backend/API | Linda | `api/`, `src/utils/` |
| Frontend/UI | Dhini | `app/`, `public/` |

## Setup Lokal

1. Clone repository:
   ```bash
   git clone https://github.com/zarahrnw/AgriDash-0.1.git
   cd AgriDash-0.1
   ```

2. Buat virtual environment dan install dependency:
   ```bash
   python -m venv venv
   venv\Scripts\activate      # Windows
   source venv/bin/activate   # macOS/Linux
   pip install -r requirements.txt
   ```

3. Copy `.env.example` menjadi `.env` dan isi credential/API key yang diperlukan:
   ```bash
   cp .env.example .env
   ```

4. Jalankan backend (setelah `api/main.py` tersedia):
   ```bash
   uvicorn api.main:app --reload
   ```

## Sumber Data

- Hortikultura, Perkebunan, Peternakan, Perikanan — BPS Kabupaten Kediri ("Kabupaten Kediri Dalam Angka")
- Tanaman Pangan — estimasi berbasis proporsi luas sawah per kecamatan (lihat `notebooks/Pembagian Tanaman Pangan.ipynb`)
- Cuaca — API BMKG
- Harga Pangan — Siskaperbapo Jawa Timur
- Ketahanan Pangan — Badan Pangan Nasional (Bapanas)

## Status Project

🚧 Dalam pengembangan aktif.