
/* ==========================================================
   AGRIDASH V0.5 - FULL SCRIPT.JS
   Kabupaten Kediri
   Frontend: HTML, CSS, JavaScript
   Backend : FastAPI + CSV / Excel
   Map     : Leaflet + GeoJSON
========================================================== */

const API_BASE_URL = "http://127.0.0.1:8000";
const GEOJSON_URL = "./aset/kediri_kecamatan.geojson";
const DEFAULT_ADM4 = "35.06.01.2001";

const chartInstances = {};

let clusteringData = [];
let recommendationData = [];
let forecastingData = [];
let monitoringData = [];
let statusWilayahData = [];
let dashboardRows = [];
let dashboardMetric = "produksi";
let selectedForecastCommodity = "";

let kediriMapInstance = null;
let dashboardMapInstance = null;
let dashboardGeoJsonLayer = null;
let dashboardMapPromise = null;
let kediriGeoJsonLayer = null;
let kediriMapLoading = false;

const CHART_COLORS = [
    "#265322", "#60982c", "#8ab45b",
    "#ffcc00", "#b5ce8c", "#d6a900"
];

const METRICS = {
    produksi: {
        key: "produksi_ton",
        label: "Indikator Produksi Rata-rata (Ton)",
        avg: false
    },
    luas: {
        key: "luas_panen_ha",
        label: "Indikator Luas Panen Rata-rata (Ha)",
        avg: false
    },
    produktivitas: {
        key: "produktivitas_kuintal_ha",
        label: "Produktivitas (Ku/Ha)",
        avg: true
    }
};


/* ==========================================================
   1. HELPER FUNCTIONS
========================================================== */

function formatNumber(value, decimals = 2) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) return "—";

    const number = Number(value);

    if (!Number.isFinite(number)) return "—";

    return number.toLocaleString("id-ID", {
        maximumFractionDigits: decimals
    });
}

function formatCurrency(value) {
    const number = Number(value);

    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(number)
    ) return "—";

    return number.toLocaleString("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
    });
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeKey(value) {
    return String(value ?? "")
        .toLowerCase()
        .trim()
        .replace(/[\s-]+/g, "_");
}

function normalizeRegionName(value) {
    return String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .trim()
        .replace(/^(kecamatan|kec\.?)\s+/i, "")
        .replace(/\s+/g, " ");
}

function findKey(row, candidates) {
    if (!row || typeof row !== "object") return null;

    const keys = Object.keys(row);

    for (const candidate of candidates) {
        const match = keys.find(
            key => normalizeKey(key) === normalizeKey(candidate)
        );

        if (match) return match;
    }

    return null;
}

function getValue(row, candidates, fallback = null) {
    const key = findKey(row, candidates);
    return key ? row[key] : fallback;
}

function toNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) return null;

    const number = Number(
        String(value).replace(",", ".")
    );

    return Number.isFinite(number) ? number : null;
}

function getRecords(response) {
    if (Array.isArray(response)) return response;

    if (!response || typeof response !== "object") {
        return [];
    }

    const keys = [
        "data", "records", "results",
        "items", "rows", "predictions", "hasil"
    ];

    for (const key of keys) {
        if (Array.isArray(response[key])) {
            return response[key];
        }
    }

    return [];
}

function findFirstArray(value, depth = 0) {
    if (Array.isArray(value)) return value;

    if (
        !value ||
        typeof value !== "object" ||
        depth > 5
    ) return [];

    for (const item of Object.values(value)) {
        const result = findFirstArray(item, depth + 1);

        if (result.length) return result;
    }

    return [];
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value ?? "—";
    }
}

function setStatus(id, message, isError = false) {
    const element = document.getElementById(id);

    if (!element) return;

    element.textContent = message;
    element.style.color = isError
        ? "#b91c1c"
        : "#265322";
}

function setTableLoading(id, colspan = 4) {
    const element = document.getElementById(id);

    if (!element) return;

    element.innerHTML = `
        <tr>
            <td colspan="${colspan}" style="text-align:center">
                Memuat data...
            </td>
        </tr>
    `;
}

function setTableEmpty(id, message, colspan = 4) {
    const element = document.getElementById(id);

    if (!element) return;

    element.innerHTML = `
        <tr>
            <td colspan="${colspan}" style="text-align:center">
                ${escapeHTML(message)}
            </td>
        </tr>
    `;
}

async function apiFetch(endpoint, options = {}) {
    let response;

    try {
        response = await fetch(
            `${API_BASE_URL}${endpoint}`,
            options
        );
    } catch (error) {
        throw new Error(
            "Tidak dapat terhubung ke backend FastAPI."
        );
    }

    if (!response.ok) {
        let message = `HTTP ${response.status}`;

        try {
            const data = await response.json();

            if (data.detail) {
                message = typeof data.detail === "string"
                    ? data.detail
                    : JSON.stringify(data.detail);
            }
        } catch (_) {}

        throw new Error(message);
    }

    return response.json();
}

function destroyChart(id) {
    if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
    }
}

function createChart(id, config) {
    const canvas = document.getElementById(id);

    if (!canvas) return null;

    if (typeof Chart === "undefined") {
        console.warn("Chart.js belum dimuat.");
        return null;
    }

    destroyChart(id);

    try {
        chartInstances[id] = new Chart(canvas, config);
        return chartInstances[id];
    } catch (error) {
        console.error("Chart error:", error);
        return null;
    }
}

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
            padding: 18,
            font: chartFont()
        }
    };
}

function chartScales() {
    return {
        x: {
            grid: { display: false },
            ticks: { font: chartFont() }
        },
        y: {
            beginAtZero: true,
            grid: { color: "#edf1eb" },
            ticks: { font: chartFont() }
        }
    };
}

function getAuthToken() {
    return (
        localStorage.getItem("access_token") ||
        localStorage.getItem("token") ||
        sessionStorage.getItem("access_token") ||
        sessionStorage.getItem("token")
    );
}

function setCurrentDate() {
    // calendar.js bertanggung jawab atas tanggal topbar.
    // Fungsi dipertahankan agar pemanggilan lama tidak error.
}


/* ==========================================================
   2. NAVIGATION
========================================================== */

function showPage(pageId, clickedButton = null) {
    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active-page");
    });

    const selectedPage = document.getElementById(pageId);

    if (selectedPage) {
        selectedPage.classList.add("active-page");
    }

    document.querySelectorAll(".menu-item").forEach(menu => {
        menu.classList.remove("active");

        if (
            !clickedButton &&
            (menu.getAttribute("onclick") || "")
                .includes(`'${pageId}'`)
        ) {
            menu.classList.add("active");
        }
    });

    if (clickedButton) {
        clickedButton.classList.add("active");
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    switch (pageId) {
        case "dashboard":
            loadDashboard();
            break;

        case "monitoring":
            loadMonitoring();
            loadHeatmap();
            loadPCA();

            loadStatusWilayah().then(async () => {
                await loadKediriMap();

                if (kediriMapInstance) {
                    requestAnimationFrame(() => {
                        kediriMapInstance.invalidateSize();
                    });
                }
            });

            break;

        case "harga":
            loadPriceData();
            break;

        case "cuaca":
            loadDashboardWeather();
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


/* ==========================================================
   3. DASHBOARD SUMMARY
========================================================== */

async function loadDashboardSummary() {
    try {
        const data = await apiFetch(
            "/api/v1/tanaman-pangan/ringkasan"
        );

        setText(
            "totalProduksi",
            formatNumber(data.total_produksi)
        );

        setText(
            "totalLuasPanen",
            formatNumber(data.total_luas_panen)
        );

        setText(
            "totalProduktivitas",
            formatNumber(data.rata_produktivitas)
        );

        setText(
            "growthProduksi",
            "Agregasi rata-rata komoditas"
        );

        setText(
            "growthLuasPanen",
            "Agregasi rata-rata komoditas"
        );

        setText(
            "growthProduktivitas",
            "Rata-rata produktivitas"
        );

        setStatus(
            "statusAPI",
            `Data berhasil dimuat (${data.total_data} baris).`
        );

        return data;
    } catch (error) {
        console.error("Dashboard:", error);

        setStatus(
            "statusAPI",
            `Gagal memuat data: ${error.message}`,
            true
        );

        return null;
    }
}

async function loadDashboard() {
    setCurrentDate();

    await Promise.allSettled([
        loadDashboardSummary(),
        loadProductionChart(),
        loadTop5Kecamatan(),
        loadDashboardCommodity(),
        loadDashboardClusterSummary(),
        loadDashboardWarning(),
        loadPriceData(),
        loadDashboardWeather(),
        loadDashboardMap()
    ]);
}


/* ==========================================================
   4. DASHBOARD PRODUCTION CHART
========================================================== */

function changeDashboardChart(metric, button) {
    if (!METRICS[metric]) return;

    dashboardMetric = metric;

    document.querySelectorAll(".trend-card .tab")
        .forEach(tab => tab.classList.remove("active"));

    if (button) button.classList.add("active");

    renderProductionChart();
}

async function loadProductionChart() {
    if (!document.getElementById("productionChart")) {
        return;
    }

    try {
        const response = await apiFetch(
            "/api/v1/tanaman-pangan?limit=500"
        );

        dashboardRows = getRecords(response);

        renderProductionChart();
    } catch (error) {
        console.error("Production chart:", error);
        destroyChart("productionChart");
    }
}


function renderProductionChart() {
    const metric = METRICS[dashboardMetric];
    const grouped = {};

    dashboardRows.forEach(row => {
        const name = row.tanaman || "Lainnya";
        const value = toNumber(row[metric.key]);

        if (value === null) return;

        if (!grouped[name]) {
            grouped[name] = { sum: 0, count: 0 };
        }

        grouped[name].sum += value;
        grouped[name].count++;
    });

    const sorted = Object.entries(grouped)
        .map(([name, value]) => ({
            name,
            value: metric.avg
                ? value.sum / value.count
                : value.sum
        }))
        .sort((a, b) => b.value - a.value);

    if (!sorted.length) {
        destroyChart("productionChart");
        return;
    }

    createChart("productionChart", {
        type: "bar",
        data: {
            labels: sorted.map(item => item.name),
            datasets: [{
                label: metric.label,
                data: sorted.map(item => item.value),
                backgroundColor: [
                    "#265322", "#60982c", "#8ab45b",
                    "#d6a900", "#b5ce8c"
                ],
                borderRadius: 7,
                barThickness: 30,
                maxBarThickness: 36
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 100,
            layout: {
                padding: { top: 8, right: 12, bottom: 12 }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context =>
                            `${formatNumber(context.parsed.x)}`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: "#edf1eb" },
                    ticks: {
                        font: { family: "Poppins", size: 11 }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        font: { family: "Poppins", size: 12 }
                    }
                }
            }
        }
    });
}



/* ==========================================================
   5. TOP 5 KECAMATAN
========================================================== */

async function loadTop5Kecamatan() {
    const container = document.getElementById(
        "top5Kecamatan"
    );

    if (!container) return;

    try {
        const response = await apiFetch(
            "/api/v1/rekap-kecamatan"
        );

        const rows = getRecords(response)
            .sort(
                (a, b) =>
                    Number(b.total_produksi || 0) -
                    Number(a.total_produksi || 0)
            )
            .slice(0, 5);

        container.innerHTML = rows.map((item, index) => `
            <div class="rank-row">
                <div class="rank-number">${index + 1}</div>
                <span>${escapeHTML(item.kecamatan)}</span>
                <strong>
                    ${formatNumber(item.total_produksi)} ton
                </strong>
            </div>
        `).join("");
    } catch (error) {
        container.textContent = error.message;
    }
}


/* ==========================================================
   6. KOMODITAS SUMMARY
========================================================== */


async function loadDashboardCommodity() {
    const container = document.getElementById(
        "dashboardKomoditas"
    );

    if (!container) return;

    try {
        const response = await apiFetch(
            "/api/v1/tanaman-pangan?limit=500"
        );

        const rows = getRecords(response);
        const grouped = {};

        rows.forEach(row => {
            const name = row.tanaman || "Lainnya";
            const production = Number(row.produksi_ton) || 0;

            grouped[name] = (grouped[name] || 0) + production;
        });

        const total = Object.values(grouped).reduce(
            (sum, value) => sum + value,
            0
        );

        const sorted = Object.entries(grouped)
            .sort((a, b) => b[1] - a[1]);

        const colors = [
            "#265322",
            "#60982c",
            "#8ab45b",
            "#d6a900",
            "#b5ce8c"
        ];

        container.innerHTML = sorted.map(([name, value], index) => {
            const percentage = total > 0
                ? (value / total) * 100
                : 0;

            return `
                <div class="agri-commodity-item">
                    <div class="agri-commodity-info">
                        <span class="agri-commodity-name">
                            ${escapeHTML(name)}
                        </span>
                        <strong class="agri-commodity-pct">
                            ${formatNumber(percentage, 1)}%
                        </strong>
                    </div>

                    <div class="agri-commodity-track">
                        <div
                            class="agri-commodity-fill"
                            style="
                                width:${percentage.toFixed(2)}%;
                                background:${colors[index % colors.length]};
                            "
                        ></div>
                    </div>
                </div>
            `;
        }).join("");

    } catch (error) {
        container.textContent =
            `Gagal memuat komoditas: ${error.message}`;
    }
}

async function loadDashboardClusterSummary() {
    const container = document.getElementById(
        "dashboardClusterSummary"
    );

    if (!container) return;

    try {
        const response = await apiFetch(
            "/api/v1/monitoring/ringkasan-status"
        );

        container.innerHTML = `
            <p>
                ${response.total_kecamatan} kecamatan,
                ${response.jumlah_potensi_tinggi} potensi tinggi,
                ${response.jumlah_potensi_sedang} potensi sedang,
                ${response.jumlah_potensi_rendah} potensi rendah.
            </p>
        `;
    } catch (error) {
        container.textContent =
            "Ringkasan clustering belum tersedia.";
    }
}

async function loadDashboardWarning() {
    setText("jumlahWilayahWarning", "—");

    setText(
        "statusWilayahWarning",
        "Data EWS belum tersedia"
    );
}


/* ==========================================================
   7. STATUS WILAYAH
========================================================== */

function getStatusColor(status) {
    const text = String(status || "").toLowerCase();

    if (text.includes("tinggi")) return "#2878C8";
    if (text.includes("sedang")) return "#9066B5";
    if (text.includes("rendah")) return "#D95363";

    return "#E5E7EB";
}

function getStatusTextColor(status) {
    const text = String(status || "").toLowerCase();

    return (
        text.includes("tinggi") ||
        text.includes("sedang") ||
        text.includes("rendah")
    ) ? "#FFFFFF" : "#374151";
}

function getSelectedKecamatan() {
    return document.getElementById(
        "filterKecamatan"
    )?.value || "";
}

function findStatusWilayah(name) {
    const key = normalizeRegionName(name);

    return statusWilayahData.find(
        item =>
            normalizeRegionName(item.kecamatan) === key
    ) || null;
}

async function loadStatusWilayah() {
    try {
        const response = await apiFetch(
            "/api/v1/monitoring/status-wilayah"
        );

        statusWilayahData = getRecords(response);

        renderStatusWilayahList(statusWilayahData);

        return statusWilayahData;
    } catch (error) {
        console.error("Status wilayah:", error);

        const container = document.getElementById(
            "statusWilayahList"
        );

        if (container) {
            container.textContent =
                `Gagal memuat status: ${error.message}`;
        }

        return [];
    }
}

function renderStatusWilayahList(rows) {
    const container = document.getElementById(
        "statusWilayahList"
    );

    if (!container) return;

    const selected = normalizeRegionName(
        getSelectedKecamatan()
    );

    const filtered = rows.filter(item =>
        !selected ||
        normalizeRegionName(item.kecamatan) === selected
    );

    if (!filtered.length) {
        container.textContent =
            "Data status wilayah belum tersedia.";
        return;
    }

    const order = {
        "Potensi Tinggi": 0,
        "Potensi Sedang": 1,
        "Potensi Rendah": 2
    };

    const sorted = [...filtered].sort(
        (a, b) =>
            (order[a.status_wilayah] ?? 3) -
            (order[b.status_wilayah] ?? 3) ||
            a.kecamatan.localeCompare(b.kecamatan)
    );

    container.innerHTML = `
        <p style="font-size:12px;color:#64748b">
            ${sorted.length} kecamatan
        </p>

        ${sorted.map(item => `
            <div class="agri-status-row">
                <span>${escapeHTML(item.kecamatan)}</span>

                <span
                    class="agri-status-pill"
                    style="
                        background:${getStatusColor(item.status_wilayah)};
                        color:${getStatusTextColor(item.status_wilayah)};
                    "
                >
                    ${escapeHTML(item.status_wilayah)}
                </span>
            </div>
        `).join("")}
    `;
}


/* ==========================================================
   8. MONITORING WILAYAH
========================================================== */

async function loadMonitoringData(filterKecamatan = "") {
    const table = document.getElementById(
        "tabelMonitoring"
    );

    if (!table) return;

    setTableLoading("tabelMonitoring");

    try {
        const response = await apiFetch(
            "/api/v1/monitoring/status-wilayah"
        );

        monitoringData = getRecords(response);
        statusWilayahData = monitoringData;

        const selected = normalizeRegionName(
            filterKecamatan
        );

        const rows = monitoringData
            .filter(item =>
                !selected ||
                normalizeRegionName(item.kecamatan) === selected
            )
            .sort(
                (a, b) =>
                    (Number(b.total_produksi) || 0) -
                    (Number(a.total_produksi) || 0)
            );

        if (!rows.length) {
            setTableEmpty(
                "tabelMonitoring",
                "Data kecamatan tidak ditemukan."
            );
            return;
        }

        table.innerHTML = rows.map(item => `
            <tr>
                <td>${escapeHTML(item.kecamatan)}</td>
                <td>${formatNumber(item.total_produksi)}</td>
                <td>${formatNumber(item.total_luas_panen)}</td>
                <td>
                    <span
                        class="agri-status-pill"
                        style="
                            background:${getStatusColor(item.status_wilayah)};
                            color:${getStatusTextColor(item.status_wilayah)};
                        "
                    >
                        ${escapeHTML(item.status_wilayah)}
                    </span>
                </td>
            </tr>
        `).join("");

        renderStatusWilayahList(monitoringData);
        highlightKediriSelection(filterKecamatan);
    } catch (error) {
        console.error("Monitoring:", error);

        setTableEmpty(
            "tabelMonitoring",
            `Gagal memuat monitoring: ${error.message}`
        );
    }
}

function loadMonitoring() {
    return loadMonitoringData(
        getSelectedKecamatan()
    );
}

async function loadFilterKecamatan() {
    const dropdown = document.getElementById(
        "filterKecamatan"
    );

    if (!dropdown) return;

    try {
        const response = await apiFetch(
            "/api/v1/kecamatan"
        );

        const rows = getRecords(response);
        const previous = dropdown.value;

        dropdown.innerHTML = `
            <option value="">Semua Kecamatan</option>
        `;

        rows.forEach(item => {
            const name = typeof item === "string"
                ? item
                : item.kecamatan;

            if (!name) return;

            const option = document.createElement("option");
            option.value = name;
            option.textContent = name;

            dropdown.appendChild(option);
        });

        if ([...dropdown.options].some(
            option => option.value === previous
        )) {
            dropdown.value = previous;
        }
    } catch (error) {
        console.error("Filter kecamatan:", error);
    }
}


/* ==========================================================
   9. PETA KABUPATEN KEDIRI
========================================================== */

function getGeoKecamatanName(feature) {
    const props = feature?.properties || {};

    const candidates = [
        "WADMKC",
        "wadmkc",
        "KECAMATAN",
        "kecamatan",
        "NAMOBJ",
        "namobj",
        "NAMKEC",
        "namkec",
        "nama_kecamatan",
        "name",
        "NAME"
    ];

    for (const key of candidates) {
        if (
            props[key] !== undefined &&
            props[key] !== null &&
            String(props[key]).trim()
        ) {
            return String(props[key]).trim();
        }
    }

    return "Tidak diketahui";
}

function highlightKediriSelection(selectedName = "") {
    if (!kediriGeoJsonLayer) return;

    const selected = normalizeRegionName(selectedName);

    kediriGeoJsonLayer.eachLayer(layer => {
        const name = getGeoKecamatanName(layer.feature);
        const item = findStatusWilayah(name);

        const active = selected &&
            normalizeRegionName(name) === selected;

        layer.setStyle({
            color: active ? "#f59e0b" : "#ffffff",
            weight: active ? 3.5 : 1.5,
            fillColor: getStatusColor(
                item?.status_wilayah
            ),
            fillOpacity: active ? 0.95 : 0.8
        });

        if (active) layer.bringToFront();
    });
}

async function loadKediriMap() {
    const container = document.getElementById(
        "kediriMap"
    );

    if (!container) return;

    if (typeof L === "undefined") {
        container.textContent =
            "Leaflet belum dimuat. Periksa index.html.";
        return;
    }

    if (kediriMapLoading) return;

    kediriMapLoading = true;

    try {
        if (!statusWilayahData.length) {
            await loadStatusWilayah();
        }

        const response = await fetch(GEOJSON_URL);

        if (!response.ok) {
            throw new Error(
                "GeoJSON Kediri belum ditemukan di " +
                GEOJSON_URL
            );
        }

        const geojson = await response.json();

        if (
            !geojson ||
            !["Feature", "FeatureCollection"]
                .includes(geojson.type)
        ) {
            throw new Error(
                "Format GeoJSON tidak valid."
            );
        }

        if (!kediriMapInstance) {
            kediriMapInstance = L.map(
                "kediriMap",
                { scrollWheelZoom: false }
            ).setView([-7.82, 112.02], 10);

            L.tileLayer(
                "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                {
                    maxZoom: 19,
                    attribution: "&copy; OpenStreetMap contributors"
                }
            ).addTo(kediriMapInstance);
        }

        if (kediriGeoJsonLayer) {
            kediriMapInstance.removeLayer(
                kediriGeoJsonLayer
            );
        }

        kediriGeoJsonLayer = L.geoJSON(geojson, {
            style(feature) {
                const name = getGeoKecamatanName(feature);
                const item = findStatusWilayah(name);

                return {
                    color: "#ffffff",
                    weight: 1.5,
                    fillColor: getStatusColor(
                        item?.status_wilayah
                    ),
                    fillOpacity: 0.8
                };
            },

            onEachFeature(feature, layer) {
                const name = getGeoKecamatanName(feature);
                const item = findStatusWilayah(name);

                layer.bindPopup(`
                    <div style="min-width:210px;line-height:1.8">
                        <strong>${escapeHTML(name)}</strong>
                        <br>

                        <b>Status:</b>
                        ${escapeHTML(
                            item?.status_wilayah ||
                            "Belum Dikategorikan"
                        )}
                        <br>

                        <b>Indikator Produksi:</b>
                        ${formatNumber(item?.total_produksi)} ton
                        <br>

                        <b>Indikator Luas:</b>
                        ${formatNumber(item?.total_luas_panen)} ha
                        <br>

                        <b>Produktivitas:</b>
                        ${formatNumber(
                            item?.rata_produktivitas
                        )} ku/ha
                    </div>
                `);

                layer.on("mouseover", () => {
                    layer.setStyle({
                        weight: 3,
                        fillOpacity: 0.95
                    });
                });

                layer.on("mouseout", () => {
                    highlightKediriSelection(
                        getSelectedKecamatan()
                    );
                });

                layer.on("click", () => {
                    const dropdown = document.getElementById(
                        "filterKecamatan"
                    );

                    if (!dropdown) return;

                    const option = [...dropdown.options].find(
                        opt =>
                            normalizeRegionName(opt.value) ===
                            normalizeRegionName(name)
                    );

                    if (option) {
                        dropdown.value = option.value;
                        loadMonitoring();
                    }
                });
            }
        }).addTo(kediriMapInstance);

        const bounds = kediriGeoJsonLayer.getBounds();

        if (bounds.isValid()) {
            kediriMapInstance.fitBounds(bounds, {
                padding: [12, 12]
            });
        }

        highlightKediriSelection(
            getSelectedKecamatan()
        );

        requestAnimationFrame(() => {
            kediriMapInstance.invalidateSize();
        });

    } catch (error) {
        console.error("Peta Kediri:", error);

        if (!kediriMapInstance) {
            container.textContent =
                `Gagal memuat peta: ${error.message}`;
        }
    } finally {
        kediriMapLoading = false;
    }
}

/* ==================================================
   PETA STATUS WILAYAH - DASHBOARD
================================================== */

async function loadDashboardMap() {
    const container = document.getElementById("dashboardKediriMap");

    if (!container) {
        console.error("Container dashboardKediriMap tidak ditemukan.");
        return;
    }

    if (typeof L === "undefined") {
        container.textContent = "Gagal menampilkan peta: Leaflet belum dimuat.";
        return;
    }

    if (dashboardMapPromise) return dashboardMapPromise;

    dashboardMapPromise = (async () => {
        try {
            const [statusResponse, geoResponse] = await Promise.all([
                apiFetch("/api/v1/monitoring/status-wilayah"),
                fetch(GEOJSON_URL)
            ]);

            if (!geoResponse.ok) {
                throw new Error(
                    `File GeoJSON tidak ditemukan (HTTP ${geoResponse.status}). ` +
                    `Periksa path: ${GEOJSON_URL}`
                );
            }

            const geojson = await geoResponse.json();
            const rows = getRecords(statusResponse);

            if (!["FeatureCollection", "Feature"].includes(geojson?.type)) {
                throw new Error("Isi file bukan GeoJSON yang valid.");
            }

            const statusMap = new Map();

            rows.forEach(item => {
                statusMap.set(
                    normalizeRegionName(item.kecamatan),
                    item
                );
            });

            if (!dashboardMapInstance) {
                dashboardMapInstance = L.map(container, {
                    zoomControl: true,
                    scrollWheelZoom: false
                });

                L.tileLayer(
                    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    {
                        maxZoom: 19,
                        attribution: "&copy; OpenStreetMap contributors"
                    }
                ).addTo(dashboardMapInstance);
            }

            if (dashboardGeoJsonLayer) {
                dashboardMapInstance.removeLayer(dashboardGeoJsonLayer);
            }

            dashboardGeoJsonLayer = L.geoJSON(geojson, {
                style(feature) {
                    const name = getGeoKecamatanName(feature);
                    const item = statusMap.get(normalizeRegionName(name));

                    return {
                        color: "#ffffff",
                        weight: 1.2,
                        fillColor: getStatusColor(item?.status_wilayah),
                        fillOpacity: 0.85
                    };
                },

                onEachFeature(feature, layer) {
                    const name = getGeoKecamatanName(feature);
                    const item = statusMap.get(normalizeRegionName(name));

                    layer.bindPopup(`
                        <div style="line-height:1.8;min-width:180px">
                            <strong>Kecamatan ${escapeHTML(name)}</strong>
                            <br>
                            Status: ${escapeHTML(
                                item?.status_wilayah || "Belum Ada Data"
                            )}
                            <br>
                            Indikator Produksi:
                            ${formatNumber(item?.total_produksi)} ton
                            <br>
                            Indikator Luas:
                            ${formatNumber(item?.total_luas_panen)} ha
                        </div>
                    `);

                    layer.on("mouseover", () => {
                        layer.setStyle({
                            color: "#334155",
                            weight: 2.5,
                            fillOpacity: 1
                        });
                    });

                    layer.on("mouseout", () => {
                        dashboardGeoJsonLayer.resetStyle(layer);
                    });
                }
            }).addTo(dashboardMapInstance);

            const bounds = dashboardGeoJsonLayer.getBounds();

            if (!bounds.isValid()) {
                throw new Error(
                    "GeoJSON tidak memiliki koordinat poligon yang valid."
                );
            }

            dashboardMapInstance.fitBounds(bounds, {
                padding: [12, 12]
            });

            requestAnimationFrame(() => {
                dashboardMapInstance.invalidateSize();
                dashboardMapInstance.fitBounds(bounds, {
                    padding: [12, 12]
                });
            });

            console.log("Peta Dashboard berhasil dimuat:", {
                features: dashboardGeoJsonLayer.getLayers().length,
                statusWilayah: rows.length
            });

        } catch (error) {
            console.error("Error Peta Dashboard:", error);

            if (dashboardMapInstance) {
                dashboardMapInstance.remove();
                dashboardMapInstance = null;
                dashboardGeoJsonLayer = null;
            }

            container.innerHTML = `
                <div style="
                    padding:18px;
                    font-size:13px;
                    color:#b91c1c;
                    background:#fff1f2;
                    border-radius:12px;
                ">
                    ${escapeHTML(error.message)}
                </div>
            `;
        }
    })();

    try {
        await dashboardMapPromise;
    } finally {
        dashboardMapPromise = null;
    }
}

/* ==========================================================
   10. HEATMAP KECAMATAN
========================================================== */

/* ==========================================================
   HEATMAP PRODUKSI KOMODITAS
   Warna: Merah - Ungu - Biru
========================================================== */

async function loadHeatmap() {
    const container = document.getElementById(
        "heatmapKecamatan"
    );

    if (!container) return;

    container.innerHTML = "<p>Memuat heatmap produksi...</p>";

    try {
        const response = await apiFetch(
            "/api/v1/model/heatmap-kecamatan"
        );

        const allRows = getRecords(response);
        const kecamatanCol = response.kecamatan_column;

        // Kolom komoditas yang benar-benar ada
        const commodities = [
            "Kacang Tanah",
            "Kedelai",
            "Ketela Pohon",
            "Padi",
            "Ubi Jalar"
        ].filter(col =>
            allRows.some(row =>
                Object.prototype.hasOwnProperty.call(row, col)
            )
        );

        if (!allRows.length || !kecamatanCol || !commodities.length) {
            container.innerHTML =
                "<p>Data heatmap produksi belum tersedia.</p>";
            return;
        }

        // Mengikuti filter kecamatan
        const selectedKecamatan = document.getElementById(
            "filterKecamatan"
        )?.value || "";

        const selectedKomoditas = document.getElementById(
            "filterKomoditas"
        )?.value || "";

        const visibleColumns = selectedKomoditas &&
            commodities.includes(selectedKomoditas)
                ? [selectedKomoditas]
                : commodities;

        const rows = allRows.filter(row =>
            !selectedKecamatan ||
            normalizeRegionName(row[kecamatanCol]) ===
            normalizeRegionName(selectedKecamatan)
        );

        // Hitung min/max dari keseluruhan kecamatan,
        // agar warna konsisten meskipun filter berubah.
        const stats = {};

        visibleColumns.forEach(col => {
            const values = allRows
                .map(row => toNumber(row[col]))
                .filter(value => value !== null);

            stats[col] = {
                min: Math.min(...values),
                max: Math.max(...values)
            };
        });

        function interpolateColor(colorA, colorB, ratio) {
            const t = Math.max(0, Math.min(1, ratio));

            const a = colorA.match(/\w\w/g).map(
                x => parseInt(x, 16)
            );

            const b = colorB.match(/\w\w/g).map(
                x => parseInt(x, 16)
            );

            const result = a.map((value, i) =>
                Math.round(value + (b[i] - value) * t)
            );

            return `rgb(${result.join(",")})`;
        }

        function getHeatmapColor(value, min, max) {
            if (value === null) return "#E5E7EB";

            if (max === min) return "#9066B5";

            const normalized = (value - min) / (max - min);

            if (normalized <= 0.5) {
                return interpolateColor(
                    "D95363",
                    "9066B5",
                    normalized * 2
                );
            }

            return interpolateColor(
                "9066B5",
                "2878C8",
                (normalized - 0.5) * 2
            );
        }

        function getContrastColor(value, min, max) {
            if (value === null) return "#374151";
            return "#FFFFFF";
        }

        if (!rows.length) {
            container.innerHTML =
                "<p>Data kecamatan yang dipilih tidak ditemukan.</p>";
            return;
        }

        const tableRows = rows.map(row => `
            <tr>
                <td class="heatmap-kecamatan-name">
                    ${escapeHTML(row[kecamatanCol])}
                </td>

                ${visibleColumns.map(col => {
                    const value = toNumber(row[col]);

                    const min = stats[col].min;
                    const max = stats[col].max;

                    const color = getHeatmapColor(
                        value, min, max
                    );

                    const textColor = getContrastColor(
                        value, min, max
                    );

                    return `
                        <td
                            class="heatmap-value-cell"
                            style="
                                background:${color};
                                color:${textColor};
                            "
                            title="${escapeHTML(col)}: ${formatNumber(value)}"
                        >
                            ${formatNumber(value)}
                        </td>
                    `;
                }).join("")}
            </tr>
        `).join("");

        container.innerHTML = `
            <div class="heatmap-explanation">
                <span>Perbandingan produksi rata-rata antar-kecamatan</span>

                <div class="heatmap-color-legend">
                    <span>Rendah</span>
                    <div class="heatmap-gradient"></div>
                    <span>Tinggi</span>
                </div>
            </div>

            <div class="table-responsive">
                <table class="heatmap-table">
                    <thead>
                        <tr>
                            <th>Kecamatan</th>
                            ${visibleColumns.map(col => `
                                <th>${escapeHTML(col)}</th>
                            `).join("")}
                        </tr>
                    </thead>

                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>

            <p class="heatmap-note">
                Warna dihitung relatif terhadap rentang produksi
                tiap komoditas. Merah menunjukkan nilai relatif
                rendah, ungu sedang, dan biru relatif tinggi.
            </p>
        `;

    } catch (error) {
        console.error("Heatmap:", error);

        container.innerHTML = `
            <p style="color:#b91c1c">
                Gagal memuat heatmap:
                ${escapeHTML(error.message)}
            </p>
        `;
    }
}


/* ==========================================================
   11. PCA CLUSTERING
========================================================== */

async function loadPCA() {
    if (!document.getElementById("pcaChart")) return;

    try {
        const response = await apiFetch(
            "/api/v1/model/pca"
        );

        const rows = getRecords(response);

        if (!rows.length) return;

        const groups = {};

        rows.forEach(row => {
            const cluster = row.cluster ?? "Unknown";

            if (!groups[cluster]) groups[cluster] = [];

            groups[cluster].push({
                x: Number(row.pca_1),
                y: Number(row.pca_2),
                kecamatan: row.kecamatan
            });
        });

        const datasets = Object.entries(groups)
            .map(([cluster, points], index) => ({
                label: `Cluster ${cluster}`,
                data: points,
                backgroundColor:
                    CHART_COLORS[index % CHART_COLORS.length],
                pointRadius: 6
            }));

        createChart("pcaChart", {
            type: "scatter",
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: chartLegend()
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Principal Component 1"
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: "Principal Component 2"
                        }
                    }
                }
            }
        });

        setText(
            "pcaClusterSummary",
            `${rows.length} kecamatan | ` +
            `${Object.keys(groups).length} cluster`
        );
    } catch (error) {
        console.error("PCA:", error);

        setText(
            "pcaClusterSummary",
            `Gagal memuat PCA: ${error.message}`
        );
    }
}


/* ==========================================================
   KETAHANAN PANGAN - CLUSTERING INFORMATION
========================================================== */

const CLUSTER_COLORS = [
    "#2878C8",
    "#9066B5",
    "#D95363",
    "#E5A624"
];

const CLUSTER_COMMODITIES = [
    "Kacang Tanah",
    "Kedelai",
    "Ketela Pohon",
    "Padi",
    "Ubi Jalar"
];

function getClusterDetails(rows, clusterCol) {
    const groups = {};

    rows.forEach(row => {
        const id = String(row[clusterCol] ?? "Tidak diketahui");

        if (!groups[id]) groups[id] = [];
        groups[id].push(row);
    });

    return Object.entries(groups)
        .sort((a, b) => a[0].localeCompare(b[0], "id", {
            numeric: true
        }))
        .map(([id, members]) => {

            // Label status dari model, bukan asumsi berdasarkan ID
            const labels = [
                ...new Set(
                    members
                        .map(row => row.label_cluster)
                        .filter(Boolean)
                )
            ];

            // Rata-rata total produksi kelompok
            const productionValues = members
                .map(row => toNumber(row.total_produksi_mean))
                .filter(value => value !== null);

            const averageProduction = productionValues.length
                ? productionValues.reduce((a, b) => a + b, 0)
                  / productionValues.length
                : null;

            // Rata-rata produksi masing-masing komoditas
            const commodityScores = CLUSTER_COMMODITIES.map(name => {
                const values = members
                    .map(row => toNumber(row[name]))
                    .filter(value => value !== null);

                return {
                    name,
                    mean: values.length
                        ? values.reduce((a, b) => a + b, 0)
                          / values.length
                        : null
                };
            });

            const dominant = commodityScores
                .filter(item => item.mean !== null)
                .sort((a, b) => b.mean - a.mean)[0];

            return {
                id,
                members,
                count: members.length,
                percentage: rows.length
                    ? members.length / rows.length * 100
                    : 0,
                label: labels.length === 1
                    ? labels[0]
                    : labels.length > 1
                        ? "Label bervariasi"
                        : "Belum Dikategorikan",
                averageProduction,
                dominantCommodity: dominant?.name || "Tidak tersedia",
                kecamatan: members
                    .map(row => row.kecamatan)
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b, "id"))
            };
        });
}

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

        const clusterCol =
            response.cluster_column || "cluster_id";

        const details = getClusterDetails(
            clusteringData,
            clusterCol
        );

        // KPI
        setText("jumlahCluster", details.length);
        setText("jumlahKecamatanCluster", clusteringData.length);
        setText("metodeClustering", "K-Means");

        // Visualisasi
        renderClusterDistribution(details);
        renderClusterDescription(details);

        // Tabel hasil clustering
        const tableRows = clusteringData.map(row => {
            const commodity = CLUSTER_COMMODITIES
                .map(name => ({
                    name,
                    value: toNumber(row[name])
                }))
                .filter(item => item.value !== null)
                .sort((a, b) => b.value - a.value)[0];

            return {
                kecamatan: row.kecamatan,
                cluster: row[clusterCol],
                status: row.label_cluster || "—",
                komoditas: commodity?.name || "—",
                produksi: toNumber(row.total_produksi_mean)
            };
        });

        const table = document.getElementById("tabelCluster");

        if (table) {
            const head = table.closest("table")
                ?.querySelector("thead tr");

            if (head) {
                head.innerHTML = `
                    <th>Kecamatan</th>
                    <th>Cluster</th>
                    <th>Kategori Potensi</th>
                    <th>Komoditas Dominan</th>
                    <th>Rerata Produksi (Ton)</th>
                `;
            }

            table.innerHTML = tableRows.map(row => `
                <tr>
                    <td>
                        <strong>${escapeHTML(row.kecamatan)}</strong>
                    </td>
                    <td>
                        <span class="cluster-id-pill">
                            Cluster ${escapeHTML(row.cluster)}
                        </span>
                    </td>
                    <td>${escapeHTML(row.status)}</td>
                    <td>${escapeHTML(row.komoditas)}</td>
                    <td>${formatNumber(row.produksi)}</td>
                </tr>
            `).join("");
        }

    } catch (error) {
        console.error("Clustering:", error);

        setTableEmpty(
            "tabelCluster",
            `Gagal memuat clustering: ${error.message}`,
            5
        );
    }
}


/* ==========================================================
   DISTRIBUSI CLUSTER
========================================================== */

function renderClusterDistribution(details) {
    const labels = details.map(
        item => `Cluster ${item.id}`
    );

    const values = details.map(item => item.count);

    createChart("clusterDistributionChart", {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: CLUSTER_COLORS,
                borderColor: "#FFFFFF",
                borderWidth: 3,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "68%",
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        usePointStyle: true,
                        padding: 18,
                        font: {
                            family: "Poppins",
                            size: 12
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const item = details[context.dataIndex];

                            return [
                                `${item.count} kecamatan`,
                                `${formatNumber(item.percentage, 1)}% dari wilayah`,
                                `Potensi: ${item.label}`
                            ];
                        }
                    }
                }
            }
        }
    });
}


/* ==========================================================
   KARAKTERISTIK SETIAP CLUSTER
========================================================== */

function renderClusterDescription(details) {
    const container = document.getElementById(
        "clusterDescription"
    );

    if (!container) return;

    container.innerHTML = details.map((item, index) => `
        <div class="cluster-info-card">

            <div class="cluster-info-header">
                <div class="cluster-info-title">
                    <span
                        class="cluster-color-dot"
                        style="background:${CLUSTER_COLORS[index % CLUSTER_COLORS.length]}"
                    ></span>

                    <strong>Cluster ${escapeHTML(item.id)}</strong>
                </div>

                <span class="cluster-count-badge">
                    ${item.count} kecamatan
                </span>
            </div>

            <div class="cluster-info-stats">
                <div>
                    <small>Proporsi Wilayah</small>
                    <strong>${formatNumber(item.percentage, 1)}%</strong>
                </div>

                <div>
                    <small>Rerata Total Produksi</small>
                    <strong>
                        ${formatNumber(item.averageProduction)} ton
                    </strong>
                </div>
            </div>

            <div class="cluster-info-details">
                <p>
                    <span>Kategori Model</span>
                    <strong>${escapeHTML(item.label)}</strong>
                </p>

                <p>
                    <span>Produksi Dominan</span>
                    <strong>${escapeHTML(item.dominantCommodity)}</strong>
                </p>
            </div>

            <details class="cluster-members">
                <summary>Lihat kecamatan anggota</summary>

                <p>
                    ${item.kecamatan
                        .map(name => escapeHTML(name))
                        .join(", ")}
                </p>
            </details>

        </div>
    `).join("");
}



/* ==========================================================
   13. GENERIC TABLE
========================================================== */

function renderGenericTable(id, rows, headers = []) {
    const table = document.getElementById(id);

    if (!table) return;

    if (!rows.length) {
        setTableEmpty(
            id,
            "Data belum tersedia.",
            headers.length || 4
        );
        return;
    }

    if (!headers.length) {
        headers = Object.keys(rows[0]);
    }

    const head = table.closest("table")
        ?.querySelector("thead tr");

    if (head) {
        head.innerHTML = headers.map(header => `
            <th>${escapeHTML(header)}</th>
        `).join("");
    }

    table.innerHTML = rows.map(row => `
        <tr>
            ${headers.map(header => {
                const value = row[header];

                return `
                    <td>
                        ${escapeHTML(
                            typeof value === "number"
                                ? formatNumber(value)
                                : value ?? "—"
                        )}
                    </td>
                `;
            }).join("")}
        </tr>
    `).join("");
}


/* ==========================================================
   14. REKOMENDASI KOMODITAS
========================================================== */

async function loadRecommendations() {
    setTableLoading("tabelRekomendasi");

    try {
        const response = await apiFetch(
            "/api/v1/model/rekomendasi"
        );

        recommendationData = getRecords(response);

        if (!recommendationData.length) {
            setTableEmpty(
                "tabelRekomendasi",
                "Rekomendasi belum tersedia."
            );
            return;
        }

        renderGenericTable(
            "tabelRekomendasi",
            recommendationData,
            [
                "kecamatan",
                "tanaman",
                "rank",
                "skor_rekomendasi"
            ]
        );
    } catch (error) {
        console.error("Rekomendasi:", error);

        setTableEmpty(
            "tabelRekomendasi",
            error.message
        );
    }
}


/* ==========================================================
   15. MODEL COMPARISON
========================================================== */

async function loadModelComparison() {
    try {
        const response = await apiFetch(
            "/api/v1/model/comparison"
        );

        const rows = getRecords(response);

        renderGenericTable(
            "tabelPerbandinganModel",
            rows,
            [
                "kecamatan",
                "tanaman",
                "target",
                "best_model"
            ]
        );
    } catch (error) {
        console.error("Model comparison:", error);

        setTableEmpty(
            "tabelPerbandinganModel",
            error.message
        );
    }
}


/* ==========================================================
   16. FORECASTING
   CSV:
   Tahun, kecamatan, tanaman, nilai,
   target, model_digunakan, tipe
========================================================== */

async function loadForecasting() {
    try {
        const response = await apiFetch(
            "/api/v1/model/forecasting"
        );

        forecastingData = getRecords(response);

        if (!forecastingData.length) {
            setText(
                "forecastingSummary",
                "Data forecasting belum tersedia."
            );
            return;
        }

        populateForecastCommodity();
        renderForecastChart();
    } catch (error) {
        console.error("Forecasting:", error);

        setText(
            "forecastingSummary",
            error.message
        );
    }
}

function getForecastColumns() {
    if (!forecastingData.length) return {};

    const row = forecastingData[0];

    return {
        commodity: findKey(row, [
            "tanaman", "komoditas"
        ]),
        kecamatan: findKey(row, [
            "kecamatan", "wilayah"
        ]),
        date: findKey(row, [
            "Tahun", "tahun", "periode", "tanggal"
        ]),
        value: findKey(row, [
            "nilai", "value"
        ]),
        type: findKey(row, [
            "tipe", "type"
        ]),
        target: findKey(row, [
            "target"
        ]),
        actual: findKey(row, [
            "aktual", "actual"
        ]),
        forecast: findKey(row, [
            "prediksi", "forecast"
        ])
    };
}

function populateForecastCommodity() {
    const dropdown = document.getElementById(
        "forecastKomoditas"
    );

    if (!dropdown) return;

    const cols = getForecastColumns();

    if (!cols.commodity) return;

    const commodities = [
        ...new Set(
            forecastingData.map(
                row => row[cols.commodity]
            ).filter(Boolean)
        )
    ].sort();

    const previous = dropdown.value;

    dropdown.innerHTML = `
        <option value="">Semua Komoditas</option>
        ${commodities.map(item => `
            <option value="${escapeHTML(item)}">
                ${escapeHTML(item)}
            </option>
        `).join("")}
    `;

    if (commodities.includes(previous)) {
        dropdown.value = previous;
    }
}

function renderForecastChart(commodity = "") {
    const canvas =
        document.getElementById("forecastingChart") ||
        document.getElementById("predictionChart");

    if (!canvas || !forecastingData.length) return;

    const cols = getForecastColumns();

    if (!cols.date) {
        setText(
            "forecastingSummary",
            "Kolom tahun tidak ditemukan."
        );
        return;
    }

    let rows = [...forecastingData];

    const selectedCommodity =
        commodity ||
        document.getElementById("forecastKomoditas")?.value ||
        "";

    if (selectedCommodity && cols.commodity) {
        rows = rows.filter(
            row => String(row[cols.commodity]) ===
                selectedCommodity
        );
    }

    // Hindari mencampur produksi, luas, dan
    // produktivitas dalam satu grafik.
    if (cols.target) {
        const available = [
            ...new Set(
                rows.map(row =>
                    String(row[cols.target] || "")
                        .trim()
                        .toLowerCase()
                )
            )
        ];

        const targetProduksi = [
            "produksi_ton",
            "produksi",
            "jumlah_produksi"
        ].find(target => available.includes(target));

        if (!targetProduksi) {
            destroyChart(canvas.id);

            setText(
                "forecastingSummary",
                "Data prediksi produksi tidak tersedia. " +
                "Dataset hanya memuat target: " +
                available.join(", ")
            );

            const riskContainer = document.getElementById("riskList");

            if (riskContainer) {
                riskContainer.textContent =
                    "Indikator perubahan produksi belum dapat dihitung.";
            }

            return;
        }

        rows = rows.filter(row =>
            String(row[cols.target] || "")
                .trim()
                .toLowerCase() === targetProduksi
        );
    }

    // Agregasi data per tahun.
    const grouped = {};

    rows.forEach(row => {
        const year = String(row[cols.date] ?? "");

        if (!year) return;

        if (!grouped[year]) {
            grouped[year] = {
                actual: 0,
                forecast: 0,
                actualCount: 0,
                forecastCount: 0
            };
        }

        if (cols.value && cols.type) {
            const value = toNumber(row[cols.value]);
            const type = String(
                row[cols.type] || ""
            ).toLowerCase();

            if (value === null) return;

            if (
                type.includes("aktual") ||
                type.includes("actual")
            ) {
                grouped[year].actual += value;
                grouped[year].actualCount++;
            } else if (
                type.includes("prediksi") ||
                type.includes("forecast")
            ) {
                grouped[year].forecast += value;
                grouped[year].forecastCount++;
            }
        } else {
            const actual = cols.actual
                ? toNumber(row[cols.actual])
                : null;

            const pred = cols.forecast
                ? toNumber(row[cols.forecast])
                : null;

            if (actual !== null) {
                grouped[year].actual += actual;
                grouped[year].actualCount++;
            }

            if (pred !== null) {
                grouped[year].forecast += pred;
                grouped[year].forecastCount++;
            }
        }
    });

    const labels = Object.keys(grouped).sort(
        (a, b) => Number(a) - Number(b)
    );

    const actualValues = labels.map(year =>
        grouped[year].actualCount
            ? grouped[year].actual
            : null
    );

    const forecastValues = labels.map(year =>
        grouped[year].forecastCount
            ? grouped[year].forecast
            : null
    );

    createChart(canvas.id, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Aktual",
                    data: actualValues,
                    borderColor: "#265322",
                    backgroundColor: "rgba(38,83,34,0.1)",
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 4
                },
                {
                    label: "Prediksi",
                    data: forecastValues,
                    borderColor: "#d6a900",
                    borderDash: [6, 4],
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: chartLegend()
            },
            scales: chartScales()
        }
    });

    setText(
        "forecastingSummary",
        `${rows.length} data forecasting | ` +
        `${labels.length} periode`
    );

    renderForecastRisk(rows, cols);
}


/* ==========================================================
   ANALISIS PERUBAHAN PRODUKSI
   Berbasis data Aktual dan Forecasting
========================================================== */

function renderForecastRisk(rows, cols) {
    const container = document.getElementById("riskList");

    if (!container) return;

    const targetRows = rows.filter(row => {
        const target = String(
            cols.target ? row[cols.target] : ""
        ).trim().toLowerCase();

        return [
            "produksi_ton",
            "produksi",
            "jumlah_produksi"
        ].includes(target);
    });

    if (!targetRows.length || !cols.value || !cols.type) {
        container.innerHTML = `
            <div class="risk-empty">
                <strong>Analisis belum tersedia</strong>
                <p>
                    Dibutuhkan data aktual dan prediksi
                    dengan target produksi yang sama.
                </p>
            </div>
        `;
        return;
    }

    const actualByYear = {};
    const forecastByYear = {};

    targetRows.forEach(row => {
        const year = Number(row[cols.date]);
        const value = toNumber(row[cols.value]);
        const type = String(
            row[cols.type] || ""
        ).trim().toLowerCase();

        if (!Number.isInteger(year) || value === null) return;

        if (
            type.includes("aktual") ||
            type.includes("actual")
        ) {
            actualByYear[year] =
                (actualByYear[year] || 0) + value;
        }

        if (
            type.includes("prediksi") ||
            type.includes("forecast")
        ) {
            forecastByYear[year] =
                (forecastByYear[year] || 0) + value;
        }
    });

    const actualYears = Object.keys(actualByYear)
        .map(Number)
        .sort((a, b) => b - a);

    const lastActualYear = actualYears[0];

    const forecastYears = Object.keys(forecastByYear)
        .map(Number)
        .filter(year => year > lastActualYear)
        .sort((a, b) => a - b);

    const nextForecastYear = forecastYears[0];

    if (
        lastActualYear === undefined ||
        nextForecastYear === undefined
    ) {
        container.innerHTML = `
            <div class="risk-empty">
                <strong>Perbandingan belum tersedia</strong>
                <p>
                    Data membutuhkan minimal satu periode aktual
                    dan satu periode prediksi setelahnya.
                </p>
            </div>
        `;
        return;
    }

    const actualValue = actualByYear[lastActualYear];
    const forecastValue = forecastByYear[nextForecastYear];

    let percentage = null;

    if (actualValue !== 0) {
        percentage = (
            (forecastValue - actualValue) /
            Math.abs(actualValue)
        ) * 100;
    }

    const isDecrease = percentage !== null && percentage < 0;
    const isIncrease = percentage !== null && percentage > 0;

    let statusLabel = "Produksi Relatif Stabil";
    let statusClass = "risk-stable";
    let statusIcon = "fa-minus";

    if (isDecrease) {
        statusLabel = "Prediksi Produksi Menurun";
        statusClass = "risk-decrease";
        statusIcon = "fa-arrow-trend-down";
    } else if (isIncrease) {
        statusLabel = "Prediksi Produksi Meningkat";
        statusClass = "risk-increase";
        statusIcon = "fa-arrow-trend-up";
    }

    // Perbandingan kecamatan: hanya kecamatan yang
    // memiliki data aktual dan prediksi yang bisa
    // dibandingkan secara berpasangan.
    const kecamatanData = {};

    if (cols.kecamatan) {
        targetRows.forEach(row => {
            const name = String(
                row[cols.kecamatan] || ""
            ).trim();

            const year = Number(row[cols.date]);
            const value = toNumber(row[cols.value]);
            const type = String(
                row[cols.type] || ""
            ).toLowerCase();

            if (!name || value === null) return;

            if (!kecamatanData[name]) {
                kecamatanData[name] = {
                    actual: null,
                    forecast: null
                };
            }

            if (
                year === lastActualYear &&
                (type.includes("aktual") ||
                 type.includes("actual"))
            ) {
                kecamatanData[name].actual =
                    (kecamatanData[name].actual || 0) + value;
            }

            if (
                year === nextForecastYear &&
                (type.includes("prediksi") ||
                 type.includes("forecast"))
            ) {
                kecamatanData[name].forecast =
                    (kecamatanData[name].forecast || 0) + value;
            }
        });
    }

    const comparableRegions = Object.entries(kecamatanData)
        .filter(([_, data]) =>
            data.actual !== null &&
            data.forecast !== null
        );

    const decreasedRegions = comparableRegions
        .filter(([_, data]) =>
            data.forecast < data.actual
        );

    const changeText = percentage === null
        ? "Tidak dapat dihitung"
        : `${percentage > 0 ? "+" : ""}${formatNumber(percentage)}%`;

    const insight = isDecrease
        ? "Hasil model memperkirakan penurunan produksi dibandingkan periode aktual terakhir. Perlu ditinjau bersama data cuaca, luas panen, dan kondisi pertanian setempat."
        : isIncrease
            ? "Hasil model memperkirakan peningkatan produksi dibandingkan periode aktual terakhir. Prediksi tetap perlu dipantau karena dapat berbeda dari realisasi."
            : "Hasil prediksi relatif tidak berubah dari periode aktual terakhir, atau perubahan belum dapat dihitung.";

    container.innerHTML = `
        <div class="risk-analysis">

            <div class="risk-indicator ${statusClass}">
                <i class="fa-solid ${statusIcon}"></i>

                <div>
                    <small>Status Perubahan Produksi</small>
                    <strong>${statusLabel}</strong>
                </div>
            </div>

            <div class="risk-metric-grid">

                <div class="risk-metric">
                    <small>Aktual ${lastActualYear}</small>
                    <strong>
                        ${formatNumber(actualValue)}
                    </strong>
                    <span>ton</span>
                </div>

                <div class="risk-metric">
                    <small>Prediksi ${nextForecastYear}</small>
                    <strong>
                        ${formatNumber(forecastValue)}
                    </strong>
                    <span>ton</span>
                </div>

            </div>

            <div class="risk-change">
                <span>Perubahan Prediksi</span>

                <strong class="${statusClass}">
                    ${changeText}
                </strong>
            </div>

            ${comparableRegions.length ? `
                <div class="risk-regions">
                    <i class="fa-solid fa-location-dot"></i>

                    <span>
                        <strong>${decreasedRegions.length}</strong>
                        dari ${comparableRegions.length}
                        kecamatan yang dapat dibandingkan
                        diprediksi mengalami penurunan.
                    </span>
                </div>
            ` : ""}

            <div class="risk-insight">
                <strong>Interpretasi</strong>
                <p>${insight}</p>
            </div>

            <p class="risk-disclaimer">
                Indikator ini menunjukkan perubahan hasil
                forecasting, bukan peringatan dini resmi.
                Angka hanya dapat dibandingkan secara
                langsung jika cakupan kecamatan dan target
                kedua periode setara.
            </p>

        </div>
    `;
}


function setupForecastFilter() {
    const dropdown = document.getElementById(
        "forecastKomoditas"
    );

    if (!dropdown || dropdown.dataset.listenerAdded) {
        return;
    }

    dropdown.addEventListener("change", () => {
        selectedForecastCommodity = dropdown.value;
        renderForecastChart(dropdown.value);
    });

    dropdown.dataset.listenerAdded = "true";
}


/* ==========================================================
   17. HARGA PANGAN
========================================================== */

function getPriceValue(row) {
    return toNumber(getValue(row, [
        "harga",
        "price",
        "harga_konsumen",
        "harga_rata_rata",
        "value"
    ]));
}

function getPriceName(row) {
    return getValue(row, [
        "komoditas",
        "nama_komoditas",
        "name",
        "commodity"
    ], "—");
}

async function loadPriceData() {
    try {
        const response = await apiFetch(
            "/api/v1/harga-pangan"
        );

        const allRows = findFirstArray(response);

        if (!allRows.length) {
            setTableEmpty(
                "tabelHarga",
                "Data harga pangan belum tersedia.",
                5
            );
            return;
        }

        const highest = [...allRows].sort(
            (a, b) =>
                (getPriceValue(b) || 0) -
                (getPriceValue(a) || 0)
        )[0];

        setText(
            "hargaTertinggiNama",
            getPriceName(highest)
        );

        setText(
            "hargaTertinggiNilai",
            formatCurrency(getPriceValue(highest))
        );

        const filter = document.getElementById(
            "filterHargaKomoditas"
        )?.value || "";

        const rows = allRows.filter(
            row =>
                !filter ||
                String(getPriceName(row))
                    .toLowerCase()
                    .includes(filter.toLowerCase())
        );

        const summary = document.getElementById(
            "hargaSummary"
        );

        if (summary) {
            summary.innerHTML = `
                <p>
                    ${rows.length} data harga tersedia.
                </p>
            `;
        }

        renderPriceTable(rows);
        renderPriceChart(rows);
    } catch (error) {
        console.error("Harga pangan:", error);

        setText("hargaTertinggiNama", "—");
        setText("hargaTertinggiNilai", "—");
        setText(
            "hargaTertinggiPeriode",
            "Data harga belum tersedia"
        );

        setTableEmpty(
            "tabelHarga",
            error.message,
            5
        );
    }
}

function loadHarga() {
    return loadPriceData();
}

function renderPriceTable(rows) {
    const table = document.getElementById(
        "tabelHarga"
    );

    if (!table) return;

    table.innerHTML = rows.map(row => `
        <tr>
            <td>${escapeHTML(getPriceName(row))}</td>
            <td>${formatCurrency(getPriceValue(row))}</td>
            <td>${escapeHTML(getValue(row, ["satuan", "unit"], "—"))}</td>
            <td>${escapeHTML(getValue(row, ["wilayah", "provinsi"], "—"))}</td>
            <td>${escapeHTML(getValue(row, ["tanggal", "periode"], "—"))}</td>
        </tr>
    `).join("");
}

function renderPriceChart(rows) {
    const grouped = {};

    rows.forEach(row => {
        const name = getPriceName(row);
        const price = getPriceValue(row);

        if (price === null) return;

        grouped[name] = price;
    });

    createChart("priceChart", {
        type: "bar",
        data: {
            labels: Object.keys(grouped),
            datasets: [{
                label: "Harga Pangan",
                data: Object.values(grouped),
                backgroundColor: CHART_COLORS
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: chartScales()
        }
    });
}


/* ==========================================================
   18. CUACA BMKG
========================================================== */

async function loadDashboardWeather() {
    if (!DEFAULT_ADM4) {
        setText(
            "dashboardWeather",
            "Kode wilayah BMKG belum diisi"
        );

        setText(
            "weatherDescription",
            "Kode wilayah BMKG belum dikonfigurasi."
        );

        return;
    }

    try {
        const response = await apiFetch(
            `/api/v1/cuaca/${encodeURIComponent(DEFAULT_ADM4)}`
        );

        const weather = response.cuaca || {};

        const temperature =
            weather.t !== undefined
                ? `${weather.t}°C`
                : "—";

        setText("dashboardTemperature", temperature);

        setText(
            "dashboardWeather",
            weather.weather_desc || "—"
        );

        setText("weatherTemperature", temperature);
        setText(
            "weatherDescription",
            weather.weather_desc || "—"
        );

        setText(
            "weatherHumidity",
            weather.hu !== undefined
                ? `${weather.hu}%`
                : "—"
        );

        setText(
            "weatherWind",
            weather.ws !== undefined
                ? `${weather.ws} km/j`
                : "—"
        );

        setText(
            "weatherRain",
            weather.tp !== undefined
                ? `${weather.tp} mm`
                : "—"
        );

        renderWeatherForecast(
            response.prakiraan || []
        );

        loadWeatherWarning(DEFAULT_ADM4);
    } catch (error) {
        console.error("Weather:", error);

        setText(
            "dashboardWeather",
            "Data cuaca gagal dimuat"
        );
    }
}

function renderWeatherForecast(items) {
    const container = document.getElementById(
        "weatherForecast"
    );

    if (!container) return;

    container.innerHTML = items.slice(0, 5)
        .map(item => `
            <div>
                <strong>
                    ${escapeHTML(item.local_datetime || "—")}
                </strong>
                <span>${escapeHTML(item.t ?? "—")}°C</span>
                <small>
                    ${escapeHTML(item.weather_desc || "")}
                </small>
            </div>
        `).join("");
}

async function loadWeatherWarning(kode) {
    if (!kode) return;

    try {
        const response = await apiFetch(
            `/api/v1/ews-cuaca/${encodeURIComponent(kode)}`
        );

        setText(
            "weatherWarningStatus",
            response.status
        );

        setText(
            "weatherWarningMessage",
            response.pesan
        );

        const container = document.getElementById(
            "weatherRiskList"
        );

        if (container) {
            container.innerHTML = `
                <div class="risk-item">
                    <strong>
                        ${escapeHTML(response.status)}
                    </strong>
                    <span>
                        ${escapeHTML(response.pesan)}
                    </span>
                </div>
            `;
        }
    } catch (error) {
        console.error("Weather warning:", error);
    }
}


/* ==========================================================
   19. DATA CENTER
========================================================== */

async function loadDataCenter() {
    try {
        const response = await apiFetch(
            "/api/v1/data-center"
        );

        const files = getRecords(response);

        const datasets = files.filter(
            file => String(file.kategori)
                .toLowerCase()
                .includes("dataset")
        );

        const models = datasets.filter(
            file => /clustering|rekomendasi|timeseries|comparison/i
                .test(file.nama)
        );

        const reports = files.filter(
            file => String(file.kategori)
                .toLowerCase()
                .includes("laporan")
        );

        renderDataCenterTable(
            "tabelDataset",
            datasets
        );

        renderDataCenterTable(
            "tabelHasilModel",
            models
        );

        renderReportList(reports);
    } catch (error) {
        console.error("Data Center:", error);

        setTableEmpty(
            "tabelDataset",
            error.message
        );
    }
}

function renderDataCenterTable(id, files) {
    const table = document.getElementById(id);

    if (!table) return;

    if (!files.length) {
        setTableEmpty(
            id,
            "Belum ada file dataset."
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
                    data-endpoint="${escapeHTML(file.endpoint)}"
                    onclick="downloadDataCenter(this.dataset.endpoint)"
                >
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

    container.innerHTML = files.map(file => `
        <div class="report-item">
            <div>
                <strong>${escapeHTML(file.nama)}</strong>
                <p>${formatNumber(file.ukuran_kb)} KB</p>
            </div>
            <button
                class="green-button"
                data-endpoint="${escapeHTML(file.endpoint)}"
                onclick="downloadDataCenter(this.dataset.endpoint)"
            >
                Download
            </button>
        </div>
    `).join("");
}

function downloadDataCenter(endpoint) {
    if (!endpoint) return;

    const url = endpoint.startsWith("http")
        ? endpoint
        : API_BASE_URL + endpoint;

    window.open(url, "_blank");
}

function downloadReport(category) {
    const files = {
        produksi: "output_clustering_pangan.csv",
        harga: "output_rekomendasi_pangan.csv",
        cuaca: "output_timeseries_pangan.csv"
    };

    const file = files[category];

    if (!file) {
        alert("Jenis laporan tidak ditemukan.");
        return;
    }

    downloadDataCenter(
        "/api/v1/data-center/download/dataset_pemodelan/" +
        file
    );
}


/* ==========================================================
   20. LOGIN ADMIN
========================================================== */

async function loginAdmin() {
    const username = prompt("Username:");

    if (!username) return;

    const password = prompt("Password:");

    if (!password) return;

    try {
        const result = await apiFetch(
            "/api/v1/auth/login",
            {
                method: "POST",
                body: new URLSearchParams({
                    username,
                    password
                })
            }
        );

        localStorage.setItem(
            "access_token",
            result.access_token
        );

        alert(
            `Login berhasil sebagai ${result.username}`
        );

        loadAuditTrail();
    } catch (error) {
        alert(`Login gagal: ${error.message}`);
    }
}


/* ==========================================================
   21. UPLOAD DATASET
========================================================== */

async function uploadDatasetFile() {
    const input = document.getElementById(
        "uploadDataset"
    );

    if (!input?.files?.length) {
        alert("Pilih file terlebih dahulu.");
        return;
    }

    const token = getAuthToken();

    if (!token) {
        alert("Silakan login sebagai admin.");
        return;
    }

    const file = input.files[0];

    const confirmed = confirm(
        "Dataset upload akan mengganti sumber data utama " +
        "yang aktif, tetapi tidak menghapus file modeling asli. " +
        "Lanjutkan?"
    );

    if (!confirmed) return;

    const formData = new FormData();
    formData.append("file", file);

    input.disabled = true;

    try {
        const result = await apiFetch(
            "/api/v1/tanaman-pangan/upload",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`
                },
                body: formData
            }
        );

        alert(
            `${result.message}\nTotal: ${result.total_data}`
        );

        await Promise.allSettled([
        loadDashboard(),
        loadMonitoring(),
        loadStatusWilayah(),
        loadFilterKecamatan(),
        loadDataCenter()
    ]);
    } catch (error) {
        alert(`Upload gagal: ${error.message}`);
    } finally {
        input.disabled = false;
        input.value = "";
    }
}


/* ==========================================================
   22. AUDIT TRAIL
========================================================== */

async function loadAuditTrail() {
    const table = document.getElementById(
        "tabelAudit"
    );

    if (!table) return;

    const token = getAuthToken();

    if (!token) {
        setTableEmpty(
            "tabelAudit",
            "Login untuk melihat audit trail.",
            5
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

        table.innerHTML = rows.map(row => `
            <tr>
                <td>${escapeHTML(row.waktu)}</td>
                <td>${escapeHTML(row.username)}</td>
                <td>${escapeHTML(row.aktivitas)}</td>
                <td>${escapeHTML(row.details)}</td>
                <td>
                    <span class="status normal">
                        Tercatat
                    </span>
                </td>
            </tr>
        `).join("");
    } catch (error) {
        setTableEmpty(
            "tabelAudit",
            error.message,
            5
        );
    }
}


/* ==========================================================
   23. CSS TAMBAHAN PETA DAN STATUS
========================================================== */

function injectMonitoringMapStyles() {
    if (document.getElementById(
        "agridash-monitoring-style"
    )) return;

    const style = document.createElement("style");

    style.id = "agridash-monitoring-style";

    style.textContent = `
        #kediriMap {
            width: 100%;
            height: 430px;
            min-height: 330px;
            border-radius: 16px;
            overflow: hidden;
            background: #edf2e8;
        }

        #statusWilayahList {
            max-height: 430px;
            overflow-y: auto;
            padding-right: 8px;
        }

        .agri-status-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 4px;
            border-bottom: 1px solid #edf1eb;
            font-size: 13px;
        }

        .agri-status-pill {
            display: inline-block;
            padding: 6px 11px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
        }

        .agri-monitoring-extra {
            display: grid;
            grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
            gap: 20px;
            margin-bottom: 20px;
        }

        .agri-monitoring-extra > .card {
            min-width: 0;
        }

        @media (max-width: 900px) {
            .agri-monitoring-extra {
                grid-template-columns: 1fr;
            }
        }
    `;

    document.head.appendChild(style);
}


/* ==========================================================
   24. INITIALIZATION
========================================================== */

function setupFilterButton() {
    const dropdown = document.getElementById(
        "filterKecamatan"
    );

    if (!dropdown || dropdown.dataset.listenerAdded) {
        return;
    }

    dropdown.addEventListener(
        "change",
        loadMonitoring
    );

    dropdown.dataset.listenerAdded = "true";
}

async function initializeAgriDash() {
    console.log(
        "AgriDash initialized | API:",
        API_BASE_URL
    );

    setCurrentDate();
    injectMonitoringMapStyles();
    setupFilterButton();
    setupForecastFilter();

    await Promise.allSettled([
        loadDashboard(),
        loadFilterKecamatan(),
        loadStatusWilayah(),
        loadMonitoringData(),
        loadHeatmap(),
        loadPCA(),
        loadClustering(),
        loadRecommendations(),
        loadModelComparison(),
        loadForecasting(),
        loadDataCenter()
    ]);

    console.log("AgriDash initialization completed.");
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeAgriDash,
        { once: true }
    );
} else {
    initializeAgriDash();
}

document.addEventListener("agri:datechange", function (event) {
    const selectedDate = event.detail.date;

    const year = selectedDate.getFullYear();
    const month = String(
        selectedDate.getMonth() + 1
    ).padStart(2, "0");
    const day = String(
        selectedDate.getDate()
    ).padStart(2, "0");

    window.AGRI_DATE_FILTER = `${year}-${month}-${day}`;

    console.log(
        "Tanggal AgriDash dipilih:",
        window.AGRI_DATE_FILTER
    );
});