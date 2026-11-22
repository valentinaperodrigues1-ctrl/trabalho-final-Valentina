/* ==========================================================================
   NICE ROOMS — HOTEL PERFORMANCE
   Lógica de filtros, cálculos ponderados, 6 gráficos interativos (Chart.js)
   e tabela dinâmica ordenável.
   ========================================================================== */

(function () {
  "use strict";

  const DB = window.DADOS_DASHBOARD;
  if (!DB) {
    console.error("Dados não carregados. Verifique se dados_dashboard.js está presente.");
    return;
  }

  // Paleta consistente de BI (azul-marinho, azul médio, turquesa e neutros)
  const PALETTE = {
    navy: "#12355B",
    blue: "#2B6CB0",
    blueSoft: "rgba(43, 108, 176, 0.20)",
    teal: "#1B998B",
    tealSoft: "rgba(27, 153, 139, 0.14)",
    amber: "#D9822B",
    coral: "#C84B31",
    slate: "#64748B",
    grid: "#EDF2F7",
  };

  const TIER_ORDER = ["luxury", "upscale", "boutique", "midscale", "economy"];
  const TIER_LABELS = {
    luxury: "Luxury",
    upscale: "Upscale",
    boutique: "Boutique",
    midscale: "Midscale",
    economy: "Economy",
  };
  const TIER_COLORS = {
    luxury: "#12355B",
    upscale: "#1B998B",
    boutique: "#4C6EF5",
    midscale: "#D9822B",
    economy: "#718096",
  };
  const SENTIMENT_COLORS = {
    positive: "#1B998B",
    mixed: "#D9822B",
    negative: "#C84B31",
  };

  // Índices rápidos de consulta por ID
  const hotelById = Object.fromEntries(DB.hotels.map((h) => [h.hotel_id, h]));
  const scenarioById = Object.fromEntries(DB.scenarios.map((s) => [s.scenario_id, s]));

  // Estado central dos filtros, ordenação da tabela e modo do gráfico MARS
  const state = {
    hotel: "all",
    tier: "all",
    year: "all",
    marsMode: "hotel", // "hotel" ou "tier"
    sortKey: "revpar",
    sortDir: "desc",
  };

  // Referências para as 6 instâncias únicas do Chart.js (atualizadas sem duplicação)
  const charts = {
    evolution: null,
    tiers: null,
    positioning: null,
    mars: null,
    scenarios: null,
    decisions: null,
  };

  // Cache de elementos DOM
  const els = {};

  // Formatadores numéricos em português do Brasil
  const fmtInt = (v) => Math.round(v).toLocaleString("pt-BR");
  const fmtDec = (v, d = 2) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtUSD = (v, d = 2) =>
    "US$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = (v, d = 1) => fmtDec(v, d) + "%";
  const fmtSignedPct = (v, d = 1) => (v >= 0 ? "+" : "") + fmtDec(v, d) + "%";
  const fmtSignedUSD = (v, d = 2) => (v >= 0 ? "+US$ " : "-US$ ") + fmtDec(Math.abs(v), d);

  // ==========================================================================
  // Plugins customizados do Chart.js (linhas de referência sem poluição)
  // ==========================================================================

  // Desenha linhas de paridade em 100 (ARI = 100 e MPI = 100) e rótulos dos 4 quadrantes
  const positioningQuadrantsPlugin = {
    id: "positioningQuadrants",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x || !scales.y) return;

      const x100 = scales.x.getPixelForValue(100);
      const y100 = scales.y.getPixelForValue(100);

      ctx.save();
      ctx.strokeStyle = "#64748B";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 5]);

      if (x100 >= chartArea.left && x100 <= chartArea.right) {
        ctx.beginPath();
        ctx.moveTo(x100, chartArea.top);
        ctx.lineTo(x100, chartArea.bottom);
        ctx.stroke();
      }
      if (y100 >= chartArea.top && y100 <= chartArea.bottom) {
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y100);
        ctx.lineTo(chartArea.right, y100);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.font = "600 10.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

      // X = ARI (preço), Y = MPI (ocupação)
      ctx.fillStyle = "#11645B";
      ctx.textAlign = "right";
      ctx.fillText("Preço acima + Ocupação acima", chartArea.right - 6, chartArea.top + 14);

      ctx.fillStyle = "#2B6CB0";
      ctx.textAlign = "left";
      ctx.fillText("Preço abaixo + Ocupação acima", chartArea.left + 6, chartArea.top + 14);

      ctx.fillStyle = "#9A3412";
      ctx.textAlign = "right";
      ctx.fillText("Preço acima + Ocupação abaixo", chartArea.right - 6, chartArea.bottom - 8);

      ctx.fillStyle = "#64748B";
      ctx.textAlign = "left";
      ctx.fillText("Preço abaixo + Ocupação abaixo", chartArea.left + 6, chartArea.bottom - 8);

      ctx.restore();
    },
  };

  // Desenha a faixa recomendada de ±6% do MARS e a linha central em 0% no Gráfico 4
  const marsBandPlugin = {
    id: "marsBand",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x) return;

      const xNeg = Math.max(chartArea.left, scales.x.getPixelForValue(-6));
      const xPos = Math.min(chartArea.right, scales.x.getPixelForValue(6));
      const xZero = scales.x.getPixelForValue(0);

      ctx.save();
      if (xPos > xNeg) {
        ctx.fillStyle = "rgba(27, 153, 139, 0.11)";
        ctx.fillRect(xNeg, chartArea.top, xPos - xNeg, chartArea.bottom - chartArea.top);
      }
      if (xZero >= chartArea.left && xZero <= chartArea.right) {
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(xZero, chartArea.top);
        ctx.lineTo(xZero, chartArea.bottom);
        ctx.stroke();
      }
      ctx.restore();
    },
  };

  // ==========================================================================
  // Inicialização de elementos e filtros
  // ==========================================================================
  function cacheElements() {
    els.filterHotel = document.getElementById("filterHotel");
    els.filterTier = document.getElementById("filterTier");
    els.filterYear = document.getElementById("filterYear");
    els.btnReset = document.getElementById("btnResetFilters");
    els.btnEmptyReset = document.getElementById("btnEmptyReset");

    els.emptyState = document.getElementById("emptyState");
    els.dashboardContent = document.getElementById("dashboardContent");
    els.scopeSummary = document.getElementById("scopeSummary");

    els.kpiOccupancy = document.getElementById("kpiOccupancy");
    els.kpiOccupancyMeta = document.getElementById("kpiOccupancyMeta");
    els.kpiAdr = document.getElementById("kpiAdr");
    els.kpiAdrMeta = document.getElementById("kpiAdrMeta");
    els.kpiRevpar = document.getElementById("kpiRevpar");
    els.kpiRevparMeta = document.getElementById("kpiRevparMeta");

    els.btnMarsHotel = document.getElementById("btnMarsHotel");
    els.btnMarsTier = document.getElementById("btnMarsTier");

    els.tableCounter = document.getElementById("tableCounter");
    els.tableBody = document.getElementById("performanceTableBody");
    els.tableHeaders = document.querySelectorAll("#performanceTable thead th[data-sort]");
  }

  function populateHotelFilter() {
    DB.hotels.forEach((h) => {
      const option = document.createElement("option");
      option.value = h.hotel_id;
      option.textContent = `${h.hotel_id} — ${h.name}`;
      els.filterHotel.appendChild(option);
    });
  }

  // ==========================================================================
  // Filtragem sincronizada para todas as coleções de dados
  // ==========================================================================
  function getFilteredSlices() {
    const matchedHotels = DB.hotels.filter((h) => {
      if (state.hotel !== "all" && h.hotel_id !== state.hotel) return false;
      if (state.tier !== "all" && h.tier !== state.tier) return false;
      return true;
    });
    const hotelIds = new Set(matchedHotels.map((h) => h.hotel_id));
    const yearNum = state.year === "all" ? null : Number(state.year);

    const weekly = DB.weekly.filter(
      (w) => hotelIds.has(w.hotel_id) && (yearNum === null || w.year === yearNum)
    );
    const mars = DB.mars.filter(
      (m) => hotelIds.has(m.hotel_id) && (yearNum === null || m.year === yearNum)
    );
    const reviews = DB.reviews.filter(
      (r) => hotelIds.has(r.hotel_id) && (yearNum === null || r.year === yearNum)
    );
    const decisions = DB.decisions.filter(
      (d) => hotelIds.has(d.hotel_id) && (yearNum === null || d.year === yearNum)
    );

    return { matchedHotels, weekly, mars, reviews, decisions };
  }

  // ==========================================================================
  // Criação única das 6 instâncias do Chart.js (evita duplicação ao filtrar)
  // ==========================================================================
  function initCharts() {
    if (typeof window.Chart === "undefined") {
      console.error("Chart.js não foi carregado. Verifique a conexão com a internet.");
      return;
    }

    Chart.defaults.font.family =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif";
    Chart.defaults.color = "#475569";

    // Gráfico 1: Evolução semanal (Ocupação % + ADR USD + Eventos de demanda)
    charts.evolution = new Chart(document.getElementById("chartEvolution"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Ocupação média (%)",
            data: [],
            yAxisID: "yOcc",
            borderColor: PALETTE.navy,
            backgroundColor: "rgba(18, 53, 91, 0.08)",
            borderWidth: 2.2,
            pointRadius: 1.5,
            pointHoverRadius: 5,
            tension: 0.25,
            fill: true,
          },
          {
            label: "Diária média — ADR (USD)",
            data: [],
            yAxisID: "yAdr",
            borderColor: PALETTE.teal,
            backgroundColor: "transparent",
            borderWidth: 2.2,
            pointRadius: 1.5,
            pointHoverRadius: 5,
            tension: 0.25,
          },
          {
            label: "Semana com evento de demanda",
            data: [],
            yAxisID: "yOcc",
            borderColor: PALETTE.coral,
            backgroundColor: PALETTE.coral,
            showLine: false,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointStyle: "circle",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: { usePointStyle: true, boxWidth: 10, padding: 14 },
          },
          tooltip: {
            callbacks: {
              title(items) {
                const idx = items[0].dataIndex;
                const meta = charts.evolution.$weekMeta?.[idx];
                if (!meta) return items[0].label;
                return meta.event
                  ? `Semana de ${meta.label} · Evento: ${meta.event}`
                  : `Semana de ${meta.label}`;
              },
              label(ctx) {
                if (ctx.parsed.y === null || ctx.parsed.y === undefined) return null;
                if (ctx.datasetIndex === 0) return ` Ocupação média: ${fmtPct(ctx.parsed.y, 1)}`;
                if (ctx.datasetIndex === 1) return ` Diária média (ADR): ${fmtUSD(ctx.parsed.y, 2)}`;
                return ` Pico em semana de evento: ${fmtPct(ctx.parsed.y, 1)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 14, maxRotation: 0 },
          },
          yOcc: {
            type: "linear",
            position: "left",
            title: { display: true, text: "Ocupação média (%)" },
            suggestedMin: 45,
            suggestedMax: 95,
            ticks: { callback: (v) => `${v}%` },
            grid: { color: PALETTE.grid },
          },
          yAdr: {
            type: "linear",
            position: "right",
            title: { display: true, text: "Diária média — ADR (USD)" },
            ticks: { callback: (v) => `US$ ${v}` },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });

    // Gráfico 2: Comparação entre tiers (ADR, RevPAR e Ocupação)
    charts.tiers = new Chart(document.getElementById("chartTiers"), {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            label: "ADR (USD)",
            data: [],
            yAxisID: "yUsd",
            backgroundColor: PALETTE.navy,
            borderRadius: 4,
          },
          {
            label: "RevPAR (USD)",
            data: [],
            yAxisID: "yUsd",
            backgroundColor: PALETTE.blue,
            borderRadius: 4,
          },
          {
            label: "Ocupação média (%)",
            data: [],
            yAxisID: "yPct",
            backgroundColor: PALETTE.teal,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 11 } },
          tooltip: {
            callbacks: {
              label(ctx) {
                if (ctx.dataset.yAxisID === "yPct") {
                  return ` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y, 1)}`;
                }
                return ` ${ctx.dataset.label}: ${fmtUSD(ctx.parsed.y, 2)}`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          yUsd: {
            type: "linear",
            position: "left",
            beginAtZero: true,
            title: { display: true, text: "ADR e RevPAR (USD)" },
            ticks: { callback: (v) => `US$ ${v}` },
            grid: { color: PALETTE.grid },
          },
          yPct: {
            type: "linear",
            position: "right",
            beginAtZero: true,
            max: 100,
            title: { display: true, text: "Ocupação média (%)" },
            ticks: { callback: (v) => `${v}%` },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });

    // Gráfico 3: Mapa de posicionamento competitivo (Eixo X = ARI, Eixo Y = MPI)
    charts.positioning = new Chart(document.getElementById("chartPositioning"), {
      type: "scatter",
      data: { datasets: [] },
      plugins: [positioningQuadrantsPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { usePointStyle: true, boxWidth: 9 } },
          tooltip: {
            callbacks: {
              label(ctx) {
                const h = ctx.raw.hotel;
                return [
                  ` ${h.hotel_id} — ${h.name} (${TIER_LABELS[h.tier]})`,
                  ` ARI (preço vs. pares): ${fmtDec(h.ari, 1)}`,
                  ` MPI (ocupação vs. pares): ${fmtDec(h.mpi, 1)}`,
                  ` ADR: ${fmtUSD(h.adr, 2)} | Ocupação: ${fmtPct(h.occupancy, 1)}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "ARI — Índice de Preço contra Concorrentes (100 = par)" },
            suggestedMin: 74,
            suggestedMax: 142,
            grid: { color: PALETTE.grid },
          },
          y: {
            title: { display: true, text: "MPI — Índice de Ocupação contra Concorrentes (100 = par)" },
            suggestedMin: 93,
            suggestedMax: 108,
            grid: { color: PALETTE.grid },
          },
        },
      },
    });

    // Gráfico 4: Desvio entre preço praticado e diária MARS (barras horizontais divergentes)
    charts.mars = new Chart(document.getElementById("chartMars"), {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            label: "Acima do MARS (+)",
            data: [],
            backgroundColor: PALETTE.blue,
            borderRadius: 4,
          },
          {
            label: "Abaixo do MARS (−)",
            data: [],
            backgroundColor: PALETTE.teal,
            borderRadius: 4,
          },
        ],
      },
      plugins: [marsBandPlugin],
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 11 } },
          tooltip: {
            callbacks: {
              label(ctx) {
                if (ctx.parsed.x === null) return null;
                const item = charts.mars.$items?.[ctx.dataIndex];
                if (!item) return null;
                return [
                  ` Desvio percentual: ${fmtSignedPct(item.gapPct, 1)}`,
                  ` Desvio absoluto: ${fmtSignedUSD(item.diffUsd, 2)}`,
                  ` ADR praticado: ${fmtUSD(item.adr, 2)} | MARS: ${fmtUSD(item.mars, 2)}`,
                  ` Noites na banda ±6%: ${fmtPct(item.inBandPct, 0)}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            title: { display: true, text: "Desvio médio em relação à diária MARS (%)" },
            ticks: { callback: (v) => `${v > 0 ? "+" : ""}${v}%` },
            grid: { color: PALETTE.grid },
          },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });

    // Gráfico 5: Distribuição dos cenários das avaliações (barras horizontais ordenadas)
    charts.scenarios = new Chart(document.getElementById("chartScenarios"), {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            label: "Participação (%)",
            data: [],
            backgroundColor: [],
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const row = charts.scenarios.$rows?.[ctx.dataIndex];
                if (!row) return null;
                return ` ${fmtInt(row.count)} avaliações (${fmtPct(row.pct, 1)} do total)`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            title: { display: true, text: "Participação no total de avaliações (%)" },
            ticks: { callback: (v) => `${v}%` },
            grid: { color: PALETTE.grid },
          },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });

    // Gráfico 6: Resultados das decisões de preço (barras agrupadas por ação)
    charts.decisions = new Chart(document.getElementById("chartDecisions"), {
      type: "bar",
      data: {
        labels: ["Aumentar (raise)", "Manter (hold)", "Reduzir (lower)"],
        datasets: [
          { label: "Better (melhor)", data: [0, 0, 0], backgroundColor: PALETTE.teal, borderRadius: 4 },
          { label: "In line (em linha)", data: [0, 0, 0], backgroundColor: PALETTE.blue, borderRadius: 4 },
          { label: "Worse (pior)", data: [0, 0, 0], backgroundColor: PALETTE.coral, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 11 } },
          tooltip: {
            callbacks: {
              label(ctx) {
                const count = ctx.parsed.y;
                const actionTotal = charts.decisions.$actionTotals?.[ctx.dataIndex] || 0;
                const pct = actionTotal > 0 ? (count / actionTotal) * 100 : 0;
                return ` ${ctx.dataset.label}: ${fmtInt(count)} (${fmtPct(pct, 1)} da ação)`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Quantidade de decisões semanais" },
            grid: { color: PALETTE.grid },
          },
        },
      },
    });
  }

  // ==========================================================================
  // Atualização dos 3 KPIs (cálculos ponderados por quartos disponíveis/vendidos)
  // ==========================================================================
  function updateKPIs(weekly, matchedHotels) {
    let totalAvail = 0;
    let totalSold = 0;
    let totalRoomRev = 0;
    let totalRev = 0;
    const uniqueWeeks = new Set();

    for (const w of weekly) {
      totalAvail += w.available_rooms;
      totalSold += w.rooms_sold;
      totalRoomRev += w.room_revenue;
      totalRev += w.total_revenue;
      uniqueWeeks.add(w.week_start);
    }

    const occ = totalAvail > 0 ? (totalSold / totalAvail) * 100 : 0;
    const adr = totalSold > 0 ? totalRoomRev / totalSold : 0;
    const revpar = totalAvail > 0 ? totalRoomRev / totalAvail : 0;

    els.kpiOccupancy.textContent = fmtPct(occ, 1);
    els.kpiOccupancyMeta.textContent = `${fmtInt(totalSold)} de ${fmtInt(totalAvail)} quartos-noite vendidos`;

    els.kpiAdr.textContent = fmtUSD(adr, 2);
    els.kpiAdrMeta.textContent = `Receita de hospedagem: ${fmtUSD(totalRoomRev, 0)}`;

    els.kpiRevpar.textContent = fmtUSD(revpar, 2);
    els.kpiRevparMeta.textContent = `Receita total no recorte: ${fmtUSD(totalRev, 0)}`;

    const hLabel = matchedHotels.length === 1 ? "1 hotel" : `${matchedHotels.length} hotéis`;
    els.scopeSummary.textContent = `${hLabel} · ${uniqueWeeks.size} semanas`;
  }

  // ==========================================================================
  // Atualização dos 6 gráficos existentes (chart.update sem recriar instâncias)
  // ==========================================================================
  function updateEvolutionChart(weekly) {
    const byWeek = new Map();
    for (const w of weekly) {
      if (!byWeek.has(w.week_start)) {
        byWeek.set(w.week_start, {
          week: w.week_start,
          avail: 0,
          sold: 0,
          roomRev: 0,
          event: w.demand_event || null,
        });
      }
      const acc = byWeek.get(w.week_start);
      acc.avail += w.available_rooms;
      acc.sold += w.rooms_sold;
      acc.roomRev += w.room_revenue;
      if (!acc.event && w.demand_event) acc.event = w.demand_event;
    }

    const sortedWeeks = Array.from(byWeek.values()).sort((a, b) => a.week.localeCompare(b.week));
    const labels = sortedWeeks.map((d) => {
      const [y, m, day] = d.week.split("-");
      return `${day}/${m}/${y.slice(2)}`;
    });
    const occData = sortedWeeks.map((d) => (d.sold / d.avail) * 100);
    const adrData = sortedWeeks.map((d) => d.roomRev / d.sold);
    const eventPoints = sortedWeeks.map((d, i) => (d.event ? occData[i] : null));

    charts.evolution.$weekMeta = sortedWeeks.map((d, i) => ({
      label: labels[i],
      event: d.event,
    }));
    charts.evolution.data.labels = labels;
    charts.evolution.data.datasets[0].data = occData;
    charts.evolution.data.datasets[1].data = adrData;
    charts.evolution.data.datasets[2].data = eventPoints;
    charts.evolution.update();
  }

  function updateTiersChart(weekly) {
    const byTier = {};
    for (const w of weekly) {
      const tier = hotelById[w.hotel_id].tier;
      if (!byTier[tier]) byTier[tier] = { avail: 0, sold: 0, roomRev: 0 };
      byTier[tier].avail += w.available_rooms;
      byTier[tier].sold += w.rooms_sold;
      byTier[tier].roomRev += w.room_revenue;
    }

    const activeTiers = TIER_ORDER.filter((t) => byTier[t]);
    charts.tiers.data.labels = activeTiers.map((t) => TIER_LABELS[t]);
    charts.tiers.data.datasets[0].data = activeTiers.map((t) => byTier[t].roomRev / byTier[t].sold);
    charts.tiers.data.datasets[1].data = activeTiers.map((t) => byTier[t].roomRev / byTier[t].avail);
    charts.tiers.data.datasets[2].data = activeTiers.map((t) => (byTier[t].sold / byTier[t].avail) * 100);
    charts.tiers.update();
  }

  // Agrega dados por hotel para o Gráfico 3 (posicionamento) e para a Tabela
  function aggregateHotels(weekly, reviews) {
    const map = {};
    for (const w of weekly) {
      if (!map[w.hotel_id]) {
        const h = hotelById[w.hotel_id];
        map[w.hotel_id] = {
          hotel_id: h.hotel_id,
          name: h.name,
          tier: h.tier,
          avail: 0,
          sold: 0,
          roomRev: 0,
          totalRev: 0,
          ariWeighted: 0,
          mpiWeighted: 0,
          reviewCount: 0,
          ratingSum: 0,
        };
      }
      const a = map[w.hotel_id];
      a.avail += w.available_rooms;
      a.sold += w.rooms_sold;
      a.roomRev += w.room_revenue;
      a.totalRev += w.total_revenue;
      // Ponderação apropriada: ARI pelos quartos vendidos e MPI pelos quartos disponíveis
      a.ariWeighted += w.ari * w.rooms_sold;
      a.mpiWeighted += w.mpi * w.available_rooms;
    }

    for (const r of reviews) {
      if (!map[r.hotel_id]) continue;
      map[r.hotel_id].reviewCount += r.review_count;
      map[r.hotel_id].ratingSum += r.rating_sum;
    }

    return Object.values(map).map((a) => ({
      hotel_id: a.hotel_id,
      name: a.name,
      tier: a.tier,
      occupancy: (a.sold / a.avail) * 100,
      adr: a.roomRev / a.sold,
      revpar: a.roomRev / a.avail,
      totalRevenue: a.totalRev,
      ari: a.ariWeighted / a.sold,
      mpi: a.mpiWeighted / a.avail,
      meanRating: a.reviewCount > 0 ? a.ratingSum / a.reviewCount : null,
      reviewCount: a.reviewCount,
    }));
  }

  function updatePositioningChart(hotelRows) {
    const datasets = TIER_ORDER.map((tier) => {
      const points = hotelRows
        .filter((h) => h.tier === tier)
        .map((h) => ({ x: h.ari, y: h.mpi, hotel: h }));
      return {
        label: TIER_LABELS[tier],
        data: points,
        backgroundColor: TIER_COLORS[tier],
        borderColor: "#ffffff",
        borderWidth: 1.5,
        pointRadius: 7,
        pointHoverRadius: 9,
      };
    }).filter((ds) => ds.data.length > 0);

    charts.positioning.data.datasets = datasets;
    charts.positioning.update();
  }

  function updateMarsChart(marsRows) {
    const grouped = {};
    for (const m of marsRows) {
      const h = hotelById[m.hotel_id];
      const key = state.marsMode === "hotel" ? m.hotel_id : h.tier;
      const label = state.marsMode === "hotel" ? `${h.hotel_id} — ${h.name}` : TIER_LABELS[h.tier];
      if (!grouped[key]) {
        grouped[key] = {
          label,
          sold: 0,
          nights: 0,
          adrWeightedSum: 0,
          marsWeightedSum: 0,
          inBand: 0,
        };
      }
      grouped[key].sold += m.rooms_sold;
      grouped[key].nights += m.nights;
      grouped[key].adrWeightedSum += m.adr_weighted_sum;
      grouped[key].marsWeightedSum += m.mars_weighted_sum;
      grouped[key].inBand += m.in_band_nights;
    }

    const items = Object.values(grouped)
      .map((g) => {
        const adr = g.adrWeightedSum / g.sold;
        const mars = g.marsWeightedSum / g.sold;
        const diffUsd = adr - mars;
        const gapPct = (diffUsd / mars) * 100;
        return {
          label: g.label,
          adr,
          mars,
          diffUsd,
          gapPct,
          inBandPct: (g.inBand / g.nights) * 100,
        };
      })
      .sort((a, b) => b.gapPct - a.gapPct);

    charts.mars.$items = items;
    charts.mars.data.labels = items.map((i) => i.label);
    charts.mars.data.datasets[0].data = items.map((i) => (i.gapPct >= 0 ? i.gapPct : null));
    charts.mars.data.datasets[1].data = items.map((i) => (i.gapPct < 0 ? i.gapPct : null));
    charts.mars.update();
  }

  function updateScenariosChart(reviews) {
    const counts = {};
    let total = 0;
    for (const r of reviews) {
      counts[r.scenario_id] = (counts[r.scenario_id] || 0) + r.review_count;
      total += r.review_count;
    }

    const rows = Object.entries(counts)
      .map(([id, count]) => ({
        id,
        label: scenarioById[id].label,
        sentiment: scenarioById[id].expected_sentiment,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    charts.scenarios.$rows = rows;
    charts.scenarios.data.labels = rows.map((r) => r.label);
    charts.scenarios.data.datasets[0].data = rows.map((r) => r.pct);
    charts.scenarios.data.datasets[0].backgroundColor = rows.map((r) => SENTIMENT_COLORS[r.sentiment]);
    charts.scenarios.update();
  }

  function updateDecisionsChart(decisions) {
    const actions = ["raise", "hold", "lower"];
    const outcomes = ["better", "in line", "worse"];
    const matrix = {
      raise: { better: 0, "in line": 0, worse: 0 },
      hold: { better: 0, "in line": 0, worse: 0 },
      lower: { better: 0, "in line": 0, worse: 0 },
    };

    for (const d of decisions) {
      if (matrix[d.action] && matrix[d.action][d.outcome] !== undefined) {
        matrix[d.action][d.outcome] += d.decision_count;
      }
    }

    charts.decisions.$actionTotals = actions.map(
      (a) => matrix[a].better + matrix[a]["in line"] + matrix[a].worse
    );
    outcomes.forEach((o, idx) => {
      charts.decisions.data.datasets[idx].data = actions.map((a) => matrix[a][o]);
    });
    charts.decisions.update();
  }

  // ==========================================================================
  // Tabela de desempenho ordenável
  // ==========================================================================
  function updateTable(hotelRows) {
    const dir = state.sortDir === "asc" ? 1 : -1;
    const sorted = [...hotelRows].sort((a, b) => {
      const va = a[state.sortKey];
      const vb = b[state.sortKey];
      if (typeof va === "string") return va.localeCompare(vb, "pt-BR") * dir;
      const na = va === null ? -Infinity : va;
      const nb = vb === null ? -Infinity : vb;
      return (na - nb) * dir;
    });

    els.tableCounter.textContent =
      sorted.length === 1 ? "1 hotel exibido" : `${sorted.length} hotéis exibidos`;

    els.tableHeaders.forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.sortKey) {
        th.classList.add(state.sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });

    els.tableBody.innerHTML = sorted
      .map((h) => {
        const ratingStr = h.meanRating !== null ? `${fmtDec(h.meanRating, 2)} ★` : "Sem avaliações";
        return `
          <tr>
            <td><span class="hotel-code">${h.hotel_id}</span><span class="hotel-primary">${h.name}</span></td>
            <td><span class="tier-tag tier-${h.tier}">${TIER_LABELS[h.tier]}</span></td>
            <td class="num">${fmtPct(h.occupancy, 1)}</td>
            <td class="num">${fmtUSD(h.adr, 2)}</td>
            <td class="num"><strong>${fmtUSD(h.revpar, 2)}</strong></td>
            <td class="num">${fmtUSD(h.totalRevenue, 0)}</td>
            <td class="num">${ratingStr}</td>
          </tr>
        `;
      })
      .join("");
  }

  // ==========================================================================
  // Orquestrador central: atualiza todos os componentes simultaneamente
  // ==========================================================================
  function renderAll() {
    const { matchedHotels, weekly, mars, reviews, decisions } = getFilteredSlices();

    if (weekly.length === 0) {
      els.dashboardContent.classList.add("hidden");
      els.emptyState.classList.remove("hidden");
      return;
    }

    els.emptyState.classList.add("hidden");
    els.dashboardContent.classList.remove("hidden");

    const hotelRows = aggregateHotels(weekly, reviews);

    updateKPIs(weekly, matchedHotels);
    updateTable(hotelRows);

    if (charts.evolution) {
      updateEvolutionChart(weekly);
      updateTiersChart(weekly);
      updatePositioningChart(hotelRows);
      updateMarsChart(mars);
      updateScenariosChart(reviews);
      updateDecisionsChart(decisions);
    }
  }

  function resetFilters() {
    state.hotel = "all";
    state.tier = "all";
    state.year = "all";
    els.filterHotel.value = "all";
    els.filterTier.value = "all";
    els.filterYear.value = "all";
    renderAll();
  }

  function bindEvents() {
    els.filterHotel.addEventListener("change", (e) => {
      state.hotel = e.target.value;
      renderAll();
    });
    els.filterTier.addEventListener("change", (e) => {
      state.tier = e.target.value;
      renderAll();
    });
    els.filterYear.addEventListener("change", (e) => {
      state.year = e.target.value;
      renderAll();
    });

    els.btnReset.addEventListener("click", resetFilters);
    els.btnEmptyReset.addEventListener("click", resetFilters);

    els.btnMarsHotel.addEventListener("click", () => {
      if (state.marsMode === "hotel") return;
      state.marsMode = "hotel";
      els.btnMarsHotel.classList.add("active");
      els.btnMarsTier.classList.remove("active");
      renderAll();
    });
    els.btnMarsTier.addEventListener("click", () => {
      if (state.marsMode === "tier") return;
      state.marsMode = "tier";
      els.btnMarsTier.classList.add("active");
      els.btnMarsHotel.classList.remove("active");
      renderAll();
    });

    els.tableHeaders.forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = key === "name" || key === "tier" ? "asc" : "desc";
        }
        renderAll();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    populateHotelFilter();
    initCharts();
    bindEvents();
    renderAll();
  });
})();
