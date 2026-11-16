(function () {
    "use strict";

    const API_BASE_URL = "http://127.0.0.1:8000";
    const TOKEN_KEY = "access_token";
    const USER_KEY = "agridash_user";
    const ROLE_LABELS = {
        super_admin: "Super Admin",
        admin: "Admin",
        user: "User"
    };
    const PAGE_ACCESS = {
        super_admin: [
            "dashboard", "monitoring", "harga", "cuaca", "prediksi",
            "ketahanan", "data", "report", "audit", "users"
        ],
        admin: ["dashboard", "monitoring", "harga", "cuaca", "prediksi", "ketahanan", "data", "report"],
        user: ["dashboard", "monitoring", "harga", "cuaca", "prediksi", "ketahanan", "data", "report"]
    };

    window.AGRI_API_BASE_URL = API_BASE_URL;

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem("token");
        localStorage.removeItem(USER_KEY);
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("token");
        sessionStorage.removeItem(USER_KEY);
    }

    function getTokenExpiry(token) {
        try {
            const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
            const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
            const payload = JSON.parse(new TextDecoder().decode(bytes));
            const expiry = Number(payload.exp);
            return Number.isFinite(expiry) ? expiry * 1000 : null;
        } catch (_) {
            return null;
        }
    }

    function normalizeUser(data) {
        const username = String(data?.username || "").trim();
        const role = String(data?.role || "").trim();
        if (!username || !Object.prototype.hasOwnProperty.call(ROLE_LABELS, role)) {
            const error = new Error("Respons autentikasi backend tidak berisi identitas atau role yang valid.");
            error.code = "invalid-session";
            throw error;
        }
        return {
            username,
            name: username,
            role,
            label: ROLE_LABELS[role],
            must_change_password: data.must_change_password === true
        };
    }

    function saveSession(token, data) {
        if (!token || !getTokenExpiry(token)) {
            throw new Error("Backend mengembalikan access token yang tidak valid.");
        }
        const user = normalizeUser(data);
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem("token");
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("token");
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        return user;
    }

    async function readResponse(response) {
        let data = {};
        try {
            data = await response.json();
        } catch (_) {
            data = {};
        }
        if (!response.ok) {
            const error = new Error(data.detail || `Permintaan autentikasi gagal (HTTP ${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    async function fetchCurrentUser(token) {
        let response;
        try {
            response = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (_) {
            throw new Error("Tidak dapat menghubungi backend FastAPI. Periksa koneksi server lalu coba lagi.");
        }
        return readResponse(response);
    }

    async function login(username, password) {
        let response;
        try {
            response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ username: username.trim(), password })
            });
        } catch (_) {
            throw new Error("Tidak dapat menghubungi backend FastAPI. Pastikan server aktif lalu coba lagi.");
        }
        const data = await readResponse(response);
        saveSession(data.access_token, data);
        return data;
    }

    async function changePassword(currentPassword, newPassword) {
        let response;
        try {
            response = await fetch(`${API_BASE_URL}/api/v1/auth/change-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${getToken()}`
                },
                body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
            });
        } catch (_) {
            throw new Error("Tidak dapat menghubungi backend FastAPI. Periksa koneksi server lalu coba lagi.");
        }
        try {
            return await readResponse(response);
        } catch (error) {
            if (error.status === 401) handleUnauthorized("/api/v1/auth/change-password");
            throw error;
        }
    }

    async function restoreSession() {
        const token = getToken();
        if (!token) {
            localStorage.removeItem(USER_KEY);
            return null;
        }

        const expiry = getTokenExpiry(token);
        if (!expiry || expiry <= Date.now()) {
            clearSession();
            return null;
        }

        try {
            const user = normalizeUser(await fetchCurrentUser(token));
            saveSession(token, user);
            return user;
        } catch (error) {
            if (error.status === 401 || error.status === 403 || error.code === "invalid-session") {
                clearSession();
                return null;
            }
            throw error;
        }
    }

    function redirectToLogin(reason) {
        const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
        window.location.replace(`login.html${query}`);
    }

    function scheduleExpiry(token) {
        const expiry = getTokenExpiry(token);
        if (!expiry) return;
        window.setTimeout(function () {
            if (getToken() !== token) return;
            clearSession();
            redirectToLogin("expired");
        }, Math.min(Math.max(expiry - Date.now(), 0), 2147483647));
    }

    function applyRole(user) {
        const allowed = PAGE_ACCESS[user.role];
        window.AGRI_USER = user;
        window.AGRI_ALLOWED_PAGES = allowed;

        document.querySelectorAll(".menu-item").forEach(function (button) {
            const match = (button.getAttribute("onclick") || "").match(/showPage\('([^']+)'/);
            if (match && !allowed.includes(match[1])) button.remove();
        });

        document.querySelectorAll(".page").forEach(function (page) {
            if (!allowed.includes(page.id)) page.remove();
        });

        document.querySelectorAll(".menu-section").forEach(function (section) {
            if (!section.querySelector(".menu-item")) section.remove();
        });

        document.querySelectorAll("[data-roles]").forEach(function (element) {
            const roles = element.dataset.roles.split(",").map(role => role.trim());
            if (!roles.includes(user.role)) element.remove();
        });

        const name = document.querySelector(".user-info strong");
        const role = document.querySelector(".user-info small");
        const greeting = document.getElementById("greetName");
        if (name) name.textContent = user.name;
        if (role) role.textContent = user.label;
        if (greeting) greeting.textContent = user.name.split(/\s+/)[0];

        const logoutButton = document.getElementById("logoutBtn");
        if (logoutButton) {
            logoutButton.addEventListener("click", function () {
                if (!window.confirm("Yakin ingin keluar?")) return;
                clearSession();
                window.location.replace("login.html");
            });
        }
    }

    function handleUnauthorized(endpoint) {
        if (endpoint === "/api/v1/auth/login" || !getToken()) return;
        clearSession();
        redirectToLogin("expired");
    }

    window.AgriAuth = {
        getToken,
        clearSession,
        login,
        changePassword,
        restoreSession,
        handleUnauthorized
    };

    if (document.body?.dataset.authRequired === "true") {
        document.documentElement.style.visibility = "hidden";
        const token = getToken();
        const expiry = token ? getTokenExpiry(token) : null;
        if (!token) {
            clearSession();
            redirectToLogin();
        } else if (!expiry || expiry <= Date.now()) {
            clearSession();
            redirectToLogin("expired");
        } else {
            fetchCurrentUser(token).then(function (data) {
                const user = normalizeUser(data);
                saveSession(token, user);
                if (user.must_change_password) {
                    redirectToLogin("password-change");
                    return;
                }
                applyRole(user);
                scheduleExpiry(token);
                document.documentElement.classList.remove("auth-pending");
                document.documentElement.style.visibility = "visible";
            }).catch(function (error) {
                if (error.status === 401 || error.status === 403 || error.code === "invalid-session") {
                    clearSession();
                    redirectToLogin("expired");
                    return;
                }
                redirectToLogin("unavailable");
            });
        }
    }
})();
