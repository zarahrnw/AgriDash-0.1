(function () {

    const raw = sessionStorage.getItem('agridash_user');

    if (!raw) {
        location.replace('login.html');
        return;
    }

    let user;
    try {
        user = JSON.parse(raw);
    } catch (e) {
        sessionStorage.removeItem('agridash_user');
        location.replace('login.html');
        return;
    }

    // ==============================
    // HAK AKSES HALAMAN PER ROLE
    // ==============================
    const ACCESS = {
        superadmin: [
            'dashboard', 'monitoring', 'harga', 'cuaca', 'prediksi',
            'ketahanan', 'data', 'report', 'audit', 'users'
        ],
        admin: [
            'dashboard', 'monitoring', 'harga', 'cuaca', 'prediksi',
            'ketahanan', 'data', 'report'
        ],
        user: [
            'dashboard', 'monitoring', 'harga', 'cuaca', 'ketahanan'
        ]
    };

    const allowed = ACCESS[user.role];

    // Role tidak dikenal -> kembali ke login
    if (!allowed) {
        sessionStorage.removeItem('agridash_user');
        location.replace('login.html');
        return;
    }

    window.AGRI_USER = user;
    window.AGRI_ALLOWED_PAGES = allowed;

    document.documentElement.style.visibility = 'hidden';

    document.addEventListener('DOMContentLoaded', function () {

        // 1. Hapus menu sidebar yang tidak diizinkan
        document.querySelectorAll('.menu-item').forEach(function (btn) {
            const match = (btn.getAttribute('onclick') || '').match(/showPage\('([^']+)'/);
            if (match && !allowed.includes(match[1])) {
                btn.remove();
            }
        });

        // 2. Hapus halaman (section) yang tidak diizinkan
        document.querySelectorAll('.page').forEach(function (page) {
            if (!allowed.includes(page.id)) {
                page.remove();
            }
        });

        // 3. Hapus grup menu yang sudah kosong (mis. FITUR TAMBAHAN untuk User)
        document.querySelectorAll('.menu-section').forEach(function (section) {
            if (!section.querySelector('.menu-item')) {
                section.remove();
            }
        });

        // 4. Hapus elemen dengan data-roles yang tidak cocok
        document.querySelectorAll('[data-roles]').forEach(function (el) {
            const roles = el.dataset.roles.split(',').map(function (r) {
                return r.trim();
            });
            if (!roles.includes(user.role)) {
                el.remove();
            }
        });

        // 5. Info user di topbar
        const nameEl = document.querySelector('.user-info strong');
        const roleEl = document.querySelector('.user-info small');
        if (nameEl) nameEl.textContent = user.name;
        if (roleEl) roleEl.textContent = user.label;

        // 6. Sapaan
        const greetName = document.getElementById('greetName');
        if (greetName) greetName.textContent = user.name.split(' ')[0];

        // 7. Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function () {
                if (confirm('Yakin ingin keluar?')) {
                    sessionStorage.removeItem('agridash_user');
                    location.replace('login.html');
                }
            });
        }

        document.documentElement.style.visibility = 'visible';
    });

})();