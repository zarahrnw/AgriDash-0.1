(function () {

    const MONTHS = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const MONTHS_SHORT = [
        'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
        'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
    ];
    const DAYS_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const DAYS_FULL = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

    // Batas: hari ini (maks) dan 1 Jan 2023 (min)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(2023, 0, 1);

    let selected = new Date(today);
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();

    const wrap = document.getElementById('dateWrap');
    const btn = document.getElementById('dateBtn');
    const label = document.getElementById('dateLabel');
    const pop = document.getElementById('calendarPop');
    const notice = document.getElementById('dateNotice');
    const noticeDate = document.getElementById('noticeDate');
    const backBtn = document.getElementById('backToToday');

    if (!wrap || !btn || !pop) return;

    // ---------- Helper ----------
    function dayIndex(d) {
        return (d.getDay() + 6) % 7; // Senin = 0
    }

    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() &&
               a.getMonth() === b.getMonth() &&
               a.getDate() === b.getDate();
    }

    function shortLabel(d) {
        return DAYS_SHORT[dayIndex(d)] + ', ' + d.getDate() + ' ' +
               MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
    }

    function longLabel(d) {
        return DAYS_FULL[dayIndex(d)] + ', ' + d.getDate() + ' ' +
               MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    // ---------- Render kalender ----------
    function render() {

        const first = new Date(viewYear, viewMonth, 1);
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const offset = dayIndex(first);

        const atMax = viewYear === today.getFullYear() && viewMonth === today.getMonth();
        const atMin = viewYear === minDate.getFullYear() && viewMonth === minDate.getMonth();

        let html = '';

        html += '<div class="cal-head">';
        html += '<button type="button" class="cal-nav" data-nav="-1"' + (atMin ? ' disabled' : '') + '>';
        html += '<i class="fa-solid fa-chevron-left"></i></button>';
        html += '<strong>' + MONTHS[viewMonth] + ' ' + viewYear + '</strong>';
        html += '<button type="button" class="cal-nav" data-nav="1"' + (atMax ? ' disabled' : '') + '>';
        html += '<i class="fa-solid fa-chevron-right"></i></button>';
        html += '</div>';

        html += '<div class="cal-grid cal-week">';
        DAYS_SHORT.forEach(function (d) { html += '<span>' + d + '</span>'; });
        html += '</div>';

        html += '<div class="cal-grid">';

        for (let i = 0; i < offset; i++) {
            html += '<span class="cal-empty"></span>';
        }

        for (let day = 1; day <= daysInMonth; day++) {

            const d = new Date(viewYear, viewMonth, day);
            const disabled = d > today || d < minDate;

            let cls = 'cal-day';
            if (sameDay(d, today)) cls += ' is-today';
            if (sameDay(d, selected)) cls += ' is-selected';

            html += '<button type="button" class="' + cls + '"' +
                    ' data-date="' + viewYear + '-' + viewMonth + '-' + day + '"' +
                    (disabled ? ' disabled' : '') + '>' + day + '</button>';
        }

        html += '</div>';

        html += '<div class="cal-quick">';
        html += '<button type="button" data-ago="0">Hari ini</button>';
        html += '<button type="button" data-ago="1">Kemarin</button>';
        html += '<button type="button" data-ago="7">7 hari lalu</button>';
        html += '<button type="button" data-ago="30">30 hari lalu</button>';
        html += '</div>';

        pop.innerHTML = html;
    }

    // ---------- Pilih tanggal ----------
    function selectDate(d) {

        selected = new Date(d);
        viewYear = selected.getFullYear();
        viewMonth = selected.getMonth();

        label.textContent = sameDay(selected, today) ? 'Hari ini, ' + shortLabel(selected) : shortLabel(selected);

        if (notice) {
            if (sameDay(selected, today)) {
                notice.hidden = true;
            } else {
                noticeDate.textContent = longLabel(selected);
                notice.hidden = false;
            }
        }

        window.AGRI_SELECTED_DATE = new Date(selected);

        // Hook: dengarkan event ini untuk memuat data sesuai tanggal
        document.dispatchEvent(new CustomEvent('agri:datechange', {
            detail: { date: new Date(selected) }
        }));

        close();
    }

    function open() {
        render();
        pop.classList.add('open');
    }

    function close() {
        pop.classList.remove('open');
    }

    // ---------- Event ----------
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        pop.classList.contains('open') ? close() : open();
    });

    pop.addEventListener('click', function (e) {

        e.stopPropagation();

        const nav = e.target.closest('[data-nav]');
        if (nav) {
            viewMonth += parseInt(nav.dataset.nav, 10);
            if (viewMonth < 0) { viewMonth = 11; viewYear--; }
            if (viewMonth > 11) { viewMonth = 0; viewYear++; }
            render();
            return;
        }

        const dayBtn = e.target.closest('.cal-day');
        if (dayBtn && !dayBtn.disabled) {
            const p = dayBtn.dataset.date.split('-').map(Number);
            selectDate(new Date(p[0], p[1], p[2]));
            return;
        }

        const quick = e.target.closest('[data-ago]');
        if (quick) {
            const d = new Date(today);
            d.setDate(d.getDate() - parseInt(quick.dataset.ago, 10));
            selectDate(d);
        }
    });

    if (backBtn) {
        backBtn.addEventListener('click', function () {
            selectDate(today);
        });
    }

    document.addEventListener('click', close);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') close();
    });

    // ---------- Awal ----------
    selectDate(today);

})();