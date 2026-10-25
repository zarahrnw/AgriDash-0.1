/* =========================================================
   PAGE NAVIGATION
========================================================= */

function showPage(pageId, clickedButton) {

    // Ambil semua halaman
    const pages = document.querySelectorAll(".page");

    // Sembunyikan semua halaman
    pages.forEach(function(page) {

        page.classList.remove("active-page");

    });


    // Tampilkan halaman yang dipilih
    const selectedPage = document.getElementById(pageId);

    if (selectedPage) {

        selectedPage.classList.add("active-page");

    }


    // Ambil semua menu
    const menuItems = document.querySelectorAll(".menu-item");


    // Hapus status aktif dari semua menu
    menuItems.forEach(function(menu) {

        menu.classList.remove("active");

    });


    // Aktifkan menu yang diklik
    if (clickedButton) {

        clickedButton.classList.add("active");

    }


    // Kembali ke atas halaman
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

}



/* =========================================================
   PRODUCTION CHART
========================================================= */

const productionChart =
    document.getElementById("productionChart");


if (productionChart) {

    new Chart(productionChart, {

        type: "line",

        data: {

            labels: [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "Mei",
                "Jun"
            ],

            datasets: [

                {
                    label: "Padi",

                    data: [
                        200,
                        260,
                        300,
                        330,
                        380,
                        440
                    ],

                    borderColor: "#265322",

                    backgroundColor: "rgba(96,152,44,0.08)",

                    borderWidth: 3,

                    pointRadius: 3,

                    pointBackgroundColor: "#60982c",

                    tension: 0.4,

                    fill: false
                },


                {
                    label: "Jagung",

                    data: [
                        115,
                        150,
                        175,
                        200,
                        230,
                        260
                    ],

                    borderColor: "#ffcc00",

                    borderWidth: 3,

                    pointRadius: 3,

                    pointBackgroundColor: "#ffcc00",

                    tension: 0.4,

                    fill: false
                },


                {
                    label: "Kedelai",

                    data: [
                        55,
                        75,
                        90,
                        110,
                        140,
                        175
                    ],

                    borderColor: "#8ab45b",

                    borderWidth: 3,

                    pointRadius: 3,

                    pointBackgroundColor: "#8ab45b",

                    tension: 0.4,

                    fill: false
                }

            ]

        },


        options: {

            responsive: true,

            maintainAspectRatio: false,

            plugins: {

                legend: {

                    position: "bottom",

                    labels: {

                        usePointStyle: true,

                        pointStyle: "circle",

                        padding: 20,

                        font: {

                            family: "Poppins",

                            size: 9

                        }

                    }

                }

            },


            scales: {

                x: {

                    grid: {

                        display: false

                    },

                    ticks: {

                        font: {

                            family: "Poppins",

                            size: 9

                        }

                    }

                },


                y: {

                    beginAtZero: true,

                    grid: {

                        color: "#edf1eb"

                    },

                    ticks: {

                        font: {

                            family: "Poppins",

                            size: 9

                        }

                    }

                }

            }

        }

    });

}



/* =========================================================
   PRICE CHART
========================================================= */

const priceChart =
    document.getElementById("priceChart");


if (priceChart) {

    new Chart(priceChart, {

        type: "line",

        data: {

            labels: [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "Mei",
                "Jun"
            ],

            datasets: [

                {
                    label: "Cabai Merah",

                    data: [
                        32000,
                        35000,
                        37000,
                        41000,
                        45000,
                        48000
                    ],

                    borderColor: "#265322",

                    borderWidth: 3,

                    tension: 0.4
                },


                {
                    label: "Bawang Merah",

                    data: [
                        25000,
                        26000,
                        28000,
                        29000,
                        31000,
                        32000
                    ],

                    borderColor: "#ffcc00",

                    borderWidth: 3,

                    tension: 0.4
                },


                {
                    label: "Beras",

                    data: [
                        13000,
                        13200,
                        13500,
                        13800,
                        14000,
                        14500
                    ],

                    borderColor: "#60982c",

                    borderWidth: 3,

                    tension: 0.4
                }

            ]

        },


        options: {

            responsive: true,

            plugins: {

                legend: {

                    position: "bottom"

                }

            }

        }

    });

}



/* =========================================================
   PREDICTION CHART
========================================================= */

const predictionChart =
    document.getElementById("predictionChart");


if (predictionChart) {

    new Chart(predictionChart, {

        type: "line",

        data: {

            labels: [
                "Jun",
                "Jul",
                "Agu",
                "Sep",
                "Okt",
                "Nov"
            ],

            datasets: [

                {

                    label: "Aktual",

                    data: [
                        420,
                        440,
                        460,
                        null,
                        null,
                        null
                    ],

                    borderColor: "#265322",

                    borderWidth: 3,

                    tension: 0.4

                },


                {

                    label: "Prediksi",

                    data: [
                        null,
                        null,
                        460,
                        490,
                        520,
                        550
                    ],

                    borderColor: "#ffcc00",

                    borderWidth: 3,

                    borderDash: [
                        7,
                        7
                    ],

                    tension: 0.4

                }

            ]

        },


        options: {

            responsive: true,

            plugins: {

                legend: {

                    position: "bottom"

                }

            }

        }

    });

}



/* =========================================================
   INTEGRASI API BACKEND FASTAPI
========================================================= */

const API_BASE_URL = "http://127.0.0.1:8000";


// 1. Mengambil ringkasan produksi dan luas panen
async function loadDashboardSummary() {

    const statusAPI = document.getElementById("statusAPI");

    try {

        const response = await fetch(
            `${API_BASE_URL}/api/v1/tanaman-pangan/ringkasan`
        );

        if (!response.ok) {

            throw new Error("Gagal mengambil data ringkasan.");

        }

        const data = await response.json();

        const totalProduksi = Number(data.total_produksi_ton) || 0;
        const totalLuasPanen = Number(data.total_luas_panen_ha) || 0;


        // Isi kartu Total Produksi
        const elProduksi = document.getElementById("totalProduksi");

        if (elProduksi) {

            elProduksi.textContent =
                totalProduksi.toLocaleString("id-ID");

        }


        // Isi kartu Luas Panen
        const elLuas = document.getElementById("totalLuasPanen");

        if (elLuas) {

            elLuas.textContent =
                totalLuasPanen.toLocaleString("id-ID");

        }


        // Hitung & isi Produktivitas (Produksi ÷ Luas)
        const elProduktivitas =
            document.getElementById("totalProduktivitas");

        if (elProduktivitas) {

            if (totalLuasPanen > 0) {

                const produktivitas =
                    totalProduksi / totalLuasPanen;

                elProduktivitas.textContent =
                    produktivitas.toLocaleString("id-ID", {
                        maximumFractionDigits: 2
                    });

            } else {

                elProduktivitas.textContent = "Belum tersedia";

            }

        }


        // Status API
        if (statusAPI) {

            statusAPI.textContent =
                "✅ Data berhasil dimuat dari backend.";

            statusAPI.style.color = "#265322";

        }

    } catch (error) {

        console.error("Gagal memuat ringkasan:", error);


        // Fallback tampilan
        const elProduksi = document.getElementById("totalProduksi");
        const elLuas = document.getElementById("totalLuasPanen");
        const elProduktivitas =
            document.getElementById("totalProduktivitas");

        if (elProduksi) elProduksi.textContent = "—";
        if (elLuas) elLuas.textContent = "—";
        if (elProduktivitas) elProduktivitas.textContent = "Belum tersedia";


        if (statusAPI) {

            statusAPI.textContent =
                "⚠️ Gagal memuat data. Periksa koneksi backend.";

            statusAPI.style.color = "#b91c1c";

        }

    }

}


// 2. Mengambil data untuk tabel Monitoring Wilayah (Dengan Endpoint Rekap Baru)
async function loadMonitoringData(filterKecamatan = "") {

    const tabel = document.getElementById("tabelMonitoring");

    if (!tabel) return;

    // Tampilkan loading setiap kali tombol Terapkan diklik
    tabel.innerHTML = `<tr><td colspan="4">Memuat data...</td></tr>`;

    try {

        // Karena backend sudah menghitung rekap, kita panggil endpoint rekap-kecamatan
        const response = await fetch(`${API_BASE_URL}/api/v1/rekap-kecamatan`);

        if (!response.ok) {

            throw new Error("Gagal mengambil data rekap kecamatan.");

        }

        const result = await response.json();
        let rows = result.data;

        // Filter manual di frontend berdasarkan pilihan dropdown
        if (filterKecamatan) {
            rows = rows.filter(item => item.kecamatan.toLowerCase() === filterKecamatan.toLowerCase());
        }

        if (!Array.isArray(rows) || rows.length === 0) {

            tabel.innerHTML = `
                <tr>
                    <td colspan="4">Belum ada data untuk kecamatan ini.</td>
                </tr>
            `;

            return;

        }

        // Render baris tabel (Data sudah dalam bentuk rekap dari backend)
        tabel.innerHTML = rows
            .map((item) => `
                <tr>
                    <td>${item.kecamatan}</td>
                    <td>${item.produksi_ton.toLocaleString("id-ID", {
                        maximumFractionDigits: 2
                    })}</td>
                    <td>${item.luas_panen_ha.toLocaleString("id-ID", {
                        maximumFractionDigits: 2
                    })}</td>
                    <td>
                        <span class="status normal">
                            Data tersedia
                        </span>
                    </td>
                </tr>
            `)
            .join("");

    } catch (error) {

        console.error("Gagal memuat monitoring:", error);

        tabel.innerHTML = `
            <tr>
                <td colspan="4">
                    Gagal memuat data dari backend.
                </td>
            </tr>
        `;

    }

}


// 3. Mengambil data untuk Top 5 Kecamatan (Produksi)
async function loadTop5Kecamatan() {

    const container = document.getElementById("top5Kecamatan");

    if (!container) return;

    try {

        // Kita juga bisa pakai endpoint rekap untuk Top 5 ini
        const response = await fetch(`${API_BASE_URL}/api/v1/rekap-kecamatan`);

        if (!response.ok) {

            throw new Error("Gagal mengambil data tanaman pangan.");

        }

        const result = await response.json();
        
        // Karena endpoint rekap sudah otomatis mengurutkan dari yang terbesar,
        // kita tinggal potong (slice) 5 data teratas
        const top5 = result.data.slice(0, 5);

        if (!Array.isArray(top5) || top5.length === 0) {

            container.innerHTML = "<p>Data kecamatan belum tersedia.</p>";

            return;

        }

        // Render dengan DOM agar aman
        container.innerHTML = "";

        top5.forEach((item, index) => {

            const row = document.createElement("div");
            row.className = "rank-row";

            const rankNumber = document.createElement("div");
            rankNumber.className = "rank-number";
            rankNumber.textContent = index + 1;

            const nameSpan = document.createElement("span");
            nameSpan.textContent = item.kecamatan;

            const valueStrong = document.createElement("strong");
            valueStrong.textContent = item.produksi_ton.toLocaleString("id-ID", {
                maximumFractionDigits: 0
            }) + " ton";

            const trendEm = document.createElement("em");
            trendEm.innerHTML = "↑";
            trendEm.style.color = "#8ab45b";

            row.append(rankNumber, nameSpan, valueStrong, trendEm);
            container.appendChild(row);

        });

    } catch (error) {

        console.error("Gagal memuat Top 5 Kecamatan:", error);

        container.innerHTML = "<p style='color:red;'>Gagal memuat data kecamatan.</p>";

    }

}


// 4. Mengisi Dropdown Filter Kecamatan dari API
async function loadFilterKecamatan() {
    const dropdown = document.getElementById("filterKecamatan");

    if (!dropdown) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/kecamatan`);

        if (!response.ok) {
            throw new Error("Gagal mengambil data master kecamatan.");
        }

        const result = await response.json();
        const daftarKecamatan = result.data;

        if (!Array.isArray(daftarKecamatan) || daftarKecamatan.length === 0) {
            return;
        }

        // Bersihkan isi dropdown, lalu kembalikan opsi default "Semua Kecamatan"
        dropdown.innerHTML = `<option value="">Semua Kecamatan</option>`;

        // Looping data kecamatan dan masukkan ke dalam <option>
        daftarKecamatan.forEach((namaKecamatan) => {
            const option = document.createElement("option");
            option.value = namaKecamatan; // Nilai yang dikirim ke API
            option.textContent = namaKecamatan; // Teks yang dilihat user
            dropdown.appendChild(option);
        });

    } catch (error) {
        console.error("Gagal memuat filter kecamatan:", error);
    }
}


// 5. Menambahkan fungsi klik pada tombol "Terapkan"
function setupFilterButton() {
    // Cari tombol berwarna hijau di dalam kotak filter (class .filter-card)
    const tombolTerapkan = document.querySelector(".filter-card .green-button");
    const dropdownKecamatan = document.getElementById("filterKecamatan");

    if (tombolTerapkan && dropdownKecamatan) {
        tombolTerapkan.addEventListener("click", () => {
            // Ambil kecamatan yang dipilih saat ini
            const kecamatanTerpilih = dropdownKecamatan.value;
            
            // Panggil ulang tabel dengan filter tersebut
            loadMonitoringData(kecamatanTerpilih);
        });
    }
}


// Jalankan semua integrasi setelah HTML selesai dimuat
document.addEventListener("DOMContentLoaded", () => {

    loadDashboardSummary();
    loadMonitoringData(); // Panggil awal tanpa filter (tampil semua data)
    loadTop5Kecamatan();
    loadFilterKecamatan(); 
    setupFilterButton(); // Aktifkan fungsi tombol Terapkan

});