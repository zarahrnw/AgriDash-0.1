"use strict";

const loginForm = document.getElementById("loginForm");
const errorBox = document.getElementById("errorMsg");
const submitButton = loginForm.querySelector('button[type="submit"]');
const passwordChangePanel = document.getElementById("passwordChangePanel");
const passwordChangeForm = document.getElementById("passwordChangeForm");
const passwordChangeError = document.getElementById("passwordChangeError");
const passwordChangeButton = passwordChangeForm.querySelector('button[type="submit"]');

function showLoginMessage(message) {
    errorBox.textContent = message;
    errorBox.classList.add("show");
}

function clearLoginMessage() {
    errorBox.textContent = "";
    errorBox.classList.remove("show");
}

function showPasswordChange() {
    loginForm.hidden = true;
    passwordChangePanel.hidden = false;
    document.getElementById("password").value = "";
    document.getElementById("currentPassword").focus();
}

const reason = new URLSearchParams(window.location.search).get("reason");
if (reason === "expired") {
    showLoginMessage("Sesi Anda berakhir atau tidak lagi valid. Silakan login kembali.");
} else if (reason === "unavailable") {
    showLoginMessage("Sesi tidak dapat diverifikasi. Pastikan backend FastAPI aktif lalu coba lagi.");
}

document.getElementById("togglePassword").addEventListener("click", function () {
    const input = document.getElementById("password");
    const icon = this.querySelector("i");
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    icon.className = isHidden ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
});

loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearLoginMessage();

    submitButton.disabled = true;
    submitButton.textContent = "Memverifikasi...";
    try {
        const password = document.getElementById("password").value;
        const result = await window.AgriAuth.login(document.getElementById("username").value, password);
        if (result.must_change_password) {
            showPasswordChange();
            return;
        }
        window.location.replace("index.html");
    } catch (error) {
        showLoginMessage(error.message || "Login gagal. Periksa username dan password.");
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Masuk <i class="fa-solid fa-arrow-right"></i>';
    }
});

passwordChangeForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    passwordChangeError.textContent = "";
    passwordChangeError.classList.remove("show");

    const newPassword = document.getElementById("newPassword").value;
    if (newPassword !== document.getElementById("confirmNewPassword").value) {
        passwordChangeError.textContent = "Konfirmasi password baru tidak cocok.";
        passwordChangeError.classList.add("show");
        return;
    }

    passwordChangeButton.disabled = true;
    passwordChangeButton.textContent = "Menyimpan...";
    try {
        await window.AgriAuth.changePassword(
            document.getElementById("currentPassword").value,
            newPassword
        );
        window.location.replace("index.html");
    } catch (error) {
        passwordChangeError.textContent = error.message || "Password tidak dapat diperbarui.";
        passwordChangeError.classList.add("show");
    } finally {
        passwordChangeButton.disabled = false;
        passwordChangeButton.textContent = "Simpan Password";
    }
});

window.AgriAuth.restoreSession().then(function (user) {
    if (!user) return;
    if (user.must_change_password) {
        showPasswordChange();
        return;
    }
    window.location.replace("index.html");
}).catch(function (error) {
    showLoginMessage(error.message || "Sesi tidak dapat diverifikasi.");
});
