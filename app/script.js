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