// ==============================
// DATA AKUN (DEMO)
// ==============================
const USERS = {
    superadmin: {
        username: 'superadmin',
        password: 'super123',
        name: 'Linda Anggarawati',
        label: 'Super Admin'
    },
    admin: {
        username: 'admin',
        password: 'admin123',
        name: 'Zerlina Putri',
        label: 'Admin DKPP'
    },
    user: {
        username: 'user',
        password: 'user123',
        name: 'Zarah Berliana',
        label: 'User BPP'
    }
};

let selectedRole = 'superadmin';

// Jika sudah login, langsung ke dashboard
if (sessionStorage.getItem('agridash_user')) {
    location.replace('index.html');
}

// ==============================
// PILIH ROLE
// ==============================
document.querySelectorAll('.role-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.role-btn').forEach(function (b) {
            b.classList.remove('active');
        });
        btn.classList.add('active');
        selectedRole = btn.dataset.role;
        document.getElementById('errorMsg').classList.remove('show');
    });
});

// ==============================
// TOGGLE PASSWORD
// ==============================
document.getElementById('togglePassword').addEventListener('click', function () {
    const input = document.getElementById('password');
    const icon = this.querySelector('i');
    const isHidden = input.type === 'password';

    input.type = isHidden ? 'text' : 'password';
    icon.className = isHidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
});

// ==============================
// SUBMIT LOGIN
// ==============================
document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorBox = document.getElementById('errorMsg');
    const account = USERS[selectedRole];

    if (username === account.username && password === account.password) {

        sessionStorage.setItem('agridash_user', JSON.stringify({
            username: account.username,
            name: account.name,
            role: selectedRole,
            label: account.label
        }));

        location.href = 'index.html';

    } else {
        errorBox.textContent = 'Username atau password salah untuk role ' + account.label + '.';
        errorBox.classList.add('show');
    }
});