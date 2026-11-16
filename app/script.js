/* ==========================================================
   AGRIDASH V0.5 - FULL SCRIPT.JS (FINAL FIXED)
   Kabupaten Kediri
========================================================== */

const API_BASE_URL = window.AGRI_API_BASE_URL || "http://127.0.0.1:8000";
const GEOJSON_URL = "./aset/kediri_kecamatan.geojson";
const DEFAULT_ADM4 = "35.06.01.2001";

const chartInstances = {};

let clusteringData = [];
let recommendationData = [];
let recommendationError = null;
let recommendationLoaded = false;
let cropClusterAnalysisData = { biofarmaka: null, hortikultura: null };
let cropClusterAnalysisErrors = {};
let cropClusterAnalysisLoaded = { biofarmaka: false, hortikultura: false };
let forecastingData = [];
let forecastWeatherState = { loading: true };
let forecastPoints = [];
let forecastUnit = "";
let forecastRequestVersion = 0;
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
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toLocaleString("id-ID", { maximumFractionDigits: decimals });
}

function formatCurrency(value) {
    const number = Number(value);
    if (value === null || value === undefined || !Number.isFinite(number)) return "—";
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
    return String(value ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
}

function normalizeRegionName(value) {
    return String(value ?? "").normalize("NFKC").toLowerCase().trim()
        .replace(/^(kecamatan|kec\.?)\s+/i, "").replace(/\s+/g, " ");
}

function findKey(row, candidates) {
    if (!row || typeof row !== "object") return null;
    const keys = Object.keys(row);
    for (const candidate of candidates) {
        const match = keys.find(key => normalizeKey(key) === normalizeKey(candidate));
        if (match) return match;
    }
    return null;
}

function getValue(row, candidates, fallback = null) {
    const key = findKey(row, candidates);
    return key ? row[key] : fallback;
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? number : null;
}

function getRecords(response) {
    if (Array.isArray(response)) return response;
    if (!response || typeof response !== "object") return [];
    const keys = ["data", "records", "results", "items", "rows", "predictions", "hasil"];
    for (const key of keys) {
        if (Array.isArray(response[key])) return response[key];
    }
    return [];
}

function findFirstArray(value, depth = 0) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object" || depth > 5) return [];
    for (const item of Object.values(value)) {
        const result = findFirstArray(item, depth + 1);
        if (result.length) return result;
    }
    return [];
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? "—";
}

function setStatus(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.style.color = isError ? "#b91c1c" : "#265322";
}

function setTableLoading(id, colspan = 4) {
    const element = document.getElementById(id);
    if (!element) return;
    element.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center">Memuat data...</td></tr>`;
}

function setTableEmpty(id, message, colspan = 4) {
    const element = document.getElementById(id);
    if (!element) return;
    element.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center">${escapeHTML(message)}</td></tr>`;
}

async function apiFetch(endpoint, options = {}) {
    let response;
    const headers = new Headers(options.headers || {});
    const token = getAuthToken();
    if (token && endpoint !== "/api/v1/auth/login" && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    try {
        response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
    } catch (error) {
        throw new Error("Tidak dapat terhubung ke backend FastAPI.");
    }
    if (!response.ok) {
        if (response.status === 401 && window.AgriAuth) {
            window.AgriAuth.handleUnauthorized(endpoint);
        }
        let message = `HTTP ${response.status}`;
        try {
            const data = await response.json();
            if (data.detail) message = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
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
    if (typeof Chart === "undefined") return null;
    destroyChart(id);
    try {
        chartInstances[id] = new Chart(canvas, config);
        return chartInstances[id];
    } catch (error) { return null; }
}

function chartFont() { return { family: "Poppins", size: 10 }; }
function chartLegend() { return { position: "bottom", labels: { usePointStyle: true, padding: 18, font: chartFont() } }; }
function chartScales() { return { x: { grid: { display: false }, ticks: { font: chartFont() } }, y: { beginAtZero: true, grid: { color: "#edf1eb" }, ticks: { font: chartFont() } } }; }

function getAuthToken() {
    return window.AgriAuth ? window.AgriAuth.getToken() : null;
}

function setCurrentDate() {}


/* ==========================================================
   2. NAVIGATION
========================================================== */

function showPage(pageId, clickedButton = null) {
    if (window.AGRI_ALLOWED_PAGES && !window.AGRI_ALLOWED_PAGES.includes(pageId)) return;
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active-page"));
    const selectedPage = document.getElementById(pageId);
    if (selectedPage) selectedPage.classList.add("active-page");

    document.querySelectorAll(".menu-item").forEach(menu => {
        menu.classList.remove("active");
        if (!clickedButton && (menu.getAttribute("onclick") || "").includes(`'${pageId}'`)) menu.classList.add("active");
    });

    if (clickedButton) clickedButton.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });

    switch (pageId) {
        case "dashboard":
            loadDashboard();
            refreshDashboardMap();
            break;
        case "monitoring":
            loadMonitoring();
            loadStatusWilayah().then(async () => {
                await loadKediriMap();
                if (kediriMapInstance) requestAnimationFrame(() => kediriMapInstance.invalidateSize());
            });
            break;
        case "harga": loadPriceData(); break;
        case "cuaca": loadDashboardWeather(); break;
        case "prediksi": loadForecasting(); loadBiofarmakaOverview(); break;
        case "ketahanan": loadKetahananAnalyses(); loadBiofarmakaOverview(); break;
        case "data": loadDataCenter(); break;
        case "audit": loadAuditTrail(); break;
    }
}


/* ==========================================================
   3. DASHBOARD
========================================================== */

async function loadDashboardSummary() {
    try {
        const data = await apiFetch("/api/v1/tanaman-pangan/ringkasan");
        setText("totalProduksi", formatNumber(data.total_produksi));
        setText("totalLuasPanen", formatNumber(data.total_luas_panen));
        setText("totalProduktivitas", formatNumber(data.rata_produktivitas));
        setText("growthProduksi", "Agregasi rata-rata komoditas");
        setText("growthLuasPanen", "Agregasi rata-rata komoditas");
        setText("growthProduktivitas", "Rata-rata produktivitas");
        setStatus("statusAPI", `Data berhasil dimuat (${data.total_data} baris).`);
        return data;
    } catch (error) {
        setStatus("statusAPI", `Gagal memuat data: ${error.message}`, true);
        return null;
    }
}

async function loadDashboard() {
    setCurrentDate();
    await Promise.allSettled([
        loadDashboardSummary(),
        loadProductionChart(),
        loadTop5Kecamatan(),
        loadDashboardClusterSummary(),
        loadDashboardWarning(),
        loadPriceData(), 
        loadDashboardWeather(),
        loadDashboardMap(),
        loadBiofarmakaOverview(),
        loadDashboardHortikultura()
    ]);
}

function changeDashboardChart(metric, button) {
    if (!METRICS[metric]) return;
    dashboardMetric = metric;
    document.querySelectorAll(".trend-card .tab").forEach(tab => tab.classList.remove("active"));
    if (button) button.classList.add("active");
    renderProductionChart();
}

async function loadProductionChart() {
    if (!document.getElementById("productionChart")) return;
    try {
        const response = await apiFetch("/api/v1/tanaman-pangan?limit=500");
        dashboardRows = getRecords(response);
        renderProductionChart();
    } catch (error) { destroyChart("productionChart"); }
}

function renderProductionChart() {
    const metric = METRICS[dashboardMetric];
    const grouped = {};
    dashboardRows.forEach(row => {
        const name = row.tanaman || "Lainnya";
        const value = toNumber(row[metric.key]);
        if (value === null) return;
        if (!grouped[name]) grouped[name] = { sum: 0, count: 0 };
        grouped[name].sum += value;
        grouped[name].count++;
    });
    const sorted = Object.entries(grouped).map(([name, value]) => ({
        name, value: metric.avg ? value.sum / value.count : value.sum
    })).sort((a, b) => b.value - a.value);
    if (!sorted.length) return destroyChart("productionChart");

    createChart("productionChart", {
        type: "bar",
        data: {
            labels: sorted.map(item => item.name),
            datasets: [{
                label: metric.label, data: sorted.map(item => item.value),
                backgroundColor: ["#265322", "#60982c", "#8ab45b", "#d6a900", "#b5ce8c"],
                borderRadius: 7, barThickness: 30, maxBarThickness: 36
            }]
        },
        options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${formatNumber(context.parsed.x)}` } } },
            scales: {
                x: { beginAtZero: true, grid: { color: "#edf1eb" }, ticks: { font: { family: "Poppins", size: 11 } } },
                y: { grid: { display: false }, ticks: { font: { family: "Poppins", size: 12 } } }
            }
        }
    });
}

async function loadTop5Kecamatan() {
    const container = document.getElementById("top5Kecamatan");
    if (!container) return;
    try {
        const response = await apiFetch("/api/v1/rekap-kecamatan");
        const rows = getRecords(response).map(item => ({
            name: String(item.kecamatan ?? "").trim(),
            value: item.total_produksi == null || item.total_produksi === ""
                ? NaN
                : Number(item.total_produksi)
        }));
        renderCategoryRanking("top5Kecamatan", rows, "ton");
    } catch (error) { container.textContent = error.message; }
}

async function loadDashboardClusterSummary() {
    const container = document.getElementById("dashboardClusterSummary");
    if (!container) return;
    try {
        const response = await apiFetch("/api/v1/monitoring/ringkasan-status");
        container.innerHTML = `<p>${response.total_kecamatan} kecamatan, ${response.jumlah_potensi_tinggi} potensi tinggi, ${response.jumlah_potensi_sedang} potensi sedang, ${response.jumlah_potensi_rendah} potensi rendah.</p>`;
    } catch (error) { container.textContent = "Ringkasan clustering belum tersedia."; }
}

async function loadDashboardWarning() {
    try {
        const response = await apiFetch("/api/v1/monitoring/status-wilayah");
        const rows = getRecords(response);
        const wilayahRendah = rows.filter(row => String(row.status_wilayah || "").toLowerCase().includes("rendah"));
        setText("jumlahWilayahWarning", wilayahRendah.length);
        const statusElement = document.getElementById("statusWilayahWarning");
        if (statusElement) {
            if (wilayahRendah.length) {
                const names = wilayahRendah.map(row => row.kecamatan).filter(Boolean);
                statusElement.innerHTML = `<strong style="color:#D95363;">${wilayahRendah.length} kecamatan berpotensi rendah</strong><div style="font-size:11px;color:#64748b;line-height:1.6;margin-top:6px;">${names.map(escapeHTML).join(", ")}</div>`;
            } else {
                statusElement.textContent = "Tidak ada wilayah berkategori potensi rendah.";
            }
        }
    } catch (error) {
        setText("jumlahWilayahWarning", "—");
        setText("statusWilayahWarning", "Data status wilayah belum tersedia.");
    }

    const container = document.getElementById("dashboardWarnings");
    if (!container || !DEFAULT_ADM4) return;
    try {
        const response = await apiFetch(`/api/v1/ews-cuaca/${encodeURIComponent(DEFAULT_ADM4)}`);
        const status = String(response.status || "TIDAK TERSEDIA").toUpperCase();
        const config = {
            AMAN: { color: "#265322", background: "#F0F7E9", icon: "fa-shield-halved", title: "Kondisi Relatif Aman" },
            WASPADA: { color: "#B7791F", background: "#FFF7E6", icon: "fa-triangle-exclamation", title: "Perlu Kewaspadaan" },
            BAHAYA: { color: "#D95363", background: "#FFF0F0", icon: "fa-circle-exclamation", title: "Perlu Perhatian Tinggi" }
        };
        const selected = config[status] || { color: "#64748B", background: "#F1F5F9", icon: "fa-circle-info", title: "Status Tidak Tersedia" };
        const params = response.parameter || {};
        const interpretation = String(
            response.pesan || `${selected.title}. Informasi tambahan belum tersedia.`
        );
        container.innerHTML = `
            <div class="dashboard-ews-content" style="--ews-color:${selected.color};--ews-background:${selected.background};">
                <div class="dashboard-ews-status">
                    <i class="fa-solid ${selected.icon}" aria-hidden="true"></i>
                    <div class="dashboard-ews-status-copy">
                        <small>Status Cuaca</small>
                        <strong>${escapeHTML(status)}</strong>
                    </div>
                    <span>${escapeHTML(selected.title)}</span>
                </div>
                <div class="dashboard-ews-metrics">
                    <div class="dashboard-ews-metric">
                        <small>Curah Hujan</small>
                        <strong>${formatNumber(params.curah_hujan, 1)} <span>mm</span></strong>
                    </div>
                    <div class="dashboard-ews-metric">
                        <small>Kelembapan</small>
                        <strong>${formatNumber(params.kelembapan, 1)}<span>%</span></strong>
                    </div>
                    <div class="dashboard-ews-metric">
                        <small>Suhu</small>
                        <strong>${formatNumber(params.suhu, 1)}<span>°C</span></strong>
                    </div>
                </div>
                <div class="dashboard-ews-summary">
                    <strong>Ringkasan</strong>
                    <p>${escapeHTML(interpretation)}</p>
                    <small>Indikator berdasarkan prakiraan BMKG, bukan peringatan dini resmi BMKG.</small>
                </div>
            </div>
        `;
    } catch (error) { container.textContent = "Gagal memuat indikator cuaca: " + error.message; }
}


/* ==========================================================
   4. STATUS WILAYAH & MONITORING
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
    return (text.includes("tinggi") || text.includes("sedang") || text.includes("rendah")) ? "#FFFFFF" : "#374151";
}

function getSelectedKecamatan() { return document.getElementById("filterKecamatan")?.value || ""; }
function findStatusWilayah(name) {
    const key = normalizeRegionName(name);
    return statusWilayahData.find(item => normalizeRegionName(item.kecamatan) === key) || null;
}

async function loadStatusWilayah() {
    try {
        const response = await apiFetch("/api/v1/monitoring/status-wilayah");
        statusWilayahData = getRecords(response);
        renderStatusWilayahList(statusWilayahData);
        return statusWilayahData;
    } catch (error) {
        const container = document.getElementById("statusWilayahList");
        if (container) container.textContent = `Gagal memuat status: ${error.message}`;
        return [];
    }
}

function renderStatusWilayahList(rows) {
    const container = document.getElementById("statusWilayahList");
    if (!container) return;
    const selected = normalizeRegionName(getSelectedKecamatan());
    const filtered = rows.filter(item => !selected || normalizeRegionName(item.kecamatan) === selected);
    if (!filtered.length) { container.textContent = "Data status wilayah belum tersedia."; return; }

    const order = { "Potensi Tinggi": 0, "Potensi Sedang": 1, "Potensi Rendah": 2 };
    const sorted = [...filtered].sort((a, b) => (order[a.status_wilayah] ?? 3) - (order[b.status_wilayah] ?? 3) || a.kecamatan.localeCompare(b.kecamatan));

    container.innerHTML = `
        <p class="agri-status-count">${sorted.length} kecamatan</p>
        ${sorted.map(item => `
            <div class="agri-status-row">
                <div class="agri-status-info">
                    <strong>${escapeHTML(item.kecamatan)}</strong>
                    <span>Produksi ${formatNumber(item.total_produksi)} ton</span>
                </div>
                <span class="agri-status-pill" style="background:${getStatusColor(item.status_wilayah)}; color:${getStatusTextColor(item.status_wilayah)};">${escapeHTML(item.status_wilayah)}</span>
            </div>
        `).join("")}
    `;
}

async function loadMonitoringData(filterKecamatan = "") {
    const table = document.getElementById("tabelMonitoring");
    if (!table) return;
    setTableLoading("tabelMonitoring", 3);
    try {
        const response = await apiFetch("/api/v1/monitoring/status-wilayah");
        monitoringData = getRecords(response);
        statusWilayahData = monitoringData;
        const selected = normalizeRegionName(filterKecamatan);
        const rows = monitoringData.filter(item => !selected || normalizeRegionName(item.kecamatan) === selected)
            .sort((a, b) => (Number(b.total_produksi) || 0) - (Number(a.total_produksi) || 0));

        if (!rows.length) { setTableEmpty("tabelMonitoring", "Data kecamatan tidak ditemukan.", 3); return; }

        table.innerHTML = rows.map(item => `
            <tr>
                <td>
                    <div class="monitoring-rekap-region">
                        <strong>${escapeHTML(item.kecamatan)}</strong>
                        <small>Produksi ${formatNumber(item.total_produksi)} ton</small>
                    </div>
                </td>
                <td>${formatNumber(item.total_luas_panen)} ha</td>
                <td><span class="agri-status-pill" style="background:${getStatusColor(item.status_wilayah)}; color:${getStatusTextColor(item.status_wilayah)};">${escapeHTML(item.status_wilayah)}</span></td>
            </tr>
        `).join("");
        renderStatusWilayahList(monitoringData);
        highlightKediriSelection(filterKecamatan);
    } catch (error) { setTableEmpty("tabelMonitoring", `Gagal memuat monitoring: ${error.message}`, 3); }
}

function loadMonitoring() {
    const result = loadMonitoringData(getSelectedKecamatan());
    loadHeatmap();
    return result;
}

async function loadFilterKecamatan() {
    const dropdown = document.getElementById("filterKecamatan");
    if (!dropdown) return;
    try {
        const response = await apiFetch("/api/v1/kecamatan");
        const rows = getRecords(response);
        const previous = dropdown.value;
        dropdown.innerHTML = `<option value="">Semua Kecamatan</option>`;
        rows.forEach(item => {
            const name = typeof item === "string" ? item : item.kecamatan;
            if (!name) return;
            const option = document.createElement("option");
            option.value = name;
            option.textContent = name;
            dropdown.appendChild(option);
        });
        if ([...dropdown.options].some(option => option.value === previous)) dropdown.value = previous;
    } catch (error) {}
}


/* ==========================================================
   5. PETA KABUPATEN KEDIRI
========================================================== */

function getGeoKecamatanName(feature) {
    const props = feature?.properties || {};
    const candidates = ["WADMKC", "wadmkc", "KECAMATAN", "kecamatan", "NAMOBJ", "namobj", "NAMKEC", "namkec", "nama_kecamatan", "name", "NAME"];
    for (const key of candidates) {
        if (props[key] !== undefined && props[key] !== null && String(props[key]).trim()) return String(props[key]).trim();
    }
    return "Tidak diketahui";
}

function highlightKediriSelection(selectedName = "") {
    if (!kediriGeoJsonLayer) return;
    const selected = normalizeRegionName(selectedName);
    kediriGeoJsonLayer.eachLayer(layer => {
        const name = getGeoKecamatanName(layer.feature);
        const item = findStatusWilayah(name);
        const active = selected && normalizeRegionName(name) === selected;
        layer.setStyle({
            color: active ? "#f59e0b" : "#ffffff",
            weight: active ? 3.5 : 1.5,
            fillColor: getStatusColor(item?.status_wilayah),
            fillOpacity: active ? 0.95 : 0.8
        });
        if (active) layer.bringToFront();
    });
}

async function loadKediriMap() {
    const container = document.getElementById("kediriMap");
    if (!container || typeof L === "undefined" || kediriMapLoading) return;
    kediriMapLoading = true;
    try {
        if (!statusWilayahData.length) await loadStatusWilayah();
        const response = await fetch(GEOJSON_URL);
        if (!response.ok) throw new Error("GeoJSON Kediri belum ditemukan di " + GEOJSON_URL);
        const geojson = await response.json();

        if (!kediriMapInstance) {
            kediriMapInstance = L.map("kediriMap", { scrollWheelZoom: false }).setView([-7.82, 112.02], 10);
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(kediriMapInstance);
        }
        if (kediriGeoJsonLayer) kediriMapInstance.removeLayer(kediriGeoJsonLayer);

        kediriGeoJsonLayer = L.geoJSON(geojson, {
            style(feature) {
                const name = getGeoKecamatanName(feature);
                const item = findStatusWilayah(name);
                return { color: "#ffffff", weight: 1.5, fillColor: getStatusColor(item?.status_wilayah), fillOpacity: 0.8 };
            },
            onEachFeature(feature, layer) {
                const name = getGeoKecamatanName(feature);
                const item = findStatusWilayah(name);
                layer.bindPopup(`<div style="min-width:210px;line-height:1.8"><strong>${escapeHTML(name)}</strong><br><b>Status:</b> ${escapeHTML(item?.status_wilayah || "Belum Dikategorikan")}<br><b>Indikator Produksi:</b> ${formatNumber(item?.total_produksi)} ton<br><b>Indikator Luas:</b> ${formatNumber(item?.total_luas_panen)} ha<br><b>Produktivitas:</b> ${formatNumber(item?.rata_produktivitas)} ku/ha</div>`);
                layer.on("mouseover", () => layer.setStyle({ weight: 3, fillOpacity: 0.95 }));
                layer.on("mouseout", () => highlightKediriSelection(getSelectedKecamatan()));
                layer.on("click", () => {
                    const dropdown = document.getElementById("filterKecamatan");
                    if (!dropdown) return;
                    const option = [...dropdown.options].find(opt => normalizeRegionName(opt.value) === normalizeRegionName(name));
                    if (option) { dropdown.value = option.value; loadMonitoring(); }
                });
            }
        }).addTo(kediriMapInstance);
        const bounds = kediriGeoJsonLayer.getBounds();
        if (bounds.isValid()) kediriMapInstance.fitBounds(bounds, { padding: [12, 12] });
        highlightKediriSelection(getSelectedKecamatan());
        requestAnimationFrame(() => kediriMapInstance.invalidateSize());
    } catch (error) {
        if (!kediriMapInstance) container.textContent = `Gagal memuat peta: ${error.message}`;
    } finally { kediriMapLoading = false; }
}

async function loadDashboardMap() {
    const container = document.getElementById("dashboardKediriMap");
    if (!container || typeof L === "undefined" || dashboardMapPromise) return;
    dashboardMapPromise = (async () => {
        try {
            const [statusResponse, geoResponse] = await Promise.all([apiFetch("/api/v1/monitoring/status-wilayah"), fetch(GEOJSON_URL)]);
            if (!geoResponse.ok) throw new Error(`File GeoJSON tidak ditemukan (HTTP ${geoResponse.status}). Periksa path: ${GEOJSON_URL}`);
            const geojson = await geoResponse.json();
            const rows = getRecords(statusResponse);
            const statusMap = new Map();
            rows.forEach(item => statusMap.set(normalizeRegionName(item.kecamatan), item));

            if (!dashboardMapInstance) {
                dashboardMapInstance = L.map(container, { zoomControl: true, scrollWheelZoom: false });
                L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(dashboardMapInstance);
            }
            if (dashboardGeoJsonLayer) dashboardMapInstance.removeLayer(dashboardGeoJsonLayer);

            dashboardGeoJsonLayer = L.geoJSON(geojson, {
                style(feature) {
                    const name = getGeoKecamatanName(feature);
                    const item = statusMap.get(normalizeRegionName(name));
                    return { color: "#ffffff", weight: 1.2, fillColor: getStatusColor(item?.status_wilayah), fillOpacity: 0.85 };
                },
                onEachFeature(feature, layer) {
                    const name = getGeoKecamatanName(feature);
                    const item = statusMap.get(normalizeRegionName(name));
                    layer.bindPopup(`<div style="line-height:1.8;min-width:180px"><strong>Kecamatan ${escapeHTML(name)}</strong><br>Status: ${escapeHTML(item?.status_wilayah || "Belum Ada Data")}<br>Indikator Produksi: ${formatNumber(item?.total_produksi)} ton<br>Indikator Luas: ${formatNumber(item?.total_luas_panen)} ha</div>`);
                    layer.on("mouseover", () => layer.setStyle({ color: "#334155", weight: 2.5, fillOpacity: 1 }));
                    layer.on("mouseout", () => dashboardGeoJsonLayer.resetStyle(layer));
                }
            }).addTo(dashboardMapInstance);
            const bounds = dashboardGeoJsonLayer.getBounds();
            if (!bounds.isValid()) throw new Error("GeoJSON tidak memiliki koordinat poligon yang valid.");
            dashboardMapInstance.fitBounds(bounds, { padding: [12, 12] });
            requestAnimationFrame(() => {
                if (!dashboardMapInstance) return;

                dashboardMapInstance.invalidateSize({
                    pan: false
                });

                dashboardMapInstance.fitBounds(bounds, {
                    padding: [12, 12]
                });
            });
        } catch (error) {
            if (dashboardMapInstance) { dashboardMapInstance.remove(); dashboardMapInstance = null; dashboardGeoJsonLayer = null; }
            container.innerHTML = `<div style="padding:18px;font-size:13px;color:#b91c1c;background:#fff1f2;border-radius:12px;">${escapeHTML(error.message)}</div>`;
        }
    })();
    try { await dashboardMapPromise; } finally { dashboardMapPromise = null; }
}


/* ==========================================================
   6. HEATMAP
========================================================== */

function getHeatmapCategory() {
    const value = normalizeKey(document.getElementById("heatmapCategory")?.value || "");
    if (value.includes("bio")) return "biofarmaka";
    if (value.includes("horti")) return "hortikultura";
    return "tanaman_pangan";
}

let heatmapResizeTimer = null;
let rerenderHeatmap = null;
let heatmapResizeListenerAdded = false;

function setupHeatmapResize() {
    if (heatmapResizeListenerAdded) return;
    window.addEventListener("resize", () => {
        clearTimeout(heatmapResizeTimer);
        heatmapResizeTimer = setTimeout(() => {
            rerenderHeatmap?.();
            if (kediriMapInstance && document.getElementById("monitoring")?.classList.contains("active-page")) {
                kediriMapInstance.invalidateSize({ pan: false });
            }
        }, 150);
    }, { passive: true });
    heatmapResizeListenerAdded = true;
}

async function loadHeatmap(forceCategory) {
    const container = document.getElementById("heatmapKecamatan");
    if (!container) return;
    const category = typeof forceCategory === "string" ? forceCategory : getHeatmapCategory();
    rerenderHeatmap = null;
    container.innerHTML = "<p>Memuat heatmap produksi...</p>";
    try {
        const response = await apiFetch(`/api/v1/model/heatmap-kecamatan?kategori=${encodeURIComponent(category)}`);
        const render = () => {
            const allRows = getRecords(response);
            const kecamatanCol = response.kecamatan_column || "kecamatan";
            const commodities = Array.isArray(response.komoditas) && response.komoditas.length
                ? response.komoditas
                : Object.keys(allRows[0] || {}).filter(key => key !== kecamatanCol);
            const unit = response.satuan || "ton";
            if (!allRows.length || !commodities.length) { container.innerHTML = "<p>Data heatmap produksi belum tersedia.</p>"; return; }

            const selectedKecamatan = document.getElementById("filterKecamatan")?.value || "";
            const selectedKomoditas = document.getElementById("filterKomoditas")?.value || "";
            const visibleColumns = selectedKomoditas && commodities.includes(selectedKomoditas) ? [selectedKomoditas] : commodities;
            const rows = allRows.filter(row => !selectedKecamatan || normalizeRegionName(row[kecamatanCol]) === normalizeRegionName(selectedKecamatan));
            if (!rows.length) { container.innerHTML = "<p>Data heatmap tidak tersedia untuk kecamatan yang dipilih.</p>"; return; }

            const distribution = allRows.flatMap(row => commodities.map(col => toNumber(row[col])))
                .filter(value => value !== null)
                .sort((a, b) => a - b);
            const quantile = ratio => {
                if (!distribution.length) return null;
                const position = (distribution.length - 1) * ratio;
                const lower = Math.floor(position);
                const upper = Math.ceil(position);
                return distribution[lower] + (distribution[upper] - distribution[lower]) * (position - lower);
            };
            const lowThreshold = quantile(1 / 3);
            const highThreshold = quantile(2 / 3);
            const heatmapColors = [
                { label: "Produksi rendah", color: "#F2A0A0" },
                { label: "Produksi sedang", color: "#B7A7E3" },
                { label: "Produksi tinggi", color: "#83B5E3" }
            ];
            const classifyHeatmapValue = value => {
                if (value === null) return { label: "Data tidak tersedia", color: "#E5E7EB" };
                if (value <= lowThreshold) return heatmapColors[0];
                if (value <= highThreshold) return heatmapColors[1];
                return heatmapColors[2];
            };

            const explanation = `
                <div class="heatmap-explanation">
                    <span>Perbandingan produksi rata-rata antar-kecamatan (${escapeHTML(unit)})</span>
                    <div class="heatmap-color-legend" aria-label="Kategori produksi">
                        ${heatmapColors.map(item => `<span class="heatmap-legend-item"><i style="background:${item.color}"></i>${item.label}</span>`).join("")}
                    </div>
                </div>
            `;
            const note = `
                <p class="heatmap-note">Warna menunjukkan sepertiga distribusi produksi terendah, sedang, dan tertinggi pada kategori terpilih. Arahkan kursor ke sel untuk melihat nilai; sel abu-abu berarti data tidak tersedia.</p>
            `;
            const tableRows = rows.map(row => {
                const region = String(row[kecamatanCol] ?? "");
                return `
                    <tr>
                        <th class="heatmap-kecamatan-name" scope="row" title="${escapeHTML(region)}">${escapeHTML(region)}</th>
                        ${visibleColumns.map(col => {
                            const value = toNumber(row[col]);
                            const categoryColor = classifyHeatmapValue(value);
                            const valueLabel = value === null ? "—" : formatNumber(value);
                            const tooltipValue = value === null ? "Data tidak tersedia" : `${valueLabel} ${unit}`;
                            const tooltip = `${region} | ${col}: ${tooltipValue}`;
                            return `<td class="heatmap-value-cell" style="background:${categoryColor.color};color:#263238" title="${escapeHTML(tooltip)}">${valueLabel}</td>`;
                        }).join("")}
                    </tr>
                `;
            }).join("");
            const table = `
                <div class="heatmap-table-scroll">
                    <table class="heatmap-table">
                        <thead>
                            <tr>
                                <th scope="col">Kecamatan</th>
                                ${visibleColumns.map(col => `<th scope="col">${escapeHTML(col)}</th>`).join("")}
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            `;

            container.innerHTML = `${explanation}${table}${note}`;
        };
        rerenderHeatmap = render;
        render();
    } catch (error) { container.innerHTML = `<p style="color:#b91c1c">Gagal memuat heatmap: ${escapeHTML(error.message)}</p>`; }
}

/* ==========================================================
   7. CLUSTERING & REKOMENDASI
========================================================== */

const CLUSTER_COLORS = ["#265322", "#8ab45b", "#d95363", "#d6a900"];

function clusterProduction(row) {
    return toNumber(getValue(row, ["total_produksi_mean", "prod_mean", "produksi_mean", "total_produksi", "produksi_ton"]));
}

const POTENTIAL_CLUSTER_IDS = {
    "Potensi Tinggi": "1",
    "Potensi Sedang": "2",
    "Potensi Rendah": "3"
};

function getPotentialClusterLabel(value) {
    const label = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (label.includes("tinggi")) return "Potensi Tinggi";
    if (label.includes("sedang")) return "Potensi Sedang";
    if (label.includes("rendah")) return "Potensi Rendah";
    return null;
}

function getPotentialStatusClass(label) {
    if (label === "Potensi Tinggi") return "high";
    if (label === "Potensi Sedang") return "medium";
    if (label === "Potensi Rendah") return "low";
    return "unknown";
}

function formatCommodityName(value) {
    return String(value ?? "").replace(/_/g, " ").trim()
        .replace(/\b[a-z]/gi, character => character.toLocaleUpperCase("id-ID"));
}

function formatCommodityList(value) {
    return String(value ?? "").split(/[,;]/)
        .map(formatCommodityName).filter(Boolean).join(", ");
}

function aggregateCommodityProductionByRegion(rows, regionCandidates, commodityCandidates, productionCandidates) {
    const totalsByRegion = new Map();
    rows.forEach(row => {
        const region = normalizeRegionName(getValue(row, regionCandidates));
        const commodity = formatCommodityName(getValue(row, commodityCandidates));
        const production = toNumber(getValue(row, productionCandidates));
        if (!region || !commodity || production === null) return;
        if (!totalsByRegion.has(region)) totalsByRegion.set(region, new Map());
        const commodityTotals = totalsByRegion.get(region);
        const key = commodity.toLocaleLowerCase("id-ID");
        const current = commodityTotals.get(key) || { name: commodity, production: 0 };
        current.production += production;
        commodityTotals.set(key, current);
    });
    return totalsByRegion;
}

function getTopCommodityContributions(regions, totalsByRegion, limit = 3) {
    const totals = new Map();
    regions.forEach(regionName => {
        const commodities = totalsByRegion.get(normalizeRegionName(regionName));
        if (!commodities) return;
        commodities.forEach(commodity => {
            const key = commodity.name.toLocaleLowerCase("id-ID");
            const current = totals.get(key) || { name: commodity.name, production: 0 };
            current.production += commodity.production;
            totals.set(key, current);
        });
    });
    return [...totals.values()]
        .sort((a, b) => b.production - a.production || a.name.localeCompare(b.name, "id"))
        .slice(0, limit);
}

function getClusterDetails(rows, clusterCol, totalsByRegion) {
    const groups = new Map();
    rows.forEach(row => {
        const rawId = String(row[clusterCol] ?? "Tidak diketahui");
        const label = getPotentialClusterLabel(row.label_cluster);
        const key = label || `unknown:${rawId}`;
        if (!groups.has(key)) groups.set(key, { rawId, label, members: [] });
        groups.get(key).members.push(row);
    });
    return [...groups.values()].map(({ rawId, label, members }) => {
        const productionValues = members.map(row => clusterProduction(row)).filter(value => value !== null);
        const averageProduction = productionValues.length ? productionValues.reduce((a, b) => a + b, 0) / productionValues.length : null;
        const regions = members.map(row => row.kecamatan).filter(Boolean);
        return {
            id: label ? POTENTIAL_CLUSTER_IDS[label] : rawId,
            label: label || "Belum Dikategorikan",
            potentialLabel: label,
            members, count: members.length,
            percentage: rows.length ? members.length / rows.length * 100 : 0,
            averageProduction,
            unit: "ton",
            averageUnit: "ton",
            topCommodities: getTopCommodityContributions(regions, totalsByRegion),
            kecamatan: regions.sort((a, b) => a.localeCompare(b, "id"))
        };
    }).sort((a, b) => Number(a.id) - Number(b.id));
}

async function loadClustering() {
    setTableLoading("tabelCluster", 5);
    try {
        const [response, productionResponse] = await Promise.all([
            apiFetch("/api/v1/model/clustering"),
            apiFetch("/api/v1/tanaman-pangan?limit=500&sort_by=produksi_ton")
        ]);
        clusteringData = getRecords(response);
        if (!clusteringData.length) {
            setTableEmpty("tabelCluster", "Data clustering belum tersedia.", 5);
            if (document.getElementById("potentialCategoryFilter")?.value === "tanaman_pangan") {
                populatePotentialRegionFilter("tanaman_pangan");
            }
            renderCommodityPotentialAnalysis();
            return;
        }
        const clusterCol = response.cluster_column || findKey(clusteringData[0], ["cluster_id", "cluster", "klaster"]) || "cluster_id";
        const productionRows = getRecords(productionResponse);
        const productionByRegion = aggregateCommodityProductionByRegion(
            productionRows,
            ["kecamatan", "nama_kecamatan", "wilayah"],
            ["tanaman", "komoditas"],
            ["produksi_ton"]
        );
        const details = getClusterDetails(clusteringData, clusterCol, productionByRegion);
        const detailByRegion = new Map();
        details.forEach(detail => detail.kecamatan.forEach(name => detailByRegion.set(normalizeRegionName(name), detail)));

        renderClusterDistribution(details);
        renderClusterDescription(details);

        const table = document.getElementById("tabelCluster");
        if (table) {
            const head = table.closest("table")?.querySelector("thead tr");
            if (head) head.innerHTML = `<th>Kecamatan</th><th>Cluster</th><th>Kategori Potensi</th><th>Top 3 Komoditas</th><th>Rerata Produksi (Ton)</th>`;
            table.innerHTML = clusteringData.map(row => {
                const detail = detailByRegion.get(normalizeRegionName(row.kecamatan));
                const top3 = getTopCommodityContributions([row.kecamatan], productionByRegion).map(item => item.name);
                return `
                <tr>
                    <td><strong>${escapeHTML(row.kecamatan)}</strong></td>
                    <td><span class="cluster-id-pill">Cluster ${escapeHTML(detail?.id ?? "—")}</span></td>
                    <td><span class="potential-status-pill potential-status-${getPotentialStatusClass(detail?.potentialLabel)}">${escapeHTML(detail?.label ?? "Belum Dikategorikan")}</span></td>
                    <td>${escapeHTML(top3.map(formatCommodityName).join(", ") || "—")}</td>
                    <td>${formatNumber(clusterProduction(row))}</td>
                </tr>
            `;
            }).join("");
        }
        if (document.getElementById("potentialCategoryFilter")?.value === "tanaman_pangan") {
            populatePotentialRegionFilter("tanaman_pangan");
        }
        renderCommodityPotentialAnalysis();
    } catch (error) {
        clusteringData = [];
        destroyChart("clusterDistributionChart");
        setTableEmpty("tabelCluster", `Gagal memuat clustering: ${error.message}`, 5);
        setText("clusterDescription", `Gagal memuat karakteristik cluster: ${error.message}`);
        if (document.getElementById("potentialCategoryFilter")?.value === "tanaman_pangan") {
            populatePotentialRegionFilter("tanaman_pangan");
        }
        renderCommodityPotentialAnalysis();
    }
}

function renderClusterDistribution(details, chartId = "clusterDistributionChart") {
    const labels = details.map(item => `Cluster ${item.id}${item.potentialLabel ? ` · ${item.potentialLabel}` : ""}`);
    const values = details.map(item => item.count);
    createChart(chartId, {
        type: "doughnut",
        data: { labels, datasets: [{ data: values, backgroundColor: CLUSTER_COLORS, borderColor: "#FFFFFF", borderWidth: 3, hoverOffset: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { usePointStyle: true, padding: 18, font: { family: "Poppins", size: 12 } } }, tooltip: { callbacks: { label: context => { const item = details[context.dataIndex]; return [`${item.count} kecamatan`, `${formatNumber(item.percentage, 1)}% dari wilayah`, ...(item.potentialLabel ? [item.potentialLabel] : [])]; } } } } }
    });
}

function renderClusterDescription(details, containerId = "clusterDescription") {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!details.length) {
        container.innerHTML = "<p>Interpretasi clustering belum tersedia.</p>";
        return;
    }
    container.innerHTML = details.map((item, index) => `
        <div class="cluster-info-card">
            <div class="cluster-info-header">
                <div class="cluster-info-title"><span class="cluster-color-dot" style="background:${CLUSTER_COLORS[index % CLUSTER_COLORS.length]}"></span><strong>Cluster ${escapeHTML(item.id)}</strong></div>
                <span class="cluster-count-badge">${item.count} kecamatan</span>
            </div>
            <ul class="cluster-interpretation-points">
                <li><strong>Karakteristik:</strong> ${item.count} kecamatan; rerata produksi ${formatNumber(item.averageProduction, 1)} ${escapeHTML(item.averageUnit || item.unit || "kg")}, mencakup ${formatNumber(item.percentage, 1)}% wilayah.</li>
                <li><strong>Kategori potensi:</strong> ${item.potentialLabel || item.label ? `<span class="potential-status-pill potential-status-${getPotentialStatusClass(item.potentialLabel || item.label)}">${escapeHTML(item.potentialLabel || item.label)}</span>${item.potentialBasis ? ` <small>(berdasarkan ${escapeHTML(item.potentialBasis)})</small>` : ""}` : '<span class="potential-status-pill potential-status-unknown">Tidak tersedia pada hasil clustering</span>'}</li>
                <li><strong>Top 3 komoditas:</strong> ${item.topCommodities.length
                    ? item.topCommodities.map(commodity => `${escapeHTML(commodity.name)} (${formatNumber(commodity.production, 1)} ${escapeHTML(item.unit || "kg")})`).join("; ")
                    : "Data produksi komoditas belum tersedia."}</li>
            </ul>
        </div>
    `).join("");
}

const CROP_CLUSTER_CONFIG = {
    biofarmaka: {
        label: "Biofarmaka",
        chartId: "bioClusterChart",
        summaryId: "bioClusterInfo",
        tableId: "bioClusterTable"
    },
    hortikultura: {
        label: "Hortikultura",
        chartId: "hortiClusterChart",
        summaryId: "hortiClusterInfo",
        tableId: "hortiClusterTable"
    }
};

function loadCropClusterAnalyses() {
    return Promise.all(Object.keys(CROP_CLUSTER_CONFIG).map(loadCropClusterAnalysis));
}

function loadKetahananAnalyses() {
    setupPotentialAnalysisFilters();
    return Promise.all([loadClustering(), loadRecommendations(), loadCropClusterAnalyses()]);
}

async function loadCropClusterAnalysis(category) {
    const config = CROP_CLUSTER_CONFIG[category];
    if (!config) return;
    cropClusterAnalysisLoaded[category] = false;
    delete cropClusterAnalysisErrors[category];
    setTableLoading(config.tableId, 4);
    try {
        const response = await apiFetch(`/api/v1/model/crop-clustering?kategori=${encodeURIComponent(category)}`);
        if (!Array.isArray(response.clusters) || !response.clusters.length) {
            throw new Error(`Data klaster ${config.label} belum tersedia.`);
        }
        cropClusterAnalysisData[category] = response;
        cropClusterAnalysisLoaded[category] = true;
        renderCropClusterAnalysis(response, config);
        if (document.getElementById("potentialCategoryFilter")?.value === category) {
            populatePotentialRegionFilter(category);
        }
        renderCommodityPotentialAnalysis();
    } catch (error) {
        cropClusterAnalysisData[category] = null;
        cropClusterAnalysisLoaded[category] = true;
        cropClusterAnalysisErrors[category] = error.message;
        destroyChart(config.chartId);
        setTableEmpty(config.tableId, `Gagal memuat data ${config.label}: ${error.message}`, 4);
        setText(config.summaryId, `Gagal memuat karakteristik cluster: ${error.message}`);
        renderCommodityPotentialAnalysis();
    }
}

function renderCropClusterAnalysis(response, config) {
    const clusterRows = response.clusters;
    const productionRows = Array.isArray(response.production) ? response.production : [];
    const clusterGroups = new Map();
    clusterRows.forEach(row => {
        const cluster = String(getValue(row, ["cluster", "klaster"]) ?? "Tidak diketahui");
        if (!clusterGroups.has(cluster)) clusterGroups.set(cluster, []);
        clusterGroups.get(cluster).push(row);
    });
    const totalsByRegion = aggregateCommodityProductionByRegion(
        productionRows,
        ["kecamatan", "nama_kecamatan", "wilayah"],
        ["komoditas", "tanaman"],
        ["produksi", "produksi_kg"]
    );
    const details = [...clusterGroups.entries()].map(([id, members]) => {
        const regions = members.map(row => row.kecamatan).filter(Boolean);
        const averages = members.map(row => toNumber(getValue(row, ["produksi_rata2_kg_per_tahun"]))).filter(value => value !== null);
        return {
            id,
            members,
            count: members.length,
            percentage: clusterRows.length ? members.length / clusterRows.length * 100 : 0,
            averageProduction: averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null,
            potentialLabel: getValue(members[0], ["kategori_potensi", "status_potensi", "potential_label"]),
            unit: "kg",
            averageUnit: "kg/tahun",
            topCommodities: getTopCommodityContributions(regions, totalsByRegion),
            kecamatan: []
        };
    }).sort((a, b) => a.id.localeCompare(b.id, "id", { numeric: true }));

    const comparableAverages = details.map(item => item.averageProduction).filter(value => value !== null);
    const uniqueAverages = [...new Set(comparableAverages)].sort((a, b) => a - b);
    details.forEach(item => {
        if (item.potentialLabel || item.averageProduction === null) return;
        item.potentialBasis = "rerata produksi tahunan relatif antarcluster";
        if (uniqueAverages.length === 1) {
            item.potentialLabel = "Potensi Relatif Setara";
        } else if (item.averageProduction === uniqueAverages[uniqueAverages.length - 1]) {
            item.potentialLabel = "Potensi Tinggi";
        } else if (item.averageProduction === uniqueAverages[0]) {
            item.potentialLabel = "Potensi Rendah";
        } else {
            item.potentialLabel = "Potensi Sedang";
        }
    });

    renderClusterDistribution(details, config.chartId);
    renderClusterDescription(details, config.summaryId);

    const table = document.getElementById(config.tableId);
    if (!table) return;
    const sorted = [...clusterRows].sort((a, b) =>
        (toNumber(b.produksi_rata2_kg_per_tahun) ?? -Infinity) -
        (toNumber(a.produksi_rata2_kg_per_tahun) ?? -Infinity)
    );
    table.innerHTML = sorted.map(row => `
        <tr>
            <td><strong>${escapeHTML(row.kecamatan ?? "—")}</strong></td>
            <td><span class="cluster-id-pill">Cluster ${escapeHTML(row.cluster ?? "—")}</span></td>
            <td>${formatNumber(row.produksi_rata2_kg_per_tahun, 1)}</td>
            <td>${escapeHTML(formatCommodityList(row.top3_komoditas ?? "—"))}</td>
        </tr>
    `).join("");
}

function renderGenericTable(id, rows, headers = []) {
    const table = document.getElementById(id);
    if (!table) return;
    if (!rows.length) { setTableEmpty(id, "Data belum tersedia.", headers.length || 4); return; }
    headers = headers.filter(header => rows.some(row => header in row));
    if (!headers.length) headers = Object.keys(rows[0]);
    const head = table.closest("table")?.querySelector("thead tr");
    if (head) head.innerHTML = headers.map(header => `<th>${escapeHTML(header)}</th>`).join("");
    table.innerHTML = rows.map(row => `<tr>${headers.map(header => { const value = row[header]; return `<td>${escapeHTML(typeof value === "number" ? formatNumber(value) : value ?? "—")}</td>`; }).join("")}</tr>`).join("");
}

async function loadRecommendations() {
    recommendationLoaded = false;
    recommendationError = null;
    setTableLoading("tabelRekomendasi");
    try {
        const response = await apiFetch("/api/v1/model/rekomendasi");
        recommendationData = getRecords(response).filter(row =>
            String(getValue(row, ["tanaman", "komoditas"]) ?? "").trim() && getRecommendationScore(row) !== null
        );
        recommendationLoaded = true;
        if (document.getElementById("potentialCategoryFilter")?.value === "tanaman_pangan") {
            populatePotentialRegionFilter("tanaman_pangan");
        }
        renderCommodityPotentialAnalysis();
    } catch (error) {
        recommendationData = [];
        recommendationError = error.message;
        recommendationLoaded = true;
        if (document.getElementById("potentialCategoryFilter")?.value === "tanaman_pangan") {
            populatePotentialRegionFilter("tanaman_pangan");
        }
        renderCommodityPotentialAnalysis();
    }
}

function getRecommendationScore(row) {
    return toNumber(getValue(row, ["skor_potensi", "skor_rekomendasi", "score"]));
}

function setupPotentialAnalysisFilters() {
    const categoryFilter = document.getElementById("potentialCategoryFilter");
    const regionFilter = document.getElementById("recommendationKecamatanFilter");
    if (categoryFilter && !categoryFilter.dataset.listenerAdded) {
        categoryFilter.addEventListener("change", () => {
            if (regionFilter) regionFilter.value = "";
            populatePotentialRegionFilter(categoryFilter.value, false);
            renderCommodityPotentialAnalysis();
        });
        categoryFilter.dataset.listenerAdded = "true";
    }
    if (regionFilter && !regionFilter.dataset.listenerAdded) {
        regionFilter.addEventListener("change", renderCommodityPotentialAnalysis);
        regionFilter.dataset.listenerAdded = "true";
    }
}

function populatePotentialRegionFilter(category, preserveSelection = true) {
    const filter = document.getElementById("recommendationKecamatanFilter");
    if (!filter) return;
    const previous = preserveSelection ? filter.value : "";
    let rows = [];
    if (category === "tanaman_pangan") {
        const recommendationRegions = recommendationData.map(row => getValue(row, ["kecamatan", "nama_kecamatan", "wilayah"]));
        rows = recommendationRegions.some(Boolean) ? recommendationRegions : clusteringData.map(row => getValue(row, ["kecamatan", "nama_kecamatan", "wilayah"]));
    } else {
        rows = cropClusterAnalysisData[category]?.clusters?.map(row => getValue(row, ["kecamatan", "nama_kecamatan", "wilayah"])) || [];
    }
    const regions = [...new Set(rows.map(value => String(value ?? "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "id"));
    filter.innerHTML = `<option value="">Semua Kecamatan</option>${regions.map(region => `<option value="${escapeHTML(region)}">${escapeHTML(region)}</option>`).join("")}`;
    filter.value = regions.find(region => normalizeRegionName(region) === normalizeRegionName(previous)) || "";
}

function renderCommodityPotentialAnalysis() {
    const category = document.getElementById("potentialCategoryFilter")?.value || "tanaman_pangan";
    const selectedRegion = document.getElementById("recommendationKecamatanFilter")?.value || "";
    const container = document.getElementById("recommendationRanking");
    const caption = document.getElementById("recommendationRankingCaption");
    const mode = document.getElementById("commodityAnalysisMode");
    const details = document.getElementById("recommendationTableWrapper");
    const isFoodCategory = category === "tanaman_pangan";
    if (!container) return;
    if (details) details.hidden = !isFoodCategory || !selectedRegion;
    if (mode) {
        mode.textContent = isFoodCategory
            ? "Tanaman Pangan — Rekomendasi Komoditas berbasis model"
            : `${CROP_CLUSTER_CONFIG[category]?.label || category} — Potensi Komoditas Unggulan`;
    }
    if (isFoodCategory) {
        if (!recommendationLoaded) {
            container.innerHTML = "<p>Memuat hasil rekomendasi Tanaman Pangan...</p>";
            if (caption) caption.textContent = "Mengambil skor rekomendasi dari API.";
            renderPotentialAnalysisChart([], { emptyMessage: "Memuat skor rekomendasi dari API." });
            return;
        }
        if (recommendationError) {
            container.innerHTML = `<p>Gagal memuat rekomendasi: ${escapeHTML(recommendationError)}</p>`;
            if (caption) caption.textContent = "Data rekomendasi tidak tersedia.";
            if (selectedRegion) setTableEmpty("tabelRekomendasi", "Data rekomendasi gagal dimuat.", 4);
            renderPotentialAnalysisChart([], { emptyMessage: "Grafik rekomendasi tidak tersedia." });
            return;
        }
        renderFoodRecommendationPotential(selectedRegion, container, caption);
        return;
    }

    const clusterData = cropClusterAnalysisData[category];
    if (!cropClusterAnalysisLoaded[category]) {
        container.innerHTML = `<p>Memuat data potensi ${escapeHTML(CROP_CLUSTER_CONFIG[category]?.label || category)}...</p>`;
        if (caption) caption.textContent = "Mengambil hasil analisis clustering dan daftar Top 3 komoditas.";
        renderPotentialAnalysisChart([], { emptyMessage: "Memuat data potensi komoditas." });
        return;
    }
    if (cropClusterAnalysisErrors[category]) {
        container.innerHTML = `<p>Gagal memuat analisis: ${escapeHTML(cropClusterAnalysisErrors[category])}</p>`;
        if (caption) caption.textContent = "Data potensi komoditas tidak tersedia.";
        renderPotentialAnalysisChart([], { emptyMessage: "Grafik potensi komoditas tidak tersedia." });
        return;
    }
    renderCropCommodityPotential(clusterData?.clusters || [], selectedRegion, container, caption);
}

function renderFoodRecommendationPotential(selectedRegion, container, caption) {
    const rows = recommendationData.filter(row =>
        !selectedRegion || normalizeRegionName(getValue(row, ["kecamatan", "nama_kecamatan", "wilayah"])) === normalizeRegionName(selectedRegion)
    );
    const groups = new Map();
    rows.forEach(row => {
        const name = String(getValue(row, ["tanaman", "komoditas"]) ?? "").trim();
        const score = getRecommendationScore(row);
        if (!name || score === null) return;
        const current = groups.get(name) || { name, total: 0, count: 0 };
        current.total += score;
        current.count++;
        groups.set(name, current);
    });
    const ranked = [...groups.values()]
        .map(item => ({ name: item.name, score: item.total / item.count }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "id"));
    const topFive = ranked.slice(0, 5);
    if (caption) {
        caption.textContent = selectedRegion
            ? `Top 5 rekomendasi untuk ${selectedRegion}; persentase = skor API relatif terhadap skor tertinggi, bukan probabilitas.`
            : "Top 5 agregat menggunakan rata-rata skor API per komoditas; persentase relatif terhadap skor tertinggi, bukan probabilitas.";
    }
    if (!topFive.length) {
        container.innerHTML = `<p>${selectedRegion ? "Rekomendasi untuk kecamatan ini belum tersedia." : "Output rekomendasi yang valid belum tersedia."}</p>`;
        if (selectedRegion) setTableEmpty("tabelRekomendasi", "Rekomendasi untuk kecamatan ini belum tersedia.", 4);
        renderPotentialAnalysisChart([], { emptyMessage: "Data numerik rekomendasi belum tersedia." });
        return;
    }

    const maximum = Math.max(...topFive.map(item => item.score));
    renderPotentialRanking(topFive.map(item => {
        const relativeScore = maximum > 0 ? Math.max(0, Math.min(100, item.score / maximum * 100)) : 0;
        return {
            name: item.name,
            value: relativeScore,
            valueLabel: `${formatNumber(relativeScore, 1)}%`,
            secondaryLabel: `Skor API: ${formatNumber(item.score, 3)}`
        };
    }), container, true, {
        title: "Grafik Skor Rekomendasi",
        caption: "Skor relatif terhadap nilai tertinggi; bukan probabilitas.",
        datasetLabel: "Skor relatif",
        unit: "%",
        maxValue: 100,
        emptyMessage: "Skor rekomendasi numerik belum tersedia."
    });

    const details = document.getElementById("recommendationTableWrapper");
    if (!selectedRegion || !details) return;
    const table = document.getElementById("tabelRekomendasi");
    if (!table) return;
    const topRows = rows
        .slice()
        .sort((a, b) => (toNumber(a.rank) ?? Number.MAX_SAFE_INTEGER) - (toNumber(b.rank) ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 5);
    if (!topRows.length) {
        setTableEmpty("tabelRekomendasi", "Rekomendasi untuk kecamatan ini belum tersedia.", 4);
        return;
    }
    table.innerHTML = topRows.map(row => `
        <tr>
            <td>${escapeHTML(getValue(row, ["kecamatan", "nama_kecamatan", "wilayah"]) ?? "—")}</td>
            <td>${formatNumber(row.rank, 0)}</td>
            <td>${escapeHTML(getValue(row, ["tanaman", "komoditas"]) ?? "—")}</td>
            <td>${formatNumber(getRecommendationScore(row), 3)}</td>
        </tr>
    `).join("");
}

function renderCropCommodityPotential(clusterRows, selectedRegion, container, caption) {
    const rows = selectedRegion
        ? clusterRows.filter(row => normalizeRegionName(getValue(row, ["kecamatan", "nama_kecamatan", "wilayah"])) === normalizeRegionName(selectedRegion))
        : clusterRows;
    if (selectedRegion) {
        const selected = rows[0];
        const commodities = selected ? formatCommodityList(getValue(selected, ["top3_komoditas"], "") ?? "").split(",").map(value => value.trim()).filter(value => value && value !== "—") : [];
        if (caption) caption.textContent = `Top 3 komoditas unggulan ${selectedRegion} sesuai urutan hasil analisis clustering. Data ini bukan rekomendasi dari model.`;
        if (!commodities.length) {
            container.innerHTML = `<p>Data Top 3 komoditas untuk ${escapeHTML(selectedRegion)} belum tersedia.</p>`;
            renderPotentialAnalysisChart([], { emptyMessage: "Data Top 3 untuk wilayah ini belum tersedia." });
            return;
        }
        renderPotentialRanking(commodities.map(name => ({ name, valueLabel: "", value: null, secondaryLabel: "" })), container, false, {
            title: "Komoditas Unggulan Wilayah",
            caption: "Urutan Top 3 tersedia, tetapi tidak ada skor numerik untuk dibuat grafik.",
            emptyMessage: "Tidak ada nilai numerik untuk grafik; daftar di kanan mengikuti urutan Top 3."
        });
        return;
    }

    const frequencies = new Map();
    rows.forEach(row => {
        const commodities = new Set(
            formatCommodityList(getValue(row, ["top3_komoditas"], "") ?? "").split(",")
                .map(value => value.trim()).filter(value => value && value !== "—")
        );
        commodities.forEach(name => frequencies.set(name, (frequencies.get(name) || 0) + 1));
    });
    const ranked = [...frequencies.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "id"))
        .slice(0, 5);
    if (caption) caption.textContent = "Top 5 berdasarkan jumlah kecamatan yang mencantumkan komoditas dalam Top 3 unggulan; bukan skor rekomendasi.";
    if (!ranked.length) {
        container.innerHTML = "<p>Data Top 3 komoditas belum tersedia untuk kategori ini.</p>";
        renderPotentialAnalysisChart([], { emptyMessage: "Data frekuensi Top 3 belum tersedia." });
        return;
    }
    const maximum = Math.max(...ranked.map(item => item.count));
    renderPotentialRanking(ranked.map(item => ({
        name: item.name,
        value: maximum ? item.count / maximum * 100 : 0,
        valueLabel: `${formatNumber(item.count, 0)} kecamatan`,
        chartValue: item.count,
        secondaryLabel: "Frekuensi kemunculan dalam Top 3"
    })), container, true, {
        title: "Frekuensi Top 3 Komoditas",
        caption: "Jumlah kecamatan yang mencantumkan komoditas dalam Top 3.",
        datasetLabel: "Jumlah kecamatan",
        unit: "kecamatan",
        emptyMessage: "Data frekuensi Top 3 belum tersedia."
    });
}

function renderPotentialRanking(items, container, showBars, chartOptions = {}) {
    renderPotentialAnalysisChart(items, chartOptions, showBars);
    if (!items.length) {
        container.innerHTML = "<p>Data komoditas belum tersedia.</p>";
        return;
    }
    container.innerHTML = items.map((item, index) => `
        <div class="recommendation-ranking-item">
            <div class="recommendation-ranking-heading">
                <span class="recommendation-ranking-number">${index + 1}</span>
                <strong class="recommendation-ranking-name">${escapeHTML(formatCommodityName(item.name))}</strong>
                <span class="recommendation-ranking-value">${escapeHTML(item.valueLabel || "")}</span>
            </div>
            ${showBars ? `<div class="recommendation-ranking-track"><div class="recommendation-ranking-fill" style="width:${Math.max(0, Math.min(100, item.value || 0))}%"></div></div>` : ""}
            ${item.secondaryLabel ? `<small class="recommendation-ranking-score">${escapeHTML(item.secondaryLabel)}</small>` : ""}
        </div>
    `).join("");
}

function renderPotentialAnalysisChart(items, options = {}, showBars = true) {
    const canvas = document.getElementById("potentialAnalysisChart");
    const empty = document.getElementById("potentialAnalysisChartEmpty");
    const title = document.getElementById("potentialAnalysisChartTitle");
    const caption = document.getElementById("potentialAnalysisChartCaption");
    if (title) title.textContent = options.title || "Grafik Potensi & Rekomendasi";
    if (caption) caption.textContent = options.caption || "";
    if (!canvas || !empty) return;

    const chartItems = items.map(item => ({
        name: formatCommodityName(item.name),
        value: toNumber(item.chartValue ?? (showBars ? item.value : null))
    })).filter(item => item.name && item.value !== null);
    if (!chartItems.length || typeof Chart === "undefined") {
        destroyChart("potentialAnalysisChart");
        canvas.hidden = true;
        empty.hidden = false;
        empty.textContent = options.emptyMessage || "Data numerik untuk grafik belum tersedia.";
        return;
    }

    canvas.hidden = false;
    empty.hidden = true;
    const values = chartItems.map(item => item.value);
    const maxValue = options.maxValue ?? Math.ceil(Math.max(...values) * 1.12);
    const chart = createChart("potentialAnalysisChart", {
        type: "bar",
        data: {
            labels: chartItems.map(item => item.name),
            datasets: [{
                label: options.datasetLabel || "Nilai",
                data: values,
                backgroundColor: "rgba(96, 152, 44, 0.78)",
                borderColor: "#4f8229",
                borderWidth: 1,
                borderRadius: 5,
                barThickness: 17
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => `${options.datasetLabel || "Nilai"}: ${formatNumber(context.parsed.x, 1)} ${options.unit || ""}`.trim()
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    max: maxValue || undefined,
                    grid: { color: "#edf1eb" },
                    ticks: {
                        maxTicksLimit: 5,
                        font: chartFont(),
                        callback: value => `${formatNumber(value, 0)}${options.unit === "%" ? "%" : ""}`
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        font: chartFont(),
                        autoSkip: false,
                        callback: (value, index) => {
                            const label = chartItems[index]?.name || String(value ?? "");
                            return label.length > 18 ? `${label.slice(0, 17)}…` : label;
                        }
                    }
                }
            }
        }
    });
    if (!chart) {
        canvas.hidden = true;
        empty.hidden = false;
        empty.textContent = "Grafik gagal ditampilkan.";
    }
}

async function loadModelComparison() {
    try {
        const response = await apiFetch("/api/v1/model/comparison");
        const rows = getRecords(response);
        renderGenericTable("tabelPerbandinganModel", rows, ["kecamatan", "tanaman", "target", "best_model"]);
    } catch (error) { setTableEmpty("tabelPerbandinganModel", error.message); }
}


/* ==========================================================
   8. FORECASTING & RISK
========================================================== */

async function loadForecastWeatherRisk() {
    if (!DEFAULT_ADM4) return { error: "Kode wilayah BMKG belum diisi." };
    try {
        return { data: await apiFetch(`/api/v1/ews-cuaca/${encodeURIComponent(DEFAULT_ADM4)}`) };
    } catch (error) {
        return { error: error.message };
    }
}

async function loadForecasting() {
    const requestVersion = ++forecastRequestVersion;
    const category = document.getElementById("forecastKategori")?.value || "tanaman_pangan";
    const weatherPromise = loadForecastWeatherRisk();
    forecastWeatherState = { loading: true };
    setText("forecastingSummary", "Memuat hasil forecasting...");
    const riskContainer = document.getElementById("riskList");
    if (riskContainer) riskContainer.innerHTML = "<p>Memuat indikator produksi dan EWS cuaca...</p>";

    try {
        const response = await apiFetch(`/api/v1/model/forecasting?kategori=${encodeURIComponent(category)}`);
        if (requestVersion !== forecastRequestVersion) return;
        forecastingData = getRecords(response);
        populateForecastRegion();
        populateForecastCommodity();
        if (!forecastingData.length) {
            destroyChart("forecastingChart");
            forecastPoints = [];
            forecastUnit = "";
            setText("forecastingSummary", "Data forecasting belum tersedia untuk kategori ini.");
            return;
        }
        renderForecastChart();
    } catch (error) {
        if (requestVersion !== forecastRequestVersion) return;
        forecastingData = [];
        forecastPoints = [];
        forecastUnit = "";
        destroyChart("forecastingChart");
        populateForecastRegion();
        populateForecastCommodity();
        setText("forecastingSummary", `Gagal memuat forecasting: ${error.message}`);
    } finally {
        const weatherState = await weatherPromise;
        if (requestVersion === forecastRequestVersion) {
            forecastWeatherState = weatherState;
            renderForecastRisk(forecastPoints, forecastUnit);
        }
    }
}

function getForecastColumns() {
    if (!forecastingData.length) return {};
    const probe = {};
    forecastingData.slice(0, 50).forEach(row => Object.keys(row || {}).forEach(key => { probe[key] = null; }));
    return {
        commodity: findKey(probe, ["tanaman", "komoditas", "commodity"]),
        kecamatan: findKey(probe, ["kecamatan", "wilayah"]),
        date: findKey(probe, ["tahun", "year", "periode", "tanggal", "ds"]),
        value: findKey(probe, ["nilai", "value", "y", "yhat", "produksi_ton", "produksi"]),
        type: findKey(probe, ["tipe", "type", "jenis_data", "status_data", "is_forecast"]),
        target: findKey(probe, ["target"]),
        actual: findKey(probe, ["aktual", "actual", "y_actual", "y_true"]),
        forecast: findKey(probe, ["prediksi", "forecast", "y_pred", "y_hat"]),
        level: findKey(probe, ["level", "tingkat"]),
        unit: findKey(probe, ["unit", "satuan"])
    };
}

function classifyForecastType(raw, typeKey) {
    const text = String(raw ?? "").trim().toLowerCase();
    if (normalizeKey(typeKey) === "is_forecast") return ["true", "1", "ya", "yes"].includes(text) ? "forecast" : "actual";
    if (/aktual|actual|histor|observ|real|latih|train/.test(text)) return "actual";
    if (/prediksi|predict|pred|forecast|proyeksi|future|ramalan/.test(text)) return "forecast";
    return null;
}

function getForecastSeriesKey(row, cols) {
    const level = cols.level ? normalizeKey(row[cols.level]) : "";
    const region = cols.kecamatan ? normalizeRegionName(row[cols.kecamatan]) : "";
    const commodity = cols.commodity ? normalizeKey(row[cols.commodity]) : "";
    return `${level}|${region}|${commodity}`;
}

function getForecastRecordKind(row, cols) {
    if (cols.actual && cols.forecast) {
        if (toNumber(row[cols.forecast]) !== null) return "forecast";
        if (toNumber(row[cols.actual]) !== null) return "actual";
        return null;
    }
    return cols.type ? classifyForecastType(row[cols.type], cols.type) : null;
}

function extractForecastPoints(rows, cols) {
    const points = [];
    const wide = cols.actual && cols.forecast;
    const long = !wide && cols.value && cols.type;
    rows.forEach(row => {
        const match = String(row[cols.date] ?? "").match(/\d{4}/);
        if (!match) return;
        const year = Number(match[0]);
        const kecamatan = cols.kecamatan ? String(row[cols.kecamatan] ?? "").trim() : "";
        const seriesKey = getForecastSeriesKey(row, cols);
        if (wide) {
            const actual = toNumber(row[cols.actual]);
            const forecast = toNumber(row[cols.forecast]);
            if (actual !== null) points.push({ year, kecamatan, seriesKey, kind: "actual", value: actual });
            if (forecast !== null) points.push({ year, kecamatan, seriesKey, kind: "forecast", value: forecast });
            return;
        }
        const value = toNumber(row[cols.value]);
        if (value === null) return;
        const kind = long ? getForecastRecordKind(row, cols) : null;
        if (kind) points.push({ year, kecamatan, seriesKey, kind, value });
    });
    return points;
}

function isForecastDataRow(row, cols) {
    if (cols.actual && cols.forecast) return toNumber(row[cols.forecast]) !== null;
    return Boolean(
        cols.value &&
        cols.type &&
        getForecastRecordKind(row, cols) === "forecast" &&
        toNumber(row[cols.value]) !== null
    );
}

function filterForecastComparableRows(rows, cols) {
    const forecastSeries = new Set(rows.filter(row => isForecastDataRow(row, cols)).map(row => getForecastSeriesKey(row, cols)));
    return rows.filter(row => {
        const kind = getForecastRecordKind(row, cols);
        return kind === "forecast" || (kind === "actual" && forecastSeries.has(getForecastSeriesKey(row, cols)));
    });
}

function getForecastRowsForLocation(rows, cols) {
    const location = document.getElementById("forecastKecamatan")?.value || "kabupaten";
    if (!cols.kecamatan) return location === "kabupaten" ? rows : [];
    if (cols.level) {
        return rows.filter(row => {
            const level = normalizeKey(row[cols.level]);
            if (location === "kabupaten") return level === "kabupaten";
            return level === "kecamatan" && normalizeRegionName(row[cols.kecamatan]) === normalizeRegionName(location);
        });
    }
    if (location === "kabupaten") return rows;
    return rows.filter(row => normalizeRegionName(row[cols.kecamatan]) === normalizeRegionName(location));
}

function formatForecastCommodity(value) {
    return String(value ?? "").replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function populateForecastRegion() {
    const dropdown = document.getElementById("forecastKecamatan");
    if (!dropdown) return;
    const cols = getForecastColumns();
    const regions = cols.kecamatan
        ? [...new Set(forecastingData.filter(row => isForecastDataRow(row, cols)).map(row => String(row[cols.kecamatan] ?? "").trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, "id"))
        : [];
    const previous = dropdown.value;
    dropdown.innerHTML = `<option value="kabupaten">Kabupaten Kediri</option>${regions.map(item => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join("")}`;
    dropdown.value = previous === "kabupaten" || regions.includes(previous) ? previous : "kabupaten";
}

function populateForecastCommodity() {
    const dropdown = document.getElementById("forecastKomoditas");
    if (!dropdown) return;
    const cols = getForecastColumns();
    const rows = getForecastRowsForLocation(forecastingData.filter(row => isForecastDataRow(row, cols)), cols);
    const commodities = cols.commodity
        ? [...new Set(rows.map(row => String(row[cols.commodity] ?? "").trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, "id"))
        : [];
    const previous = dropdown.value;
    dropdown.innerHTML = `<option value="">Semua Komoditas</option>${commodities.map(item => `<option value="${escapeHTML(item)}">${escapeHTML(formatForecastCommodity(item))}</option>`).join("")}`;
    dropdown.value = commodities.includes(previous) ? previous : "";
    selectedForecastCommodity = dropdown.value;
}

function renderForecastChart(commodity = "") {
    const canvas = document.getElementById("forecastingChart") || document.getElementById("predictionChart");
    if (!canvas || !forecastingData.length) return;
    const cols = getForecastColumns();
    if (!cols.date) {
        destroyChart(canvas.id);
        setText("forecastingSummary", `Kolom tahun tidak ditemukan. Kolom tersedia: ${Object.keys(forecastingData[0]).join(", ")}`);
        forecastPoints = [];
        renderForecastRisk(forecastPoints, "");
        return;
    }
    let rows = getForecastRowsForLocation(forecastingData, cols);
    const selectedCommodity = (typeof commodity === "string" ? commodity : "") || document.getElementById("forecastKomoditas")?.value || "";
    if (selectedCommodity && cols.commodity) rows = rows.filter(row => String(row[cols.commodity]) === selectedCommodity);
    const category = document.getElementById("forecastKategori")?.value || "tanaman_pangan";
    const locationLabel = document.getElementById("forecastKecamatan")?.selectedOptions?.[0]?.textContent || "Kabupaten Kediri";

    // Filter target hanya jika kolom target memang ada; jika tidak, seluruh baris dianggap produksi.
    if (cols.target) {
        const available = [...new Set(rows.map(row => String(row[cols.target] || "").trim().toLowerCase()))];
        const targetProduksi = ["produksi_ton", "produksi", "jumlah_produksi"].find(target => available.includes(target));
        if (!targetProduksi) {
            destroyChart(canvas.id);
            setText("forecastingSummary", "Data prediksi produksi tidak tersedia. Dataset hanya memuat target: " + available.join(", "));
            forecastPoints = [];
            renderForecastRisk(forecastPoints, "");
            return;
        }
        rows = rows.filter(row => String(row[cols.target] || "").trim().toLowerCase() === targetProduksi);
    }

    rows = filterForecastComparableRows(rows, cols);
    const points = extractForecastPoints(rows, cols);
    if (!points.length) {
        destroyChart(canvas.id);
        setText("forecastingSummary", "Data aktual dan prediksi belum tersedia untuk komoditas atau kecamatan yang dipilih.");
        forecastPoints = [];
        renderForecastRisk(forecastPoints, "");
        return;
    }

    const grouped = { actual: new Map(), forecast: new Map() };
    points.forEach(point => {
        const byYear = grouped[point.kind];
        if (!byYear.has(point.year)) byYear.set(point.year, { total: 0, series: new Set() });
        const yearGroup = byYear.get(point.year);
        yearGroup.total += point.value;
        yearGroup.series.add(point.seriesKey);
    });

    const years = [...new Set([...grouped.actual.keys(), ...grouped.forecast.keys()])].sort((a, b) => a - b);
    const labels = years.map(String);
    const forecastSeries = new Set([...grouped.forecast.values()].flatMap(group => [...group.series]));
    const hasSameCoverage = (first, second) =>
        first.size === second.size && [...first].every(series => second.has(series));
    const isComplete = (group) => Boolean(group && hasSameCoverage(group.series, forecastSeries));
    const actualValues = years.map(year => {
        const group = grouped.actual.get(year);
        return isComplete(group) ? group.total : null;
    });
    const partialActualValues = years.map(year => {
        const group = grouped.actual.get(year);
        return group && !isComplete(group) ? group.total : null;
    });
    const forecastValues = years.map(year => {
        const group = grouped.forecast.get(year);
        return isComplete(group) ? group.total : null;
    });
    const partialForecastValues = years.map(year => {
        const group = grouped.forecast.get(year);
        return group && !isComplete(group) ? group.total : null;
    });
    const units = [...new Set(rows.map(row => String(cols.unit ? row[cols.unit] ?? "" : "").trim()).filter(Boolean))];
    const unit = units.length === 1 ? units[0] : units.length > 1 ? "beragam satuan" : (cols.value || "").toLowerCase().includes("ton") ? "ton" : "unit";
    const forecastLabel = category === "biofarmaka" ? "Prediksi ETS" : "Prediksi Model";
    forecastPoints = points;
    forecastUnit = unit;

    const datasets = [{
        label: "Aktual",
        data: actualValues,
        borderColor: "#265322",
        backgroundColor: "rgba(38,83,34,0.1)",
        borderWidth: 3,
        tension: 0.3,
        pointRadius: 4,
        spanGaps: false
    }];
    if (partialActualValues.some(value => value !== null)) {
        datasets.push({
            label: "Aktual (cakupan parsial)",
            data: partialActualValues,
            borderColor: "#265322",
            backgroundColor: "#ffffff",
            borderWidth: 2,
            pointRadius: 5,
            pointStyle: "triangle",
            showLine: false
        });
    }

    const forecastYears = [...grouped.forecast.keys()].sort((a, b) => a - b);
    const firstForecastYear = forecastYears[0];
    const firstForecastGroup = grouped.forecast.get(firstForecastYear);
    const transitionActualYear = years
        .filter(year => year + 1 === firstForecastYear && hasSameCoverage(grouped.actual.get(year)?.series || new Set(), firstForecastGroup?.series || new Set()))
        .sort((a, b) => b - a)[0];
    if (transitionActualYear !== undefined && firstForecastGroup) {
        const transitionValues = years.map(year => {
            if (year === transitionActualYear) return grouped.actual.get(year).total;
            if (year === firstForecastYear) return firstForecastGroup.total;
            return null;
        });
        datasets.push({
            label: "Transisi (cakupan sebanding)",
            data: transitionValues,
            borderColor: "#B7791F",
            borderDash: [7, 5],
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 0,
            pointHoverRadius: 0,
            tension: 0.3,
            spanGaps: false
        });
    }
    datasets.push({
        label: forecastLabel,
        data: forecastValues,
        borderColor: "#B7791F",
        backgroundColor: "rgba(183,121,31,0.08)",
        borderDash: [7, 5],
        borderWidth: 3,
        tension: 0.3,
        pointRadius: 4,
        spanGaps: false
    });
    if (partialForecastValues.some(value => value !== null)) {
        datasets.push({
            label: `${forecastLabel} (cakupan parsial)`,
            data: partialForecastValues,
            borderColor: "#B7791F",
            backgroundColor: "#ffffff",
            borderWidth: 2,
            pointRadius: 5,
            pointStyle: "triangle",
            showLine: false
        });
    }

    const legend = chartLegend();
    createChart(canvas.id, {
        type: "line",
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    ...legend,
                    labels: {
                        ...legend.labels,
                        font: { family: "Poppins", size: 11 },
                        filter: item => item.text !== "Transisi (cakupan sebanding)"
                    }
                },
                subtitle: { display: true, text: `${formatForecastCommodity(category)} · ${locationLabel} · ${unit}`, font: { family: "Poppins", size: 10 } }
            },
            scales: {
                ...chartScales(),
                x: { ...chartScales().x, title: { display: true, text: "Periode" } },
                y: { ...chartScales().y, title: { display: true, text: `Produksi (${unit})` } }
            }
        }
    });
    const periods = labels.length ? `${labels[0]}–${labels[labels.length - 1]}` : "periode tidak diketahui";
    const summary = document.getElementById("forecastingSummary");
    const actualYears = [...grouped.actual.keys()].sort((a, b) => b - a);
    const latestActualYear = actualYears[0];
    const nextForecastYear = forecastYears.find(year => latestActualYear !== undefined && year > latestActualYear);
    let coverageNote = "";
    if (latestActualYear !== undefined && nextForecastYear !== undefined) {
        const actualGroup = grouped.actual.get(latestActualYear);
        const futureForecastGroup = grouped.forecast.get(nextForecastYear);
        const comparableActualSeries = [...actualGroup.series].filter(series => futureForecastGroup.series.has(series));
        if (!hasSameCoverage(actualGroup.series, futureForecastGroup.series)) {
            const availableActual = points
                .filter(point => point.kind === "actual" && point.year === latestActualYear && futureForecastGroup.series.has(point.seriesKey))
                .reduce((sum, point) => sum + point.value, 0);
            coverageNote = `Aktual ${latestActualYear} mencakup ${comparableActualSeries.length}/${futureForecastGroup.series.size} seri yang diprediksi ${nextForecastYear}; ${formatNumber(availableActual)} ${unit} adalah subtotal data tersedia dan tidak sebanding dengan total prediksi.`;
        }
    }
    if (summary) summary.innerHTML = `<p>${rows.length} baris data · ${periods} · satuan ${escapeHTML(unit)}.</p>${coverageNote ? `<p class="forecast-data-note">${escapeHTML(coverageNote)}</p>` : ""}`;
    renderForecastRisk(points, unit);
}

function renderForecastRisk(points, unit = "") {
    const container = document.getElementById("riskList");
    if (!container) return;

    const actualYears = [...new Set(points.filter(point => point.kind === "actual").map(point => point.year))].sort((a, b) => b - a);
    const lastActualYear = actualYears[0];
    const forecastYears = [...new Set(points.filter(point => point.kind === "forecast").map(point => point.year))]
        .filter(year => lastActualYear !== undefined && year > lastActualYear)
        .sort((a, b) => a - b);
    const nextForecastYear = forecastYears[0];
    let productionLevel = "Data terbatas";
    let productionReason = "Belum tersedia pasangan periode aktual dan prediksi yang dapat dibandingkan.";
    let productionClass = "forecast-risk-muted";
    if (lastActualYear !== undefined && nextForecastYear !== undefined) {
        const actualBySeries = new Map();
        const forecastBySeries = new Map();
        points.forEach(point => {
            if (point.year === lastActualYear && point.kind === "actual") {
                actualBySeries.set(point.seriesKey, (actualBySeries.get(point.seriesKey) || 0) + point.value);
            } else if (point.year === nextForecastYear && point.kind === "forecast") {
                forecastBySeries.set(point.seriesKey, (forecastBySeries.get(point.seriesKey) || 0) + point.value);
            }
        });
        const comparableSeries = [...actualBySeries.keys()].filter(key => forecastBySeries.has(key));
        if (comparableSeries.length) {
            const actualValue = comparableSeries.reduce((sum, key) => sum + actualBySeries.get(key), 0);
            const forecastValue = comparableSeries.reduce((sum, key) => sum + forecastBySeries.get(key), 0);
            const percentage = actualValue !== 0 ? ((forecastValue - actualValue) / Math.abs(actualValue)) * 100 : null;
            const displayedChange = percentage === null ? null : Number(percentage.toFixed(2));
            const formattedChange = displayedChange === null ? "" : `${displayedChange > 0 ? "+" : ""}${formatNumber(displayedChange, 2)}%`;
            const seriesNote = ` pada ${comparableSeries.length} seri dengan cakupan data sebanding`;
            if (displayedChange !== null && displayedChange < 0) {
                productionLevel = "Waspada penurunan";
                productionClass = "forecast-risk-warning";
                productionReason = `Prediksi ${nextForecastYear} turun ${formatNumber(Math.abs(displayedChange), 2)}% dibanding aktual ${lastActualYear}${seriesNote} (${formatNumber(actualValue)} menjadi ${formatNumber(forecastValue)} ${unit}).`;
            } else if (displayedChange !== null && displayedChange > 0) {
                productionLevel = "Meningkat";
                productionClass = "forecast-risk-positive";
                productionReason = `Prediksi ${nextForecastYear} naik ${formattedChange} dibanding aktual ${lastActualYear}${seriesNote}; ini hanya perubahan produksi model.`;
            } else if (displayedChange === 0) {
                productionLevel = "Stabil";
                productionClass = "forecast-risk-neutral";
                productionReason = `Perubahan produksi model dibulatkan 0,00% dibanding aktual ${lastActualYear}${seriesNote} (${formatNumber(actualValue)} menjadi ${formatNumber(forecastValue)} ${unit}).`;
            } else {
                productionReason = `Perubahan ${nextForecastYear} terhadap aktual ${lastActualYear} tidak dapat dihitung karena nilai aktual nol.`;
            }
        }
    }

    let weatherLevel = "Memuat";
    let weatherReason = "Mengambil status EWS cuaca BMKG.";
    let weatherClass = "forecast-risk-muted";
    if (!forecastWeatherState?.loading) {
        if (forecastWeatherState?.data) {
            const status = String(forecastWeatherState.data.status || "TIDAK TERSEDIA").toUpperCase();
            weatherLevel = status;
            weatherReason = forecastWeatherState.data.pesan || "Pesan EWS cuaca BMKG tidak tersedia.";
            weatherClass = status === "BAHAYA" ? "forecast-risk-danger" : status === "WASPADA" ? "forecast-risk-warning" : status === "AMAN" ? "forecast-risk-positive" : "forecast-risk-muted";
        } else {
            weatherLevel = "Tidak tersedia";
            weatherReason = `EWS cuaca BMKG tidak dapat dimuat: ${forecastWeatherState?.error || "alasan tidak tersedia"}`;
        }
    }

    container.innerHTML = `
        <ul class="forecast-risk-points">
            <li class="forecast-risk-point">
                <div class="forecast-risk-heading"><strong>Perubahan produksi model</strong><span class="forecast-risk-badge ${productionClass}">${escapeHTML(productionLevel)}</span></div>
                <small>${escapeHTML(productionReason)}</small>
            </li>
            <li class="forecast-risk-point">
                <div class="forecast-risk-heading"><strong>EWS cuaca BMKG</strong><span class="forecast-risk-badge ${weatherClass}">${escapeHTML(weatherLevel)}</span></div>
                <small>${escapeHTML(weatherReason)}</small>
            </li>
        </ul>
        <p class="forecast-risk-footnote">Penurunan produksi adalah sinyal perubahan hasil model, bukan klaim kekeringan, gagal panen, atau hama. Status cuaca berasal terpisah dari EWS BMKG.</p>
    `;
}

function setupForecastFilter() {
    const category = document.getElementById("forecastKategori");
    if (category && !category.dataset.listenerAdded) {
        category.addEventListener("change", () => {
            selectedForecastCommodity = "";
            loadForecasting();
        });
        category.dataset.listenerAdded = "true";
    }

    const region = document.getElementById("forecastKecamatan");
    if (region && !region.dataset.listenerAdded) {
        region.addEventListener("change", () => {
            populateForecastCommodity();
            renderForecastChart();
        });
        region.dataset.listenerAdded = "true";
    }

    const commodity = document.getElementById("forecastKomoditas");
    if (commodity && !commodity.dataset.listenerAdded) {
        commodity.addEventListener("change", () => {
            selectedForecastCommodity = commodity.value;
            renderForecastChart(commodity.value);
        });
        commodity.dataset.listenerAdded = "true";
    }
}


/* ==========================================================
   9. HARGA PANGAN & CUACA
========================================================== */

function getPriceValue(row) { return toNumber(getValue(row, ["harga", "price", "harga_konsumen", "harga_rata_rata", "value"])); }
function getPriceName(row) { return getValue(row, ["komoditas", "nama_komoditas", "name", "commodity"], "—"); }

async function loadPriceData() {
    try {
        const response = await apiFetch("/api/v1/harga-pangan");
        const allRows = findFirstArray(response);
        if (!allRows.length) { setTableEmpty("tabelHarga", "Data harga pangan belum tersedia.", 5); return; }
        const highest = [...allRows].sort((a, b) => (getPriceValue(b) || 0) - (getPriceValue(a) || 0))[0];
        setText("hargaTertinggiNama", getPriceName(highest));
        setText("hargaTertinggiNilai", formatCurrency(getPriceValue(highest)));
        const filter = document.getElementById("filterHargaKomoditas")?.value || "";
        const rows = allRows.filter(row => !filter || String(getPriceName(row)).toLowerCase().includes(filter.toLowerCase()));
        const summary = document.getElementById("hargaSummary");
        if (summary) summary.innerHTML = `<p>${rows.length} data harga tersedia.</p>`;
        renderPriceTable(rows);
        renderPriceChart(rows);
    } catch (error) {
        const summary = document.getElementById("hargaSummary");
        if (summary) summary.innerHTML = `<div style="padding: 15px;color: #b91c1c;background: #fff1f2;border-radius: 10px;font-size: 12px;"><strong>Gagal memuat harga pangan</strong><p>${escapeHTML(error.message)}</p></div>`;
        setText("hargaTertinggiNama", "—");
        setText("hargaTertinggiNilai", "—");
        setText("hargaTertinggiPeriode", "Data harga belum tersedia");
        setTableEmpty("tabelHarga", error.message, 5);
    }
}

function loadHarga() { return loadPriceData(); }

function renderPriceTable(rows) {
    const table = document.getElementById("tabelHarga");
    if (!table) return;
    table.innerHTML = rows.map(row => `<tr><td>${escapeHTML(getPriceName(row))}</td><td>${formatCurrency(getPriceValue(row))}</td><td>${escapeHTML(getValue(row, ["satuan", "unit"], "—"))}</td><td>${escapeHTML(getValue(row, ["wilayah", "provinsi"], "—"))}</td><td>${escapeHTML(getValue(row, ["tanggal", "periode"], "—"))}</td></tr>`).join("");
}

function renderPriceChart(rows) {
    const grouped = {};
    rows.forEach(row => { const name = getPriceName(row); const price = getPriceValue(row); if (price === null) return; grouped[name] = price; });
    createChart("priceChart", {
        type: "bar", data: { labels: Object.keys(grouped), datasets: [{ label: "Harga Pangan", data: Object.values(grouped), backgroundColor: CHART_COLORS }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, ticks: { callback: value => "Rp " + Number(value).toLocaleString("id-ID") } } } }
    });
}

function getWeatherIcon(description = "") {
    const text = String(description).toLowerCase();
    if (text.includes("petir")) return "fa-cloud-bolt";
    if (text.includes("hujan")) return "fa-cloud-rain";
    if (text.includes("kabut") || text.includes("kabur")) return "fa-smog";
    if (text.includes("cerah berawan")) return "fa-cloud-sun";
    if (text.includes("cerah")) return "fa-sun";
    if (text.includes("berawan")) return "fa-cloud";
    return "fa-cloud-sun";
}

function formatWeatherDate(value) {
    if (!value) return "—";
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!match) return String(value);
    const [, year, month, day, hour, minute] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return `${date.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} · ${hour}.${minute} WIB`;
}

async function loadDashboardWeather() {
    if (!DEFAULT_ADM4) { setText("dashboardWeather", "Kode wilayah BMKG belum diisi"); setText("weatherDescription", "Kode wilayah belum dikonfigurasi"); return; }
    try {
        const response = await apiFetch(`/api/v1/cuaca/${encodeURIComponent(DEFAULT_ADM4)}`);
        const weather = response.cuaca || {};
        const lokasi = response.lokasi || {};
        const temperature = weather.t != null ? `${formatNumber(weather.t, 1)}°C` : "—";
        setText("dashboardTemperature", temperature);
        setText("dashboardWeather", weather.weather_desc || "Tidak tersedia");
        setText("weatherTemperature", temperature);
        setText("weatherDescription", weather.weather_desc || "Tidak tersedia");
        setText("weatherLocation", [lokasi.desa, lokasi.kecamatan, lokasi.kotkab].filter(Boolean).join(", ") || "Kabupaten Kediri");
        setText("weatherUpdated", `Prakiraan: ${formatWeatherDate(weather.local_datetime)}`);
        setText("weatherHumidity", weather.hu != null ? `${weather.hu}%` : "—");
        setText("weatherWind", weather.ws != null ? `${formatNumber(weather.ws, 1)} km/j` : "—");
        setText("weatherRain", weather.tp != null ? `${formatNumber(weather.tp, 1)} mm` : "—");
        const heroIcon = document.getElementById("weatherHeroIcon");
        if (heroIcon) heroIcon.innerHTML = `<i class="fa-solid ${getWeatherIcon(weather.weather_desc)}"></i>`;
        renderWeatherForecast(response.prakiraan || []);
        await loadWeatherWarning(DEFAULT_ADM4);
    } catch (error) {
        setText("dashboardWeather", "Data cuaca gagal dimuat");
        setText("weatherDescription", "Gagal memuat cuaca");
        const container = document.getElementById("weatherForecast");
        if (container) container.textContent = `Gagal memuat prakiraan: ${error.message}`;
    }
}

function renderWeatherForecast(items) {
    const container = document.getElementById("weatherForecast");
    if (!container) return;
    if (!Array.isArray(items) || !items.length) { container.innerHTML = "<p>Prakiraan cuaca belum tersedia.</p>"; return; }
    container.innerHTML = items.slice(0, 8).map(item => `
        <div class="agri-forecast-item">
            <span class="agri-forecast-time">${escapeHTML(formatWeatherDate(item.local_datetime))}</span>
            <div class="agri-forecast-icon"><i class="fa-solid ${getWeatherIcon(item.weather_desc)}"></i></div>
            <strong class="agri-forecast-temp">${item.t != null ? `${escapeHTML(item.t)}°C` : "—"}</strong>
            <span class="agri-forecast-desc">${escapeHTML(item.weather_desc || "Tidak tersedia")}</span>
            <div class="agri-forecast-extra"><span><i class="fa-solid fa-droplet"></i>${item.hu != null ? `${escapeHTML(item.hu)}%` : "—"}</span><span><i class="fa-solid fa-cloud-rain"></i>${item.tp != null ? `${formatNumber(item.tp, 1)} mm` : "—"}</span></div>
        </div>
    `).join("");
}

async function loadWeatherWarning(kode) {
    if (!kode) return;
    try {
        const response = await apiFetch(`/api/v1/ews-cuaca/${encodeURIComponent(kode)}`);
        setText("weatherWarningStatus", response.status);
        setText("weatherWarningMessage", response.pesan);
        const container = document.getElementById("weatherRiskList");
        if (container) container.innerHTML = `<div class="risk-item"><strong>${escapeHTML(response.status)}</strong><span>${escapeHTML(response.pesan)}</span></div>`;
    } catch (error) {}
}


/* ==========================================================
   10. DATA CENTER & ADMIN
========================================================== */

async function loadDataCenter() {
    try {
        const response = await apiFetch("/api/v1/data-center");
        const files = getRecords(response);
        // FIX: backend sekarang mengirim kategori dataset | model | laporan
        renderDatasetTable("tabelDataset", files.filter(file => file.kategori === "dataset"));
        renderModelTable("tabelHasilModel", files.filter(file => file.kategori === "model"));
        renderReportList(files.filter(file => file.kategori === "laporan"));
    } catch (error) {
        setTableEmpty("tabelDataset", error.message, 5);
        setTableEmpty("tabelHasilModel", error.message, 4);
    }
}

function downloadButton(file) {
    return `<button type="button" class="green-button" data-endpoint="${escapeHTML(file.endpoint)}" onclick="downloadDataCenter(this.dataset.endpoint)">Download</button>`;
}

function renderDatasetTable(id, files) {
    const table = document.getElementById(id);
    if (!table) return;
    if (!files.length) { setTableEmpty(id, "Belum ada file dataset.", 5); return; }
    table.innerHTML = files.map(file => `<tr><td>${escapeHTML(file.nama)}</td><td>${escapeHTML(file.jenis || file.kategori)}</td><td>${file.jumlah_record != null ? formatNumber(file.jumlah_record, 0) : "—"}</td><td>${escapeHTML(file.status || "—")}</td><td>${downloadButton(file)}</td></tr>`).join("");
}

function renderModelTable(id, files) {
    const table = document.getElementById(id);
    if (!table) return;
    if (!files.length) { setTableEmpty(id, "Belum ada hasil pemodelan.", 4); return; }
    table.innerHTML = files.map(file => `<tr><td>${escapeHTML(file.nama)}</td><td>${escapeHTML(file.jenis || "—")}</td><td>${formatNumber(file.ukuran_kb, 1)} KB</td><td>${downloadButton(file)}</td></tr>`).join("");
}

function renderReportList(files) {
    const container = document.getElementById("daftarLaporan");
    if (!container) return;
    if (!files.length) { container.innerHTML = "<p>Belum ada laporan CSV.</p>"; return; }
    container.innerHTML = files.map(file => `<div class="report-item"><div><strong>${escapeHTML(file.nama)}</strong><p>${escapeHTML(file.jenis || "")} · ${formatNumber(file.ukuran_kb, 1)} KB</p></div>${downloadButton(file)}</div>`).join("");
}

function downloadDataCenter(endpoint) {
    if (!endpoint) return;
    const url = endpoint.startsWith("http") ? endpoint : API_BASE_URL + endpoint;
    window.open(url, "_blank");
}

function downloadReport(category) {
    // FIX: endpoint lama (/data-center/download/dataset_pemodelan/...) tidak ada di backend
    const files = { produksi: "clustering", harga: "rekomendasi", cuaca: "timeseries" };
    const key = files[category];
    if (!key) { alert("Jenis laporan tidak ditemukan."); return; }
    downloadDataCenter(`/api/v1/download/${key}`);
}

async function uploadDatasetFile() {
    if (window.AGRI_USER?.role !== "super_admin") {
        alert("Upload dataset hanya dapat dilakukan oleh Super Admin.");
        return;
    }
    const input = document.getElementById("uploadDataset");
    if (!input?.files?.length) { alert("Pilih file terlebih dahulu."); return; }
    const token = getAuthToken();
    if (!token) { alert("Silakan login sebagai admin."); return; }
    const file = input.files[0];
    if (!confirm("Dataset upload akan mengganti sumber data utama yang aktif, tetapi tidak menghapus file modeling asli. Lanjutkan?")) return;
    const formData = new FormData();
    formData.append("file", file);
    input.disabled = true;
    try {
        const result = await apiFetch("/api/v1/tanaman-pangan/upload", { method: "POST", body: formData });
        alert(`${result.message}\nTotal: ${result.total_data}`);
        await Promise.allSettled([loadDashboard(), loadMonitoring(), loadStatusWilayah(), loadFilterKecamatan(), loadDashboardWarning(), loadDataCenter()]);
    } catch (error) { alert(`Upload gagal: ${error.message}`); } finally { input.disabled = false; input.value = ""; }
}

async function loadAuditTrail() {
    const table = document.getElementById("tabelAudit");
    if (!table) return;
    const token = getAuthToken();
    if (!token) { setTableEmpty("tabelAudit", "Login untuk melihat audit trail.", 5); return; }
    try {
        const response = await apiFetch("/api/v1/audit-trail");
        const rows = getRecords(response);
        table.innerHTML = rows.map(row => `<tr><td>${escapeHTML(row.waktu)}</td><td>${escapeHTML(row.username)}</td><td>${escapeHTML(row.aktivitas)}</td><td>${escapeHTML(row.details)}</td><td><span class="status normal">Tercatat</span></td></tr>`).join("");
    } catch (error) { setTableEmpty("tabelAudit", error.message, 5); }
}


/* ==========================================================
   11. INITIALIZATION
========================================================== */

function setupFilterButton() {
    const dropdown = document.getElementById("filterKecamatan");
    if (!dropdown || dropdown.dataset.listenerAdded) return;
    dropdown.addEventListener("change", loadMonitoring);
    dropdown.dataset.listenerAdded = "true";
}

function setupHeatmapFilter() {
    ["heatmapCategory", "filterKomoditas"].forEach(id => {
        const element = document.getElementById(id);
        if (!element || element.dataset.heatmapListener) return;
        element.addEventListener("change", () => loadHeatmap());
        element.dataset.heatmapListener = "true";
    });
}

async function initializeAgriDash() {
    setCurrentDate();
    setupFilterButton();
    setupHeatmapFilter();
    setupHeatmapResize();
    setupForecastFilter();
    await Promise.allSettled([
        loadDashboard(), loadFilterKecamatan(), loadStatusWilayah(), loadMonitoringData(),
        loadHeatmap(), loadClustering(), loadRecommendations(), loadModelComparison(),
        loadForecasting(), loadDataCenter()
    ]);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeAgriDash, { once: true });
} else {
    initializeAgriDash();
}

document.addEventListener("agri:datechange", function (event) {
    const selectedDate = event.detail.date;
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const day = String(selectedDate.getDate()).padStart(2, "0");
    window.AGRI_DATE_FILTER = `${year}-${month}-${day}`;
});


/* ==========================================================
   12. BIOFARMAKA OVERVIEW (SUDAH DIPERBAIKI TOTAL)
========================================================== */

let biofarmakaData = null;

async function loadBiofarmakaOverview() {
    try {
        biofarmakaData = await apiFetch("/api/v1/biofarmaka/overview");
        renderBiofarmakaOverview(biofarmakaData);
    } catch (error) {
        console.error("Gagal memuat ringkasan Biofarmaka:", error);
    }
}

function bioNum(value, decimals = 0) {
    const n = Number(value);
    if (value == null || value === "" || !Number.isFinite(n)) return "—";
    return n.toLocaleString("id-ID", { maximumFractionDigits: decimals });
}

function renderBiofarmakaOverview(data) {
    const stats = data.statistik || {};

    const total = Number(stats.tahun?.count) || 0;
    const totalKecamatan = Number(stats.kecamatan?.unique) || 0;
    const totalKomoditas = Number(stats.komoditas?.unique) || 0;
    const completeProduction = Number(stats.produksi?.count) || 0;

    const completenessText = total ? `${bioNum(completeProduction / total * 100, 1)}%` : "—";
    setText("dashboardBioRegions", bioNum(totalKecamatan));
    setText("dashboardBioTotalCommodities", bioNum(totalKomoditas));
    setText("dashboardBioCompleteness", completenessText);

    renderBioDashboardRankings(data);
}


/* ==========================================
   DASHBOARD - HORTIKULTURA
   Menggunakan endpoint overview terbaru
========================================== */

async function loadDashboardHortikultura() {
    const section = document.querySelector(
        "#dashboard .dash-horti-section"
    );

    if (!section) return;

    // Memastikan urutan:
    // Biofarmaka -> Hortikultura -> Peringatan Cuaca
    const organized = document.querySelector(
        "#dashboard .dashboard-organized-content"
    );

    if (organized) {
        const weather = organized.querySelector(
            ".dashboard-weather-section"
        );

        if (weather) {
            organized.insertBefore(section, weather);
        } else {
            organized.appendChild(section);
        }
    }

    const safe = value => String(value ?? "").replace(
        /[&<>"']/g,
        char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]
    );

    const format = value => Number(value).toLocaleString(
        "id-ID",
        { maximumFractionDigits: 0 }
    );

    const putText = (id, text) => {
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    };

    const renderRanking = (containerId, items, options) => {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!items.length) {
            container.textContent = options.empty;
            return;
        }

        const max = Math.max(...items.map(item => item.value), 0);

        container.innerHTML = items.map((item, index) => {
            const percent = max > 0
                ? Math.max(0, item.value) / max * 100
                : 0;

            return `
                <div class="dash-horti-item">
                    <div class="dash-horti-item-head">
                        <strong>
                            ${index + 1}. ${safe(item.name)}
                        </strong>
                        <span>
                            ${format(item.value)} ${options.unit}
                        </span>
                    </div>
                    <div class="dash-horti-track">
                        <div style="width:${percent.toFixed(2)}%"></div>
                    </div>
                </div>
            `;
        }).join("");
    };

    try {
        const data = await apiFetch(
            "/api/v1/hortikultura/overview"
        );

        const clusters = Array.isArray(data.klaster)
            ? data.klaster
            : [];

        const details = Array.isArray(data.top_komoditas_detail)
            ? data.top_komoditas_detail
            : [];

        // 1. Ranking komoditas berdasarkan frekuensi Top 3
        const counts = new Map();

        clusters.forEach(row => {
            const names = new Set(
                String(row.top3_komoditas ?? "")
                    .split(/[,;]/)
                    .map(value =>
                        value.trim()
                            .replace(/_/g, " ")
                            .toLowerCase()
                    )
                    .filter(value =>
                        value && value !== "—" &&
                        value !== "nan" && value !== "none"
                    )
            );

            names.forEach(name => {
                counts.set(name, (counts.get(name) || 0) + 1);
            });
        });

        let commodities = [...counts.entries()]
            .map(([name, value]) => ({
                name: name.replace(/\b\w/g, c => c.toUpperCase()),
                value
            }));

        // Gunakan detail dari backend jika tersedia.
        if (details.length) {
            commodities = details.map(item => ({
                name: String(item.komoditas),
                value: Number(item.jumlah_kecamatan) || 0
            }));
        }

        commodities.sort((a, b) =>
            b.value - a.value ||
            a.name.localeCompare(b.name, "id")
        );

        renderRanking(
            "hortiCommodityList",
            commodities.slice(0, 5),
            {
                unit: "kecamatan",
                empty: "Data komoditas unggulan belum tersedia."
            }
        );

        // 2. Kecamatan menurut produksi rata-rata tahunan
        const regions = clusters
            .map(row => ({
                name: String(row.kecamatan || ""),
                value: Number(row.produksi_rata2_kg_per_tahun)
            }))
            .filter(row =>
                row.name.trim() &&
                Number.isFinite(row.value) &&
                row.value >= 0
            )
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);

        renderRanking(
            "hortiRegionList",
            regions,
            {
                unit: "kg/tahun",
                empty: "Data produksi rata-rata belum tersedia."
            }
        );

        // 3. KPI berdasarkan data yang dapat diverifikasi
        const kecamatan = new Set(
            clusters.map(row => row.kecamatan)
                .filter(Boolean)
        );

        putText(
            "hortiTotalKecamatan",
            data.statistik?.kecamatan?.unique ??
            kecamatan.size ??
            "—"
        );

        putText(
            "hortiTotalKomoditas",
            data.statistik?.komoditas?.unique ??
            counts.size ??
            "—"
        );

    } catch (error) {
        console.error("Hortikultura Dashboard:", error);

        putText("hortiTotalKecamatan", "—");
        putText("hortiTotalKomoditas", "—");
        putText("hortiCommodityList", "Gagal memuat komoditas.");
        putText("hortiRegionList", "Gagal memuat kecamatan.");
    }
}


/* FIX PETA DASHBOARD SETELAH PERUBAHAN LAYOUT */

function refreshDashboardMap() {
    const mapElement = document.getElementById(
        "dashboardKediriMap"
    );

    if (!mapElement) return;

    // Tunggu layout browser selesai dihitung
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (dashboardMapInstance) {
                dashboardMapInstance.invalidateSize({
                    pan: false
                });
            } else if (mapElement.clientWidth > 0 &&
                       mapElement.clientHeight > 0) {
                loadDashboardMap();
            }
        });
    });
}

window.addEventListener("resize", refreshDashboardMap);


/* ==========================================================
   AGRIDASH V.01
   FINAL DASHBOARD UPDATE
   - Tanaman Pangan
   - Biofarmaka
   - Hortikultura
   - Ranking berdasarkan data aktual dari API
========================================================== */


/* ==========================================================
   1. HELPER RANKING KOMODITAS
========================================================== */

function getTopCommodityRanking(clusters, backendDetail = []) {

    if (Array.isArray(backendDetail) && backendDetail.length) {
        return backendDetail
            .map(item => ({
                name: String(item.komoditas ?? "").trim(),
                value: Number(item.jumlah_kecamatan)
            }))
            .filter(item =>
                item.name &&
                Number.isFinite(item.value) &&
                item.value >= 0
            )
            .sort((a, b) =>
                b.value - a.value ||
                a.name.localeCompare(b.name, "id")
            )
            .slice(0, 5);
    }

    const counts = new Map();

    for (const row of clusters) {

        const uniqueNames = new Set(
            String(row.top3_komoditas ?? "")
                .split(/[,;]/)
                .map(name =>
                    name
                        .trim()
                        .replace(/_/g, " ")
                        .toLowerCase()
                )
                .filter(name =>
                    name &&
                    !["—", "-", "nan", "none", "null"]
                        .includes(name)
                )
        );

        for (const name of uniqueNames) {
            counts.set(
                name,
                (counts.get(name) || 0) + 1
            );
        }
    }

    return [...counts.entries()]
        .map(([name, value]) => ({
            name: name.replace(
                /\b\w/g,
                character => character.toUpperCase()
            ),
            value
        }))
        .sort((a, b) =>
            b.value - a.value ||
            a.name.localeCompare(b.name, "id")
        )
        .slice(0, 5);
}


/* ==========================================================
   2. HELPER RANKING KECAMATAN
========================================================== */

function getTopRegionRanking(clusters) {

    return clusters
        .map(row => ({
            name: String(row.kecamatan ?? "").trim(),

            value:
                row.produksi_rata2_kg_per_tahun === null ||
                row.produksi_rata2_kg_per_tahun === undefined ||
                row.produksi_rata2_kg_per_tahun === ""
                    ? NaN
                    : Number(row.produksi_rata2_kg_per_tahun)
        }))
        .filter(item =>
            item.name &&
            Number.isFinite(item.value) &&
            item.value >= 0
        )
        .sort((a, b) =>
            b.value - a.value ||
            a.name.localeCompare(b.name, "id")
        )
        .slice(0, 5);
}


/* ==========================================================
   3. RENDER RANKING KATEGORI
   DIPAKAI BIOFARMAKA DAN HORTIKULTURA
========================================================== */

function renderCategoryRanking(containerId, rows, unit) {

    const container = document.getElementById(containerId);

    if (!container) return;

    const items = [...rows]
        .filter(item =>
            item.name &&
            Number.isFinite(item.value) &&
            item.value >= 0
        )
        .sort((a, b) =>
            b.value - a.value ||
            a.name.localeCompare(b.name, "id")
        )
        .slice(0, 5);

    if (!items.length) {
        container.textContent =
            "Data peringkat belum tersedia.";
        return;
    }

    const maxValue = Math.max(
        0,
        ...items.map(item => item.value)
    );

    container.innerHTML = items.map((item, index) => {

        const percentage = maxValue > 0
            ? (item.value / maxValue) * 100
            : 0;

        const formattedValue = formatNumber(
            item.value,
            unit === "kg/tahun" ? 1 : unit === "ton" ? 2 : 0
        );

        return `
            <div class="dash-horti-item">

                <div class="dash-horti-item-head">

                    <strong>
                        ${index + 1}.
                        ${escapeHTML(item.name)}
                    </strong>

                    <span>
                        ${formattedValue} ${unit}
                    </span>

                </div>

                <div class="dash-horti-track">

                    <div
                        style="width:${percentage.toFixed(2)}%">
                    </div>

                </div>

            </div>
        `;
    }).join("");
}


/* ==========================================================
   4. DASHBOARD BIOFARMAKA
========================================================== */

function renderBioDashboardRankings(data) {

    const clusters = Array.isArray(data.klaster)
        ? data.klaster
        : [];

    const commodities = getTopCommodityRanking(
        clusters,
        data.top_komoditas_detail
    );

    const regions = getTopRegionRanking(clusters);

    // Top 5 komoditas berdasarkan frekuensi Top 3
    renderCategoryRanking(
        "dashboardBioCommodities",
        commodities,
        "kecamatan"
    );

    // Top 5 kecamatan berdasarkan produksi rata-rata
    renderCategoryRanking(
        "dashboardBioTopRegions",
        regions,
        "kg/tahun"
    );
}


/* ==========================================================
   5. DASHBOARD HORTIKULTURA
========================================================== */

async function loadDashboardHortikultura() {

    const section = document.querySelector(
        "#dashboard .dash-horti-section"
    );

    if (!section) {
        console.warn(
            "Section Hortikultura tidak ditemukan di Dashboard."
        );
        return;
    }

    const putText = (id, value) => {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value ?? "—";
        }
    };

    try {

        const data = await apiFetch(
            "/api/v1/hortikultura/overview"
        );

        const clusters = Array.isArray(data.klaster)
            ? data.klaster
            : [];

        // ------------------------------------------
        // TOP 5 KOMODITAS
        // ------------------------------------------

        const commodities = getTopCommodityRanking(
            clusters,
            data.top_komoditas_detail
        );

        renderCategoryRanking(
            "hortiCommodityList",
            commodities,
            "kecamatan"
        );

        // ------------------------------------------
        // TOP 5 KECAMATAN
        // ------------------------------------------

        const regions = getTopRegionRanking(clusters);

        renderCategoryRanking(
            "hortiRegionList",
            regions,
            "kg/tahun"
        );

        // ------------------------------------------
        // KPI KECAMATAN
        // ------------------------------------------

        const uniqueRegions = new Set(
            clusters
                .map(row =>
                    String(row.kecamatan ?? "").trim()
                        .toLowerCase()
                )
                .filter(Boolean)
        );

        const kecamatanFromApi =
            data.statistik?.kecamatan?.unique;

        const totalKecamatan =
            uniqueRegions.size > 0
                ? uniqueRegions.size
                : kecamatanFromApi ?? "—";

        putText(
            "hortiTotalKecamatan",
            totalKecamatan
        );

        // ------------------------------------------
        // KPI KOMODITAS
        // ------------------------------------------

        const totalKomoditas =
            data.statistik?.komoditas?.unique;

        putText(
            "hortiTotalKomoditas",
            totalKomoditas ?? "—"
        );

    } catch (error) {

        console.error(
            "Gagal memuat Dashboard Hortikultura:",
            error
        );

        putText("hortiTotalKecamatan", "—");
        putText("hortiTotalKomoditas", "—");

        putText(
            "hortiCommodityList",
            "Gagal memuat data komoditas: " +
                error.message
        );

        putText(
            "hortiRegionList",
            "Gagal memuat data kecamatan: " +
                error.message
        );
    }
}


/* ==========================================================
   6. REFRESH PETA DASHBOARD
   MEMPERBAIKI UKURAN LEAFLET SETELAH PERUBAHAN LAYOUT
========================================================== */

function refreshDashboardMapLayout() {

    const container = document.getElementById(
        "dashboardKediriMap"
    );

    if (!container) return;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {

            if (
                typeof dashboardMapInstance !== "undefined" &&
                dashboardMapInstance
            ) {
                dashboardMapInstance.invalidateSize({
                    pan: false
                });
            }

        });
    });
}


/* ==========================================================
   7. VALIDASI ELEMEN DASHBOARD
   UNTUK MEMBANTU DEBUGGING
========================================================== */

function validateDashboardElements() {

    const requiredIds = [
        "productionChart",
        "dashboardKediriMap",
        "top5Kecamatan",
        "dashboardWarnings",
        "dashboardBioRegions",
        "dashboardBioTotalCommodities",
        "dashboardBioCompleteness",
        "dashboardBioCommodities",
        "dashboardBioTopRegions",
        "hortiCommodityList",
        "hortiRegionList",
        "hortiTotalKecamatan",
        "hortiTotalKomoditas"
    ];

    const missing = requiredIds.filter(
        id => !document.getElementById(id)
    );

    if (missing.length) {
        console.warn(
            "Elemen Dashboard belum ditemukan:",
            missing
        );
    }

    const duplicates = requiredIds.filter(
        id => document.querySelectorAll(
            `[id="${id}"]`
        ).length > 1
    );

    if (duplicates.length) {
        console.warn(
            "ID Dashboard duplikat:",
            duplicates
        );
    }

    return missing.length === 0 &&
           duplicates.length === 0;
}


/* ==========================================================
   8. INISIALISASI TAMBAHAN
   TIDAK MENGGANTI initializeAgriDash() YANG LAMA
========================================================== */

function initializeDashboardEnhancements() {

    validateDashboardElements();

    // Peta perlu menghitung ukuran ulang saat browser berubah
    window.addEventListener(
        "resize",
        refreshDashboardMapLayout
    );

    // Observer ukuran container peta
    const mapContainer = document.getElementById(
        "dashboardKediriMap"
    );

    if (
        mapContainer &&
        typeof ResizeObserver !== "undefined"
    ) {

        const observer = new ResizeObserver(() => {
            refreshDashboardMapLayout();
        });

        observer.observe(mapContainer);
    }

    console.info(
        "AgriDash Dashboard enhancements initialized."
    );
}

if (document.readyState === "loading") {

    document.addEventListener(
        "DOMContentLoaded",
        initializeDashboardEnhancements,
        { once: true }
    );

} else {

    initializeDashboardEnhancements();

}
