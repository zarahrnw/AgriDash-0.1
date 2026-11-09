
/* =========================================================
   AGRIDASH - MAIN JAVASCRIPT
   Integrasi Frontend dengan FastAPI Backend
========================================================= */

const API_BASE_URL = "http://127.0.0.1:8000";

/* =========================================================
   1. GLOBAL VARIABLES
========================================================= */

const chartInstances = {};

let clusteringData = [];
let pcaData = [];
let heatmapData = [];
let recommendationData = [];
let forecastingData = [];
let monitoringData = [];

let selectedForecastCommodity = "";


/* =========================================================
   2. HELPER FUNCTIONS
========================================================= */

// Format angka Indonesia
function formatNumber(value, decimals = 2) {
    const number = Number(value);

    if (!Number.isFinite(number)) return "—";

    return number.toLocaleString("id-ID", {
        maximumFractionDigits: decimals
    });
}


// Format angka dengan satuan
function formatValue(value, unit = "", decimals = 2) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    return `${formatNumber(value, decimals)} ${unit}`.trim();
}


// Menghindari HTML injection ketika menampilkan data dari API
function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// Normalisasi nama kolom
function normalizeKey(value) {
    return String(value ?? "")
        .toLowerCase()
        .trim()
        .replace(/[\s-]+/g, "_");
}


// Mencari nama kolom dari beberapa kemungkinan
function findKey(row, candidates) {
    if (!row || typeof row !== "object") return null;

    const keys = Object.keys(row);

    for (const candidate of candidates) {
        const found = keys.find(
            key => normalizeKey(key) === normalizeKey(candidate)
        );

        if (found) return found;
    }

    return null;
}


// Mengambil nilai berdasarkan kemungkinan nama kolom
function getValue(row, candidates, fallback = null) {
    const key = findKey(row, candidates);

    return key ? row[key] : fallback;
}


// Mengubah nilai menjadi angka
function toNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const result = Number(
        String(value).replace(",", ".")
    );

    return Number.isFinite(result) ? result : null;
}


// Mengambil array data dari respons API
function getRecords(response) {
    if (Array.isArray(response)) return response;

    if (Array.isArray(response?.data)) {
        return response.data;
    }

    if (Array.isArray(response?.records)) {
        return response.records;
    }

    return [];
}


// Menampilkan pesan pada elemen HTML
function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value ?? "—";
    }
}


// Menampilkan pesan status
function setStatus(id, message, isError = false) {
    const element = document.getElementById(id);

    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#b91c1c" : "#265322";
}


// Membuat pesan loading untuk tabel
function setTableLoading(id, colspan = 4) {
    const element = document.getElementById(id);

    if (!element) return;

    element.innerHTML = `
        <tr>
            <td colspan="${colspan}" style="text-align:center;">
                Memuat data...
            </td>
        </tr>
    `;
}


// Menampilkan pesan kosong pada tabel
function setTableEmpty(id, message, colspan = 4) {
    const element = document.getElementById(id);

    if (!element) return;

    element.innerHTML = `
        <tr>
            <td colspan="${colspan}" style="text-align:center;">
                ${escapeHTML(message)}
            </td>
        </tr>
    `;
}


// Helper fetch API
async function apiFetch(endpoint, options = {}) {
    const response = await fetch(
        `${API_BASE_URL}${endpoint}`,
        options
    );

    if (!response.ok) {
        let message = `HTTP ${response.status}`;

        try {
            const errorData = await response.json();
            message = errorData.detail || message;
        } catch (_) {
            // Gunakan pesan HTTP jika respons bukan JSON
        }

        throw new Error(message);
    }

    return response.json();
}


// Menghancurkan chart lama sebelum membuat chart baru
function destroyChart(chartId) {
    if (chartInstances[chartId]) {
        chartInstances[chartId].destroy();
        delete chartInstances[chartId];
    }
}


// Membuat chart Chart.js
function createChart(chartId, config) {
    const canvas = document.getElementById(chartId);

    if (!canvas || typeof Chart === "undefined") return null;

    destroyChart(chartId);

    chartInstances[chartId] = new Chart(canvas, config);

    return chartInstances[chartId];
}


// Konfigurasi umum Chart.js
function chartFont() {
    return {
        family: "Poppins",
        size: 10
    };
}


function chartLegend() {
    return {
        position: "bottom",
        labels: {
            usePointStyle: true,
            pointStyle: "circle",
            padding: 18,
            font: chartFont()
        }
    };
}


function chartScales() {
    return {
        x: {
            grid: {
                display: false
            },
            ticks: {
                font: chartFont()
            }
        },
        y: {
            beginAtZero: true,
            grid: {
                color: "#edf1eb"
            },
            ticks: {
                font: chartFont()
            }
        }
    };
}


// Mengambil token login jika tersedia
function getAuthToken() {
    return (
        localStorage.getItem("access_token") ||
        localStorage.getItem("token") ||
        sessionStorage.getItem("access_token") ||
        sessionStorage.getItem("token")
    );
}


/* =========================================================
   3. PAGE NAVIGATION
========================================================= */

function showPage(pageId, clickedButton) {

    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active-page");
    });

    const selectedPage = document.getElementById(pageId);

    if (selectedPage) {
        selectedPage.classList.add("active-page");
    }

    document.querySelectorAll(".menu-item").forEach(menu => {
        menu.classList.remove("active");
    });

    if (clickedButton) {
        clickedButton.classList.add("active");
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    // Muat ulang data sesuai halaman yang dibuka
    switch (pageId) {
        case "dashboard":
            loadDashboard();
            break;

        case "monitoring":
            loadMonitoringData();
            loadPCA();
            loadHeatmap();
            break;

        case "harga":
            loadPriceData();
            break;

        case "prediksi":
            loadForecasting();
            break;

        case "ketahanan":
            loadClustering();
            loadRecommendations();
            loadModelComparison();
            break;

        case "data":
            loadDataCenter();
            break;

        case "audit":
            loadAuditTrail();
            break;
    }
}


/* =========================================================
   4. DASHBOARD SUMMARY
========================================================= */

async function loadDashboardSummary() {

    try {
        const data = await apiFetch(
            "/api/v1/tanaman-pangan/ringkasan"
        );

        const totalProduksi = toNumber(data.total_produksi);
        const totalLuasPanen = toNumber(data.total_luas_panen);
        const produktivitas = toNumber(data.rata_produktivitas);

        setText(
            "totalProduksi",
            totalProduksi !== null
                ? formatNumber(totalProduksi, 2)
                : "—"
        );

        setText(
            "totalLuasPanen",
            totalLuasPanen !== null
                ? formatNumber(totalLuasPanen, 2)
                : "—"
        );

        setText(
            "totalProduktivitas",
            produktivitas !== null
                ? formatNumber(produktivitas, 2)
                : "—"
        );

        // Tidak ada data historis pembanding pada endpoint ringkasan.
        setText("growthProduksi", "Data historis belum tersedia");
        setText("growthLuasPanen", "Data historis belum tersedia");
        setText("growthProduktivitas", "Data historis belum tersedia");

        setStatus(
            "statusAPI",
            "Data berhasil dimuat dari backend."
        );

        return data;

    } catch (error) {
        console.error("Dashboard summary:", error);

        setText("totalProduksi", "—");
        setText("totalLuasPanen", "—");
        setText("totalProduktivitas", "—");

        setStatus(
            "statusAPI",
            `Gagal memuat data: ${error.message}`,
            true
        );

        return null;
    }
}


/* =========================================================
   5. DASHBOARD PRODUCTION CHART
========================================================= */

async function loadProductionChart() {

    const canvas = document.getElementById("productionChart");

    if (!canvas) return;

    try {
        const response = await apiFetch(
            "/api/v1/tanaman-pangan?limit=500&sort_by=produksi_ton"
        );

        const rows = getRecords(response);

        if (!rows.length) {
            destroyChart("productionChart");
            return;
        }

        const grouped = {};

        rows.forEach(row => {
            const commodity = getValue(
                row,
                ["tanaman", "komoditas", "nama_tanaman"],
                "Lainnya"
            );

            const production = toNumber(
                getValue(row, ["produksi_ton", "produksi"])
            );

            if (production === null) return;

            grouped[commodity] = (grouped[commodity] || 0) + production;
        });

        const labels = Object.keys(grouped);

        const values = labels.map(label => grouped[label]);

        if (!labels.length) {
            destroyChart("productionChart");
            return;
        }

        createChart("productionChart", {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    label: "Produksi (Ton)",
                    data: values,
                    backgroundColor: [
                        "#265322",
                        "#60982c",
                        "#8ab45b",
                        "#ffcc00",
                        "#b5ce8c",
                        "#d6a900"
                    ],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: chartScales()
            }
        });

    } catch (error) {
        console.error("Production chart:", error);
        destroyChart("productionChart");
    }
}


/* =========================================================
   6. DASHBOARD TOP 5 KECAMATAN
========================================================= */

async function loadTop5Kecamatan() {

    const container = document.getElementById("top5Kecamatan");

    if (!container) return;

    try {
        const response = await apiFetch(
            "/api/v1/rekap-kecamatan"
        );

        const rows = getRecords(response);

        if (!rows.length) {
            container.innerHTML = "<p>Data kecamatan belum tersedia.</p>";
            return;
        }

        const sortedRows = [...rows].sort((a, b) => {
            const valueA = toNumber(
                getValue(a, ["total_produksi", "produksi_ton"])
            ) || 0;

            const valueB = toNumber(
                getValue(b, ["total_produksi", "produksi_ton"])
            ) || 0;

            return valueB - valueA;
        });

        const top5 = sortedRows.slice(0, 5);

        container.innerHTML = "";

        top5.forEach((item, index) => {

            const name = getValue(
                item,
                ["kecamatan", "nama_kecamatan"],
                "Tidak diketahui"
            );

            const production = toNumber(
                getValue(item, ["total_produksi", "produksi_ton"])
            );

            const row = document.createElement("div");
            row.className = "rank-row";

            const rank = document.createElement("div");
            rank.className = "rank-number";
            rank.textContent = index + 1;

            const nameSpan = document.createElement("span");
            nameSpan.textContent = name;

            const value = document.createElement("strong");
            value.textContent = production !== null
                ? `${formatNumber(production, 2)} ton`
                : "—";

            row.append(rank, nameSpan, value);
            container.appendChild(row);
        });

    } catch (error) {
        console.error("Top 5 kecamatan:", error);

        container.innerHTML = `
            <p style="color:#b91c1c;">
                Gagal memuat data kecamatan.
            </p>
        `;
    }
}


/* =========================================================
   7. DASHBOARD COMMODITY SUMMARY
========================================================= */

async function loadDashboardCommodity() {

    const container = document.getElementById("dashboardKomoditas");

    if (!container) return;

    try {
        const response = await apiFetch(
            "/api/v1/tanaman-pangan?limit=500"
        );

        const rows = getRecords(response);

        if (!rows.length) {
            container.innerHTML = "<p>Data komoditas belum tersedia.</p>";
            return;
        }

        const grouped = {};

        rows.forEach(row => {
            const name = getValue(
                row,
                ["tanaman", "komoditas"],
                "Lainnya"
            );

            const production = toNumber(
                getValue(row, ["produksi_ton"])
            ) || 0;

            grouped[name] = (grouped[name] || 0) + production;
        });

        const total = Object.values(grouped).reduce(
            (sum, value) => sum + value,
            0
        );

        const sorted = Object.entries(grouped)
            .sort((a, b) => b[1] - a[1]);

        container.innerHTML = sorted.map(([name, value]) => {

            const percentage = total > 0
                ? (value / total) * 100
                : 0;

            return `
                <div class="commodity-row">
                    <div class="commodity-info">
                        <span>${escapeHTML(name)}</span>
                        <strong>${formatNumber(percentage, 1)}%</strong>
                    </div>

                    <div class="progress-bar">
                        <div
                            class="progress-fill"
                            style="width:${percentage}%"
                        ></div>
                    </div>
                </div>
            `;
        }).join("");

    } catch (error) {
        console.error("Dashboard commodity:", error);

        container.innerHTML = "<p>Gagal memuat data komoditas.</p>";
    }
}


/* =========================================================
   8. DASHBOARD CLUSTER SUMMARY
========================================================= */

async function loadDashboardClusterSummary() {

    const container = document.getElementById(
        "dashboardClusterSummary"
    );

    if (!container) return;

    try {
        const response = await apiFetch(
            "/api/v1/model/clustering"
        );

        const rows = getRecords(response);

        const clusterColumn = response.cluster_column;

        if (!rows.length || !clusterColumn) {
            container.textContent =
                "Hasil clustering belum tersedia.";
            return;
        }

        const clusters = {};

        rows.forEach(row => {
            const cluster = row[clusterColumn] ?? "Tidak diketahui";

            clusters[cluster] = (clusters[cluster] || 0) + 1;
        });

        container.innerHTML = `
            <p>
                Terdapat <strong>${Object.keys(clusters).length}</strong>
                kelompok hasil clustering dari
                <strong>${rows.length}</strong> data.
            </p>
        `;

    } catch (error) {
        console.error("Dashboard cluster summary:", error);

        container.textContent =
            "Data clustering belum dapat ditampilkan.";
    }
}


/* =========================================================
   9. DASHBOARD WARNING SUMMARY
========================================================= */

async function loadDashboardWarning() {

    // Backend belum menyediakan endpoint agregasi EWS seluruh kecamatan.
    setText("jumlahWilayahWarning", "—");
    setText("statusWilayahWarning", "Data EWS belum tersedia");
}


/* =========================================================
   10. DASHBOARD LOAD ALL
========================================================= */

async function loadDashboard() {

    await Promise.allSettled([
        loadDashboardSummary(),
        loadProductionChart(),
        loadTop5Kecamatan(),
        loadDashboardCommodity(),
        loadDashboardClusterSummary(),
        loadDashboardWarning()
    ]);
}


/* =========================================================
   11. MONITORING WILAYAH
========================================================= */

async function loadMonitoringData(filterKecamatan = "") {

    const table = document.getElementById("tabelMonitoring");

    if (!table) return;

    setTableLoading("tabelMonitoring", 4);

    try {
        const response = await apiFetch(
            "/api/v1/rekap-kecamatan"
        );

        monitoringData = getRecords(response);

        let rows = [...monitoringData];

        if (filterKecamatan) {
            rows = rows.filter(item => {
                const name = getValue(
                    item,
                    ["kecamatan", "nama_kecamatan"],
                    ""
                );

                return String(name).toLowerCase() ===
                    filterKecamatan.toLowerCase();
            });
        }

        if (!rows.length) {
            setTableEmpty(
                "tabelMonitoring",
                "Belum ada data untuk kecamatan ini.",
                4
            );
            return;
        }

        table.innerHTML = rows.map(item => {

            const name = getValue(
                item,
                ["kecamatan", "nama_kecamatan"],
                "—"
            );

            const production = toNumber(
                getValue(item, ["total_produksi", "produksi_ton"])
            );

            const area = toNumber(
                getValue(item, ["total_luas_panen", "luas_panen_ha"])
            );

            const productivity = toNumber(
                getValue(item, [
                    "rata_produktivitas",
                    "produktivitas_kuintal_ha"
                ])
            );

            return `
                <tr>
                    <td>${escapeHTML(name)}</td>
                    <td>${formatNumber(production)}</td>
                    <td>${formatNumber(area)}</td>
                    <td>
                        <span class="status normal">
                            ${productivity !== null
                                ? `${formatNumber(productivity)} ku/ha`
                                : "Data tersedia"}
                        </span>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (error) {
        console.error("Monitoring:", error);

        setTableEmpty(
            "tabelMonitoring",
            `Gagal memuat data: ${error.message}`,
            4
        );
    }
}


/* =========================================================
   12. FILTER KECAMATAN
========================================================= */

async function loadFilterKecamatan() {

    const dropdown = document.getElementById("filterKecamatan");

    if (!dropdown) return;

    try {
        const response = await apiFetch(
            "/api/v1/kecamatan"
        );

        const rows = getRecords(response);

        dropdown.innerHTML = `
            <option value="">Semua Kecamatan</option>
        `;

        rows.forEach(item => {

            // Endpoint mengembalikan objek { kecamatan: "..." }
            const name = typeof item === "string"
                ? item
                : getValue(item, ["kecamatan", "nama_kecamatan"]);

            if (!name) return;

            const option = document.createElement("option");

            option.value = name;
            option.textContent = name;

            dropdown.appendChild(option);
        });

    } catch (error) {
        console.error("Filter kecamatan:", error);
    }
}


function setupFilterButton() {

    const button = document.querySelector(
        ".filter-card .green-button"
    );

    const dropdown = document.getElementById(
        "filterKecamatan"
    );

    if (!button || !dropdown || button.dataset.listenerAdded) {
        return;
    }

    button.addEventListener("click", () => {
        loadMonitoringData(dropdown.value);
    });

    button.dataset.listenerAdded = "true";
}


/* =========================================================
   13. PCA CLUSTERING VISUALIZATION
========================================================= */

async function loadPCA() {

    const canvas = document.getElementById("pcaChart");

    if (!canvas) return;

    try {
        const response = await apiFetch(
            "/api/v1/model/pca"
        );

        pcaData = getRecords(response);

        if (!pcaData.length) {
            destroyChart("pcaChart");
            setText("pcaClusterSummary", "Data PCA belum tersedia.");
            return;
        }

        const clusterGroups = {};

        pcaData.forEach(item => {

            const cluster = item.cluster ?? "Tidak diketahui";

            if (!clusterGroups[cluster]) {
                clusterGroups[cluster] = [];
            }

            clusterGroups[cluster].push({
                x: toNumber(item.pca_1),
                y: toNumber(item.pca_2),
                kecamatan: item.kecamatan
            });
        });

        const palette = [
            "#265322",
            "#ffcc00",
            "#60982c",
            "#8ab45b",
            "#d97706",
            "#64748b",
            "#7c3aed"
        ];

        const datasets = Object.entries(clusterGroups).map(
            ([cluster, points], index) => ({
                label: `Cluster ${cluster}`,
                data: points.filter(
                    point => point.x !== null && point.y !== null
                ),
                backgroundColor: palette[index % palette.length],
                pointRadius: 6,
                pointHoverRadius: 8
            })
        );

        createChart("pcaChart", {
            type: "scatter",
            data: {
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: chartLegend(),
                    tooltip: {
                        callbacks: {
                            label: context => {
                                const point = context.raw;

                                return `${point.kecamatan}: (${formatNumber(point.x, 3)}, ${formatNumber(point.y, 3)})`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Principal Component 1"
                        },
                        grid: {
                            color: "#edf1eb"
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Principal Component 2"
                        },
                        grid: {
                            color: "#edf1eb"
                        }
                    }
                }
            }
        });

        const variance = Array.isArray(response.explained_variance)
            ? response.explained_variance
            : [];

        const varianceText = variance.length
            ? ` | Variansi PC1: ${formatNumber(variance[0] * 100, 2)}%, PC2: ${formatNumber((variance[1] || 0) * 100, 2)}%`
            : "";

        setText(
            "pcaClusterSummary",
            `${pcaData.length} data | ${Object.keys(clusterGroups).length} cluster${varianceText}`
        );

    } catch (error) {
        console.error("PCA:", error);

        destroyChart("pcaChart");

        setText(
            "pcaClusterSummary",
            `PCA belum dapat dimuat: ${error.message}`
        );
    }
}


/* =========================================================
   14. HEATMAP KECAMATAN
========================================================= */

async function loadHeatmap() {

    const container = document.getElementById(
        "heatmapKecamatan"
    );

    if (!container) return;

    container.innerHTML = "<p>Memuat heatmap...</p>";

    try {
        const response = await apiFetch(
            "/api/v1/model/heatmap-kecamatan"
        );

        heatmapData = getRecords(response);

        if (!heatmapData.length) {
            container.innerHTML =
                "<p>Data heatmap belum tersedia.</p>";
            return;
        }

        const kecamatanColumn = response.kecamatan_column;
        const numericColumns = response.numeric_columns || [];

        if (!kecamatanColumn || !numericColumns.length) {
            container.innerHTML =
                "<p>Kolom numerik untuk heatmap belum tersedia.</p>";
            return;
        }

        const selectedColumns = numericColumns.slice(0, 5);

        // Hitung nilai maksimum tiap kolom untuk normalisasi warna.
        const maxValues = {};

        selectedColumns.forEach(column => {
            maxValues[column] = Math.max(
                ...heatmapData.map(row =>
                    toNumber(row[column]) || 0
                ),
                1
            );
        });

        let html = `
            <div class="table-responsive">
                <table class="heatmap-table">
                    <thead>
                        <tr>
                            <th>Kecamatan</th>
                            ${selectedColumns.map(column => `
                                <th>${escapeHTML(column)}</th>
                            `).join("")}
                        </tr>
                    </thead>
                    <tbody>
        `;

        heatmapData.forEach(row => {

            html += `
                <tr>
                    <td>${escapeHTML(row[kecamatanColumn])}</td>
            `;

            selectedColumns.forEach(column => {

                const value = toNumber(row[column]);
                const normalized = value !== null
                    ? Math.max(0, Math.min(1, value / maxValues[column]))
                    : 0;

                const opacity = 0.12 + (normalized * 0.72);

                html += `
                    <td style="
                        background-color:rgba(96,152,44,${opacity});
                        text-align:center;
                    ">
                        ${value !== null ? formatNumber(value) : "—"}
                    </td>
                `;
            });

            html += "</tr>";
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;

    } catch (error) {
        console.error("Heatmap:", error);

        container.innerHTML = `
            <p style="color:#b91c1c;">
                Gagal memuat heatmap: ${escapeHTML(error.message)}
            </p>
        `;
    }
}


/* =========================================================
   15. CLUSTERING - KETAHANAN PANGAN
========================================================= */

async function loadClustering() {

    setTableLoading("tabelCluster", 5);

    try {
        const response = await apiFetch(
            "/api/v1/model/clustering"
        );

        clusteringData = getRecords(response);

        if (!clusteringData.length) {
            setTableEmpty(
                "tabelCluster",
                "Data clustering belum tersedia.",
                5
            );
            return;
        }

        const clusterColumn = response.cluster_column;
        const kecamatanColumn = response.kecamatan_column;

        const clusterGroups = {};

        clusteringData.forEach(row => {

            const cluster = clusterColumn
                ? row[clusterColumn] ?? "Tidak diketahui"
                : "Tidak diketahui";

            clusterGroups[cluster] =
                (clusterGroups[cluster] || 0) + 1;
        });

        setText(
            "jumlahCluster",
            Object.keys(clusterGroups).length
        );

        setText(
            "jumlahKecamatanCluster",
            clusteringData.length
        );

        setText(
            "metodeClustering",
            "Hasil clustering dari dataset"
        );

        renderClusterDistribution(clusterGroups);
        renderClusterDescription(clusterGroups);

        const headers = Object.keys(clusteringData[0]);

        const displayHeaders = headers.slice(0, 5);

        const table = document.getElementById("tabelCluster");

        if (table) {
            table.innerHTML = clusteringData.map(row => `
                <tr>
                    ${displayHeaders.map(header => `
                        <td>${escapeHTML(row[header] ?? "—")}</td>
                    `).join("")}
                </tr>
            `).join("");
        }

        // Perbarui judul tabel jika struktur HTML menyediakan thead.
        const tableHead = document.querySelector(
            "#tabelCluster"
        )?.closest("table")?.querySelector("thead tr");

        if (tableHead) {
            tableHead.innerHTML = displayHeaders.map(header => `
                <th>${escapeHTML(header)}</th>
            `).join("");
        }

    } catch (error) {
        console.error("Clustering:", error);

        setTableEmpty(
            "tabelCluster",
            `Gagal memuat clustering: ${error.message}`,
            5
        );

        setText("jumlahCluster", "—");
        setText("jumlahKecamatanCluster", "—");
        setText("metodeClustering", "Data tidak tersedia");
    }
}


function renderClusterDistribution(clusterGroups) {

    const canvas = document.getElementById(
        "clusterDistributionChart"
    );

    if (!canvas) return;

    const labels = Object.keys(clusterGroups);

    const values = Object.values(clusterGroups);

    createChart("clusterDistributionChart", {
        type: "doughnut",
        data: {
            labels: labels.map(label => `Cluster ${label}`),
            datasets: [{
                data: values,
                backgroundColor: [
                    "#265322",
                    "#60982c",
                    "#ffcc00",
                    "#8ab45b",
                    "#d97706",
                    "#64748b"
                ],
                borderWidth: 2,
                borderColor: "#ffffff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: chartLegend()
            }
        }
    });
}


function renderClusterDescription(clusterGroups) {

    const container = document.getElementById(
        "clusterDescription"
    );

    if (!container) return;

    container.innerHTML = Object.entries(clusterGroups)
        .map(([cluster, total]) => `
            <div class="cluster-description-item">
                <strong>Cluster ${escapeHTML(cluster)}</strong>
                <span>${formatNumber(total, 0)} data</span>
            </div>
        `)
        .join("");
}


/* =========================================================
   16. REKOMENDASI KOMODITAS
========================================================= */

async function loadRecommendations() {

    setTableLoading("tabelRekomendasi", 4);

    try {
        const response = await apiFetch(
            "/api/v1/model/rekomendasi"
        );

        recommendationData = getRecords(response);

        if (!recommendationData.length) {
            setTableEmpty(
                "tabelRekomendasi",
                "Data rekomendasi belum tersedia.",
                4
            );
            return;
        }

        const table = document.getElementById(
            "tabelRekomendasi"
        );

        if (!table) return;

        const headers = Object.keys(recommendationData[0]);

        const displayHeaders = headers.slice(0, 4);

        table.innerHTML = recommendationData.map(row => `
            <tr>
                ${displayHeaders.map(header => {
                    const value = row[header];

                    return `
                        <td>${escapeHTML(
                            value === null || value === undefined
                                ? "—"
                                : typeof value === "number"
                                    ? formatNumber(value)
                                    : value
                        )}</td>
                    `;
                }).join("")}
            </tr>
        `).join("");

        const tableHead = table.closest("table")?.querySelector("thead tr");

        if (tableHead) {
            tableHead.innerHTML = displayHeaders.map(header => `
                <th>${escapeHTML(header)}</th>
            `).join("");
        }

    } catch (error) {
        console.error("Rekomendasi:", error);

        setTableEmpty(
            "tabelRekomendasi",
            `Gagal memuat rekomendasi: ${error.message}`,
            4
        );
    }
}


/* =========================================================
   17. MODEL COMPARISON
========================================================= */

async function loadModelComparison() {

    const container = document.getElementById(
        "tabelPerbandinganModel"
    );

    if (!container) return;

    setTableLoading("tabelPerbandinganModel", 4);

    try {
        const response = await apiFetch(
            "/api/v1/model/comparison"
        );

        const rows = getRecords(response);

        if (!rows.length) {
            setTableEmpty(
                "tabelPerbandinganModel",
                "Data perbandingan model belum tersedia.",
                4
            );
            return;
        }

        const headers = Object.keys(rows[0]).slice(0, 4);

        container.innerHTML = rows.map(row => `
            <tr>
                ${headers.map(header => `
                    <td>${escapeHTML(
                        typeof row[header] === "number"
                            ? formatNumber(row[header])
                            : row[header] ?? "—"
                    )}</td>
                `).join("")}
            </tr>
        `).join("");

        const tableHead = container.closest("table")
            ?.querySelector("thead tr");

        if (tableHead) {
            tableHead.innerHTML = headers.map(header => `
                <th>${escapeHTML(header)}</th>
            `).join("");
        }

    } catch (error) {
        console.error("Model comparison:", error);

        setTableEmpty(
            "tabelPerbandinganModel",
            `Data perbandingan belum tersedia: ${error.message}`,
            4
        );
    }
}


/* =========================================================
   18. FORECASTING
========================================================= */

async function loadForecasting() {

    const canvas = document.getElementById(
        "forecastingChart"
    );

    const oldCanvas = document.getElementById(
        "predictionChart"
    );

    const targetCanvas = canvas || oldCanvas;

    if (!targetCanvas) return;

    try {
        const response = await apiFetch(
            "/api/v1/model/forecasting"
        );

        forecastingData = getRecords(response);

        if (!forecastingData.length) {
            destroyChart(targetCanvas.id);

            setText(
                "forecastingSummary",
                "Data forecasting belum tersedia."
            );

            return;
        }

        populateForecastCommodity();

        renderForecastChart(
            selectedForecastCommodity ||
            document.getElementById("forecastKomoditas")?.value ||
            ""
        );

    } catch (error) {
        console.error("Forecasting:", error);

        destroyChart(targetCanvas.id);

        setText(
            "forecastingSummary",
            `Gagal memuat forecasting: ${error.message}`
        );

        const riskList = document.getElementById("riskList");

        if (riskList) {
            riskList.innerHTML =
                "<p>Data risiko belum tersedia.</p>";
        }
    }
}


function getForecastColumns() {

    if (!forecastingData.length) return {};

    const sample = forecastingData[0];

    return {
        commodity: findKey(sample, [
            "tanaman",
            "komoditas",
            "nama_tanaman"
        ]),

        date: findKey(sample, [
            "tanggal",
            "periode",
            "bulan",
            "date",
            "year_month",
            "tahun_bulan"
        ]),

        actual: findKey(sample, [
            "aktual",
            "produksi_aktual",
            "produksi_ton",
            "produksi",
            "y",
            "actual"
        ]),

        forecast: findKey(sample, [
            "prediksi",
            "forecast",
            "hasil_prediksi",
            "prediksi_produksi",
            "forecast_value"
        ]),

        lower: findKey(sample, [
            "lower",
            "batas_bawah",
            "lower_bound"
        ]),

        upper: findKey(sample, [
            "upper",
            "batas_atas",
            "upper_bound"
        ])
    };
}


function populateForecastCommodity() {

    const dropdown = document.getElementById(
        "forecastKomoditas"
    );

    if (!dropdown || !forecastingData.length) return;

    const columns = getForecastColumns();

    if (!columns.commodity) return;

    const commodities = [
        ...new Set(
            forecastingData
                .map(row => row[columns.commodity])
                .filter(Boolean)
        )
    ];

    const currentValue = dropdown.value;

    dropdown.innerHTML = `
        <option value="">Semua Komoditas</option>
        ${commodities.map(name => `
            <option value="${escapeHTML(name)}">
                ${escapeHTML(name)}
            </option>
        `).join("")}
    `;

    if (commodities.includes(currentValue)) {
        dropdown.value = currentValue;
    }

    selectedForecastCommodity = dropdown.value;
}


function renderForecastChart(commodity = "") {

    const canvas = document.getElementById("forecastingChart") ||
        document.getElementById("predictionChart");

    if (!canvas) return;

    const columns = getForecastColumns();

    if (!columns.date || (!columns.actual && !columns.forecast)) {
        destroyChart(canvas.id);

        setText(
            "forecastingSummary",
            "Kolom periode dan nilai aktual/prediksi tidak ditemukan pada dataset forecasting."
        );

        return;
    }

    let rows = [...forecastingData];

    if (commodity && columns.commodity) {
        rows = rows.filter(
            row => String(row[columns.commodity]) === String(commodity)
        );
    }

    rows.sort((a, b) => {
        return String(a[columns.date]).localeCompare(
            String(b[columns.date])
        );
    });

    const labels = rows.map(row => row[columns.date]);

    const actualValues = columns.actual
        ? rows.map(row => toNumber(row[columns.actual]))
        : rows.map(() => null);

    const forecastValues = columns.forecast
        ? rows.map(row => toNumber(row[columns.forecast]))
        : rows.map(() => null);

    const datasets = [];

    if (columns.actual) {
        datasets.push({
            label: "Aktual",
            data: actualValues,
            borderColor: "#265322",
            backgroundColor: "rgba(38,83,34,0.08)",
            borderWidth: 3,
            pointRadius: 3,
            tension: 0.3,
            spanGaps: false
        });
    }

    if (columns.forecast) {
        datasets.push({
            label: "Prediksi",
            data: forecastValues,
            borderColor: "#ffcc00",
            backgroundColor: "rgba(255,204,0,0.08)",
            borderWidth: 3,
            borderDash: [7, 5],
            pointRadius: 3,
            tension: 0.3,
            spanGaps: false
        });
    }

    createChart(canvas.id, {
        type: "line",
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index"
            },
            plugins: {
                legend: chartLegend()
            },
            scales: chartScales()
        }
    });

    const actualCount = actualValues.filter(
        value => value !== null
    ).length;

    const forecastCount = forecastValues.filter(
        value => value !== null
    ).length;

    setText(
        "forecastingSummary",
        `${rows.length} data | ${actualCount} data aktual | ${forecastCount} data prediksi`
    );

    renderForecastRisk(rows, columns);
}


function renderForecastRisk(rows, columns) {

    const container = document.getElementById("riskList");

    if (!container) return;

    const hasRiskColumns = columns.lower || columns.upper;

    if (!hasRiskColumns) {
        container.innerHTML = `
            <p>
                Dataset tidak menyediakan kolom batas risiko.
            </p>
        `;
        return;
    }

    container.innerHTML = rows.slice(-5).map(row => {

        const lower = columns.lower
            ? toNumber(row[columns.lower])
            : null;

        const upper = columns.upper
            ? toNumber(row[columns.upper])
            : null;

        return `
            <div class="risk-item">
                <strong>${escapeHTML(row[columns.date])}</strong>
                <span>
                    Batas bawah: ${formatNumber(lower)}
                    |
                    Batas atas: ${formatNumber(upper)}
                </span>
            </div>
        `;
    }).join("");
}


// Ketika komoditas forecasting dipilih
function setupForecastFilter() {

    const dropdown = document.getElementById(
        "forecastKomoditas"
    );

    if (!dropdown || dropdown.dataset.listenerAdded) return;

    dropdown.addEventListener("change", () => {
        selectedForecastCommodity = dropdown.value;
        renderForecastChart(dropdown.value);
    });

    dropdown.dataset.listenerAdded = "true";
}


// Tombol muat ulang forecasting
function loadForecastingFiltered() {
    const dropdown = document.getElementById("forecastKomoditas");

    renderForecastChart(dropdown?.value || "");
}


/* =========================================================
   19. HARGA PANGAN
========================================================= */

async function loadPriceData() {

    try {
        const response = await apiFetch(
            "/api/v1/harga-pangan"
        );

        const rows = extractPriceRecords(response);

        if (!rows.length) {
            setPriceTableMessage(
                "Data harga belum tersedia."
            );
            destroyChart("priceChart");
            return;
        }

        renderPriceTable(rows);
        renderPriceChart(rows);

        const highest = [...rows]
            .sort((a, b) => {
                const priceA = getPriceValue(a);
                const priceB = getPriceValue(b);

                return (priceB || 0) - (priceA || 0);
            })[0];

        if (highest) {
            setText(
                "hargaTertinggiNama",
                getValue(highest, [
                    "komoditas",
                    "nama_komoditas",
                    "name",
                    "commodity"
                ], "—")
            );

            setText(
                "hargaTertinggiNilai",
                formatCurrency(getPriceValue(highest))
            );
        }

    } catch (error) {
        console.error("Harga pangan:", error);

        setPriceTableMessage(
            `Gagal memuat harga pangan: ${error.message}`
        );

        destroyChart("priceChart");
    }
}


function extractPriceRecords(response) {

    if (Array.isArray(response)) return response;

    if (Array.isArray(response?.data)) return response.data;

    if (Array.isArray(response?.data?.data)) {
        return response.data.data;
    }

    if (Array.isArray(response?.result)) {
        return response.result;
    }

    if (Array.isArray(response?.results)) {
        return response.results;
    }

    return [];
}


function getPriceValue(row) {

    return toNumber(
        getValue(row, [
            "harga",
            "price",
            "harga_konsumen",
            "harga_rata_rata",
            "value"
        ])
    );
}


function formatCurrency(value) {

    if (value === null || value === undefined) return "—";

    return Number(value).toLocaleString("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
    });
}


function setPriceTableMessage(message) {

    const table = document.getElementById("tabelHarga");

    if (!table) return;

    table.innerHTML = `
        <tr>
            <td colspan="5">${escapeHTML(message)}</td>
        </tr>
    `;
}


function renderPriceTable(rows) {

    const table = document.getElementById("tabelHarga");

    if (!table) return;

    table.innerHTML = rows.map(row => {

        const commodity = getValue(row, [
            "komoditas",
            "nama_komoditas",
            "name",
            "commodity"
        ], "—");

        const price = getPriceValue(row);

        const unit = getValue(row, [
            "satuan",
            "unit"
        ], "—");

        const location = getValue(row, [
            "wilayah",
            "kabupaten",
            "kota",
            "location"
        ], "—");

        const date = getValue(row, [
            "tanggal",
            "date",
            "periode"
        ], "—");

        return `
            <tr>
                <td>${escapeHTML(commodity)}</td>
                <td>${formatCurrency(price)}</td>
                <td>${escapeHTML(unit)}</td>
                <td>${escapeHTML(location)}</td>
                <td>${escapeHTML(date)}</td>
            </tr>
        `;
    }).join("");
}


function renderPriceChart(rows) {

    const canvas = document.getElementById("priceChart");

    if (!canvas) return;

    const grouped = {};

    rows.forEach(row => {

        const commodity = getValue(row, [
            "komoditas",
            "nama_komoditas",
            "name",
            "commodity"
        ], "Lainnya");

        const price = getPriceValue(row);

        if (price === null) return;

        grouped[commodity] = price;
    });

    const labels = Object.keys(grouped);

    if (!labels.length) {
        destroyChart("priceChart");
        return;
    }

    createChart("priceChart", {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Harga Pangan (Rp)",
                data: labels.map(label => grouped[label]),
                backgroundColor: [
                    "#265322",
                    "#60982c",
                    "#ffcc00",
                    "#8ab45b",
                    "#d6a900"
                ],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: chartScales()
        }
    });
}


/* =========================================================
   20. DATA CENTER
========================================================= */

async function loadDataCenter() {

    setTableLoading("tabelDataset", 4);
    setTableLoading("tabelHasilModel", 4);

    try {
        const response = await apiFetch(
            "/api/v1/data-center"
        );

        const files = getRecords(response);

        if (!files.length) {
            setTableEmpty(
                "tabelDataset",
                "Belum ada file dataset atau laporan.",
                4
            );

            setTableEmpty(
                "tabelHasilModel",
                "Belum ada file hasil pemodelan.",
                4
            );

            renderReportList([]);
            return;
        }

        const datasets = files.filter(file =>
            String(file.kategori).toLowerCase().includes("dataset")
        );

        const modelFiles = datasets.filter(file =>
            /clustering|rekomendasi|timeseries|comparison/i.test(file.nama)
        );

        const reports = files.filter(file =>
            String(file.kategori).toLowerCase().includes("laporan")
        );

        renderDataCenterTable("tabelDataset", datasets);
        renderDataCenterTable("tabelHasilModel", modelFiles);
        renderReportList(reports);

    } catch (error) {
        console.error("Data Center:", error);

        setTableEmpty(
            "tabelDataset",
            `Gagal memuat data: ${error.message}`,
            4
        );

        setTableEmpty(
            "tabelHasilModel",
            `Gagal memuat data: ${error.message}`,
            4
        );

        renderReportList([]);
    }
}


function renderDataCenterTable(tableId, files) {

    const table = document.getElementById(tableId);

    if (!table) return;

    if (!files.length) {
        setTableEmpty(
            tableId,
            "Tidak ada file pada kategori ini.",
            4
        );
        return;
    }

    table.innerHTML = files.map(file => `
        <tr>
            <td>${escapeHTML(file.nama)}</td>
            <td>${escapeHTML(file.kategori)}</td>
            <td>${formatNumber(file.ukuran_kb)} KB</td>
            <td>
                <button
                    type="button"
                    class="green-button"
                    onclick="downloadDataCenter('${escapeHTML(file.endpoint)}')"
                >
                    <i class="fas fa-download"></i>
                    Download
                </button>
            </td>
        </tr>
    `).join("");
}


function renderReportList(files) {

    const container = document.getElementById(
        "daftarLaporan"
    );

    if (!container) return;

    if (!files.length) {
        container.innerHTML =
            "<p>Belum ada laporan CSV.</p>";
        return;
    }

    container.innerHTML = files.map(file => `
        <div class="report-item">
            <div>
                <strong>${escapeHTML(file.nama)}</strong>
                <p>${formatNumber(file.ukuran_kb)} KB</p>
            </div>

            <button
                type="button"
                class="green-button"
                onclick="downloadDataCenter('${escapeHTML(file.endpoint)}')"
            >
                Download
            </button>
        </div>
    `).join("");
}


/* =========================================================
   21. DOWNLOAD FILE DATA CENTER
========================================================= */

function downloadDataCenter(endpoint) {

    if (!endpoint) {
        alert("Endpoint download tidak tersedia.");
        return;
    }

    const url = endpoint.startsWith("http")
        ? endpoint
        : `${API_BASE_URL}${endpoint}`;

    window.open(url, "_blank");
}


// Download laporan berdasarkan nama kategori
function downloadReport(category) {

    const reportFiles = {
        produksi: "output_clustering_pangan.csv",
        harga: "output_rekomendasi_pangan.csv",
        cuaca: "output_timeseries_pangan.csv"
    };

    const filename = reportFiles[category];

    if (!filename) {
        alert("Jenis laporan tidak ditemukan.");
        return;
    }

    const endpoint =
        `/api/v1/data-center/download/dataset_pemodelan/${filename}`;

    downloadDataCenter(endpoint);
}


/* =========================================================
   22. UPLOAD DATASET
========================================================= */

async function uploadDatasetFile(button) {

    const input = document.getElementById("uploadDataset");

    if (!input || !input.files || !input.files.length) {
        alert("Pilih file CSV atau Excel terlebih dahulu.");
        return;
    }

    const file = input.files[0];

    const allowedExtensions = [".csv", ".xlsx", ".xls"];

    const extension = file.name.substring(
        file.name.lastIndexOf(".")
    ).toLowerCase();

    if (!allowedExtensions.includes(extension)) {
        alert("Format file harus CSV atau Excel.");
        return;
    }

    const token = getAuthToken();

    if (!token) {
        alert(
            "Token login tidak ditemukan. Silakan login sebagai admin terlebih dahulu."
        );
        return;
    }

    const formData = new FormData();

    formData.append("file", file);

    const originalText = button?.textContent;

    if (button) {
        button.disabled = true;
        button.textContent = "Mengunggah...";
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/api/v1/tanaman-pangan/upload`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`
                },
                body: formData
            }
        );

        if (!response.ok) {
            let message = `HTTP ${response.status}`;

            try {
                const errorData = await response.json();
                message = errorData.detail || message;
            } catch (_) {}

            throw new Error(message);
        }

        const result = await response.json();

        alert(
            `${result.message}\nTotal data: ${result.total_data}`
        );

        input.value = "";

        await Promise.allSettled([
            loadDashboard(),
            loadMonitoringData(),
            loadDataCenter()
        ]);

    } catch (error) {
        console.error("Upload dataset:", error);

        alert(`Upload gagal: ${error.message}`);

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText || "Upload Dataset";
        }
    }
}


/* =========================================================
   23. AUDIT TRAIL
========================================================= */

async function loadAuditTrail() {

    const table = document.getElementById("tabelAudit");

    if (!table) return;

    setTableLoading("tabelAudit", 4);

    const token = getAuthToken();

    if (!token) {
        setTableEmpty(
            "tabelAudit",
            "Silakan login sebagai admin untuk melihat audit trail.",
            4
        );
        return;
    }

    try {
        const response = await apiFetch(
            "/api/v1/audit-trail",
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const rows = getRecords(response);

        if (!rows.length) {
            setTableEmpty(
                "tabelAudit",
                "Belum ada aktivitas tercatat.",
                4
            );
            return;
        }

        table.innerHTML = rows.map(row => `
            <tr>
                <td>${escapeHTML(row.username ?? "—")}</td>
                <td>${escapeHTML(row.aktivitas ?? "—")}</td>
                <td>${escapeHTML(row.waktu ?? "—")}</td>
                <td>
                    <span class="status normal">Tercatat</span>
                </td>
            </tr>
        `).join("");

    } catch (error) {
        console.error("Audit trail:", error);

        setTableEmpty(
            "tabelAudit",
            `Gagal memuat audit trail: ${error.message}`,
            4
        );
    }
}


/* =========================================================
   24. CUACA DAN EARLY WARNING SYSTEM
========================================================= */

// Backend membutuhkan kode wilayah BMKG (adm4).
// Karena belum ada pemetaan kode kecamatan pada frontend,
// fungsi ini menerima kode wilayah melalui parameter.

async function loadWeather(kodeKecamatan) {

    if (!kodeKecamatan) {
        console.warn(
            "Kode wilayah BMKG belum tersedia."
        );
        return;
    }

    try {
        const response = await apiFetch(
            `/api/v1/cuaca/${encodeURIComponent(kodeKecamatan)}`
        );

        const weather = response.cuaca || {};

        setText(
            "weatherTemperature",
            weather.t !== undefined
                ? `${weather.t}°C`
                : "—"
        );

        setText(
            "weatherHumidity",
            weather.hu !== undefined
                ? `${weather.hu}%`
                : "—"
        );

        setText(
            "weatherCondition",
            weather.weather_desc || weather.weather || "—"
        );

    } catch (error) {
        console.error("Weather:", error);
    }
}


async function loadWeatherWarning(kodeKecamatan) {

    if (!kodeKecamatan) return;

    try {
        const response = await apiFetch(
            `/api/v1/ews-cuaca/${encodeURIComponent(kodeKecamatan)}`
        );

        setText(
            "weatherWarningStatus",
            response.status || "—"
        );

        setText(
            "weatherWarningMessage",
            response.pesan || "—"
        );

    } catch (error) {
        console.error("Weather warning:", error);
    }
}


/* =========================================================
   25. MANUAL FORECASTING FILTER
========================================================= */

function loadForecastingByCommodity() {

    const dropdown = document.getElementById(
        "forecastKomoditas"
    );

    if (!dropdown) return;

    selectedForecastCommodity = dropdown.value;

    renderForecastChart(selectedForecastCommodity);
}


/* =========================================================
   26. SETUP EVENT LISTENERS
========================================================= */

function setupUploadButton() {

    const button = document.getElementById(
        "btnUploadDataset"
    );

    if (!button || button.dataset.listenerAdded) return;

    button.addEventListener("click", function() {
        uploadDatasetFile(this);
    });

    button.dataset.listenerAdded = "true";
}


function setupRefreshButton() {

    const button = document.getElementById(
        "btnRefreshDataCenter"
    );

    if (!button || button.dataset.listenerAdded) return;

    button.addEventListener("click", loadDataCenter);

    button.dataset.listenerAdded = "true";
}


/* =========================================================
   27. INITIALIZE APPLICATION
========================================================= */

document.addEventListener("DOMContentLoaded", async function() {

    console.log("AgriDash frontend initialized.");

    // Dashboard
    await loadDashboard();

    // Monitoring
    await Promise.allSettled([
        loadMonitoringData(),
        loadFilterKecamatan(),
        loadPCA(),
        loadHeatmap()
    ]);

    // Ketahanan Pangan
    await Promise.allSettled([
        loadClustering(),
        loadRecommendations(),
        loadModelComparison()
    ]);

    // Forecasting
    setupForecastFilter();
    await loadForecasting();

    // Data Center
    await loadDataCenter();

    // Event listeners
    setupFilterButton();
    setupUploadButton();
    setupRefreshButton();

});
