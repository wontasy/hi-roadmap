(function () {
  "use strict";

  /* ==================== ビジネスルール（絶対条件） ==================== */
  const PACKS_DESC = [1100000, 550000, 330000, 220000, 110000]; // 110万/55万/33万/22万/11万
  const PROFIT_MARGIN = 0.20;      // 利益率20%固定
  const CYCLE_MONTHS = 2;          // 資金回収サイクル = 2ヶ月
  const UNIT = 110000;             // 11万円あたり
  const ITEMS_PER_UNIT = 5;        // 11万円あたり約5個

  const MAX_CYCLES = 60;           // シミュレーション上限（安全弁）
  const EXTRA_SEARCH_MAX = 5000000; // 追加資金アドバイスの探索上限（円）

  /* ==================== DOM参照 ==================== */
  const el = {
    studentName: document.getElementById("studentName"),
    createdDate: document.getElementById("createdDate"),
    targetProfit: document.getElementById("targetProfit"),
    targetProfitValue: document.getElementById("targetProfitValue"),
    targetMonths: document.getElementById("targetMonths"),
    targetMonthsValue: document.getElementById("targetMonthsValue"),
    initialCapital: document.getElementById("initialCapital"),
    initialCapitalSub: document.getElementById("initialCapitalSub"),
    monthlyAdditional: document.getElementById("monthlyAdditional"),
    monthlyAdditionalSub: document.getElementById("monthlyAdditionalSub"),
    pdfButton: document.getElementById("pdfButton"),

    outStudentName: document.getElementById("outStudentName"),
    outCreatedDate: document.getElementById("outCreatedDate"),
    outGoalCombo: document.getElementById("outGoalCombo"),
    outGoalMonth: document.getElementById("outGoalMonth"),
    outGoalMonthlyProfit: document.getElementById("outGoalMonthlyProfit"),
    paceCard: document.getElementById("paceCard"),
    paceStatus: document.getElementById("paceStatus"),
    paceAdvice: document.getElementById("paceAdvice"),
    timelineBody: document.getElementById("timelineBody"),
    chartCanvas: document.getElementById("capitalChart"),
    chartPdfFallback: document.getElementById("chartPdfFallback"),
    chartPdfPlot: document.getElementById("chartPdfPlot"),
    profitChartWrap: document.getElementById("profitChartWrap"),
    profitChartPdfFallback: document.getElementById("profitChartPdfFallback"),
    profitChartPdfPlot: document.getElementById("profitChartPdfPlot"),
  };

  let chartInstance = null;

  /* ==================== フォーマッタ ==================== */
  function formatYen(n) {
    return Math.round(n).toLocaleString("ja-JP") + "円";
  }
  function formatMan(n) {
    const man = n / 10000;
    const rounded = Math.round(man * 10) / 10;
    return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1)) + "万円";
  }
  function formatDateJP(dateStr) {
    if (!dateStr) return "----年--月--日";
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "----年--月--日";
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  function comboToChips(combo) {
    if (!combo.length) return '<span class="pack-chip">資金確保中（次のサイクルで発注パックが決まります）</span>';
    return combo
      .map((c) => `<span class="pack-chip">${formatMan(c.pack)} × ${c.count}</span>`)
      .join("");
  }
  function comboToTags(combo) {
    if (!combo.length) return '<span class="pack-tag">資金確保中</span>';
    return combo.map((c) => `<span class="pack-tag">${formatMan(c.pack)}×${c.count}</span>`).join("");
  }

  /* ==================== シミュレーションコア ==================== */
  // 資金内で最も高額なパックから優先して組み合わせる（余剰資金はプール）
  function greedyCombo(capital) {
    let remaining = Math.floor(capital);
    const combo = [];
    for (const pack of PACKS_DESC) {
      const count = Math.floor(remaining / pack);
      if (count > 0) {
        combo.push({ pack, count });
        remaining -= pack * count;
      }
    }
    const orderAmount = capital - remaining;
    return { combo, orderAmount, leftover: remaining };
  }

  // 1サイクル = 2ヶ月。利益は全額再投資、追加資金は「追加資金×2ヶ月分」を毎サイクル加算。
  function runSimulation(initialCapital, monthlyAdditional, maxCycles) {
    const rows = [];
    let pool = initialCapital;

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      const capitalAtStart = pool + monthlyAdditional * CYCLE_MONTHS;
      const { combo, orderAmount, leftover } = greedyCombo(capitalAtStart);
      const profit = orderAmount * PROFIT_MARGIN;
      const monthlyProfit = profit / CYCLE_MONTHS;
      const items = Math.round((orderAmount / UNIT) * ITEMS_PER_UNIT);
      const poolAfter = capitalAtStart + profit; // 元本回収 + 利益、未使用分もそのままプール

      rows.push({
        cycle,
        monthStart: (cycle - 1) * CYCLE_MONTHS + 1,
        monthEnd: cycle * CYCLE_MONTHS,
        capitalAtStart,
        combo,
        orderAmount,
        leftover,
        profit,
        monthlyProfit,
        items,
        poolAfter,
      });

      pool = poolAfter;
    }
    return rows;
  }

  function findAchievedIndex(rows, targetMonthlyProfit) {
    return rows.findIndex((r) => r.monthlyProfit >= targetMonthlyProfit);
  }

  // 目標時期までに到達するために必要な「追加の毎月資金」を二分探索で求める
  function findRequiredExtra(initialCapital, monthlyAdditional, targetMonthlyProfit, targetMonths) {
    const maxCyclesForCheck = Math.max(1, Math.ceil(targetMonths / CYCLE_MONTHS));

    function achievableWithExtra(extra) {
      const sim = runSimulation(initialCapital, monthlyAdditional + extra, maxCyclesForCheck);
      return sim.some((r) => r.monthEnd <= targetMonths && r.monthlyProfit >= targetMonthlyProfit);
    }

    if (!achievableWithExtra(EXTRA_SEARCH_MAX)) return null; // 目標時期が短すぎる等、資金追加だけでは不可能

    let lo = 0;
    let hi = EXTRA_SEARCH_MAX;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (achievableWithExtra(mid)) hi = mid;
      else lo = mid;
    }
    return Math.ceil(hi / 10000) * 10000; // 1万円単位に切り上げ
  }

  /* ==================== レンダリング ==================== */
  function render() {
    const studentName = el.studentName.value.trim() || "生徒";
    const createdDate = el.createdDate.value;
    const targetMonthlyProfit = Number(el.targetProfit.value);
    const targetMonths = Number(el.targetMonths.value);
    const initialCapital = Math.max(0, Number(el.initialCapital.value) || 0);
    const monthlyAdditional = Math.max(0, Number(el.monthlyAdditional.value) || 0);

    // ---- ヘッダー ----
    el.outStudentName.textContent = `${studentName} 様`;
    el.outCreatedDate.textContent = formatDateJP(createdDate);

    // ---- フルシミュレーション ----
    const fullSim = runSimulation(initialCapital, monthlyAdditional, MAX_CYCLES);
    const achievedIdx = findAchievedIndex(fullSim, targetMonthlyProfit);

    // ---- 表示範囲の決定 ----
    let displayCount;
    if (achievedIdx >= 0) {
      displayCount = Math.min(fullSim.length, achievedIdx + 1 + 3);
    } else {
      displayCount = Math.min(fullSim.length, Math.max(Math.ceil(targetMonths / CYCLE_MONTHS) + 3, 10));
    }
    const timeline = fullSim.slice(0, displayCount);

    // ---- ゴール表示 ----
    if (achievedIdx >= 0) {
      const goalRow = fullSim[achievedIdx];
      el.outGoalCombo.innerHTML = comboToChips(goalRow.combo);
      el.outGoalMonth.textContent = goalRow.monthEnd;
      el.outGoalMonthlyProfit.textContent = formatMan(goalRow.monthlyProfit);
    } else {
      el.outGoalCombo.innerHTML = `<span class="pack-chip">条件を調整すると、目標達成の発注パック構成がここに表示されます</span>`;
      el.outGoalMonth.textContent = "-";
      el.outGoalMonthlyProfit.textContent = "-";
    }

    // ---- ペース診断 ----
    el.paceCard.classList.remove("is-good", "is-warning");
    if (achievedIdx >= 0) {
      const achievedMonth = fullSim[achievedIdx].monthEnd;
      if (achievedMonth <= targetMonths) {
        el.paceCard.classList.add("is-good");
        const diff = targetMonths - achievedMonth;
        el.paceStatus.textContent = "順調です。目標時期までに達成できるペースです。";
        el.paceAdvice.textContent =
          diff > 0
            ? `現在のプランでは目標達成時期より約${diff}ヶ月早く、${achievedMonth}ヶ月目に目標月利 ${formatMan(targetMonthlyProfit)} を達成できる見込みです。`
            : `現在のプランで、目標達成時期ちょうどの${achievedMonth}ヶ月目に目標月利 ${formatMan(targetMonthlyProfit)} を達成できる見込みです。`;
      } else {
        el.paceCard.classList.add("is-warning");
        el.paceStatus.textContent = "あと一歩で目標達成です。";
        const requiredExtra = findRequiredExtra(initialCapital, monthlyAdditional, targetMonthlyProfit, targetMonths);
        if (requiredExtra !== null && requiredExtra > monthlyAdditional) {
          const diffExtra = requiredExtra - monthlyAdditional;
          el.paceAdvice.textContent =
            `現在のペースでは${achievedMonth}ヶ月目に達成の見込みです。毎月の追加資金をあと${formatMan(diffExtra)}増やす` +
            `（月々${formatMan(requiredExtra)}に増額）と、${targetMonths}ヶ月後の目標達成が見えてきます。`;
        } else {
          el.paceAdvice.textContent =
            `現在のペースでは${achievedMonth}ヶ月目に達成の見込みです。目標達成時期を${achievedMonth}ヶ月後に設定し直すか、初期資金を増やすと、さらに余裕を持って進められます。`;
        }
      }
    } else {
      el.paceCard.classList.add("is-warning");
      el.paceStatus.textContent = "条件を調整すると、目標月利への到達が見えてきます。";
      const requiredExtra = findRequiredExtra(initialCapital, monthlyAdditional, targetMonthlyProfit, targetMonths);
      if (requiredExtra !== null && requiredExtra > monthlyAdditional) {
        const diffExtra = requiredExtra - monthlyAdditional;
        el.paceAdvice.textContent = `毎月の追加資金をあと${formatMan(diffExtra)}増やすと、${targetMonths}ヶ月後の目標達成が見えてきます。`;
      } else {
        el.paceAdvice.textContent = `目標月利または目標達成時期を調整するか、初期資金・追加資金を増やすと、達成プランが見えてきます。`;
      }
    }

    // ---- タイムライン ----
    el.timelineBody.innerHTML = timeline
      .map((r, i) => {
        const isAchieved = i === achievedIdx;
        return `
        <tr class="${isAchieved ? "is-achieved" : ""}">
          <td class="cell-cycle">${r.cycle}</td>
          <td>${r.monthStart}〜${r.monthEnd}ヶ月目</td>
          <td class="cell-combo">${comboToTags(r.combo)}${isAchieved ? '<span class="achieved-badge">目標達成</span>' : ""}</td>
          <td>${formatMan(r.leftover)}</td>
          <td>${formatMan(r.profit)}</td>
          <td>${formatMan(r.monthlyProfit)} / 月</td>
          <td>約${r.items}個 / サイクル</td>
        </tr>`;
      })
      .join("");

    // ---- グラフ ----
    renderChart(timeline, achievedIdx, targetMonthlyProfit, targetMonths);
    renderChartPdfFallback(timeline, achievedIdx);
    renderProfitChart(timeline, achievedIdx, targetMonthlyProfit);
    renderProfitChartPdfFallback(timeline, achievedIdx, targetMonthlyProfit);
  }

  /* ==================== グラフ（月次利益の推移／PDF出力用フォールバック） ==================== */
  // 画面表示はSVGの折れ線グラフだが、html2pdf内蔵のhtml2canvasはSVGも
  // 安定して複製できないため（Chart.js canvasと同様の既知の問題）、
  // PDF出力時だけ資金推移グラフと同じCSSベースの静止棒グラフに差し替えて撮影する。
  function renderProfitChartPdfFallback(timeline, achievedIdx, targetMonthlyProfit) {
    const maxVal = Math.max(targetMonthlyProfit, ...timeline.map((r) => r.monthlyProfit), 1);
    const targetTopPct = 100 - (targetMonthlyProfit / maxVal) * 100;

    el.profitChartPdfPlot.innerHTML =
      `<div class="pdf-target-line" style="top:${targetTopPct}%"><span>目標月利ライン</span></div>` +
      timeline
        .map((r, i) => {
          const heightPct = Math.max((r.monthlyProfit / maxVal) * 100, 1);
          const isAchieved = i === achievedIdx;
          return `
          <div class="pdf-bar-col ${isAchieved ? "is-achieved" : ""}">
            <span class="pdf-bar-value">${formatMan(r.monthlyProfit)}</span>
            <div class="pdf-bar" style="height:${heightPct}%"></div>
            <span class="pdf-bar-label">${r.monthEnd}ヶ月</span>
          </div>`;
        })
        .join("");
  }

  /* ==================== グラフ（月次利益の推移／目標到達度） ==================== */
  // Chart.jsのライブcanvasはPDF出力時に複製できないため使わず、
  // 画面・PDFの両方でそのまま同じ見た目になるSVGを直接組み立てて描画する。
  function buildProfitChartSvg(timeline, achievedIdx, targetMonthlyProfit) {
    const n = timeline.length;
    if (n === 0) return "";

    const values = timeline.map((r) => r.monthlyProfit);
    const maxRaw = Math.max(targetMonthlyProfit, ...values, 1);
    const maxY = maxRaw * 1.2;

    const W = 760;
    const H = 270;
    const padL = 20;
    const padR = 20;
    const padT = 40;
    const padB = 38;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const x = (i) => (n <= 1 ? padL + innerW / 2 : padL + i * (innerW / (n - 1)));
    const y = (v) => padT + innerH - (Math.max(v, 0) / maxY) * innerH;

    const baselineY = y(0);
    const targetY = y(targetMonthlyProfit);

    const gridLines = [0.25, 0.5, 0.75, 1]
      .map((f) => {
        const gy = padT + innerH - f * innerH;
        return `<line class="profit-grid-line" x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}"></line>`;
      })
      .join("");

    const linePoints = timeline.map((r, i) => `${x(i).toFixed(1)},${y(r.monthlyProfit).toFixed(1)}`).join(" ");
    const areaPoints = `${x(0).toFixed(1)},${baselineY.toFixed(1)} ${linePoints} ${x(n - 1).toFixed(1)},${baselineY.toFixed(1)}`;

    const pointsMarkup = timeline
      .map((r, i) => {
        const isAchieved = i === achievedIdx;
        const cx = x(i);
        const cy = y(r.monthlyProfit);
        return `
          <text class="profit-value-label${isAchieved ? " is-achieved" : ""}" x="${cx.toFixed(1)}" y="${(cy - 16).toFixed(1)}" text-anchor="middle">${formatMan(r.monthlyProfit)}</text>
          <circle class="profit-point${isAchieved ? " is-achieved" : ""}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${isAchieved ? 8 : 5}"></circle>
          <text class="profit-axis-label" x="${cx.toFixed(1)}" y="${H - padB + 20}" text-anchor="middle">${r.monthEnd}ヶ月</text>`;
      })
      .join("");

    const targetLabelWidth = 148;
    const targetLabelX = Math.min(Math.max(W - padR - targetLabelWidth, padL), W - padR - targetLabelWidth);

    return `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="月次利益の推移">
        <defs>
          <linearGradient id="profitAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#d4af37" stop-opacity="0.45"></stop>
            <stop offset="100%" stop-color="#d4af37" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${gridLines}
        <line class="profit-target-line" x1="${padL}" y1="${targetY.toFixed(1)}" x2="${W - padR}" y2="${targetY.toFixed(1)}"></line>
        <rect class="profit-target-badge-bg" x="${targetLabelX.toFixed(1)}" y="${(targetY - 22).toFixed(1)}" width="${targetLabelWidth}" height="20" rx="10"></rect>
        <text class="profit-target-label" x="${(targetLabelX + targetLabelWidth / 2).toFixed(1)}" y="${(targetY - 8).toFixed(1)}" text-anchor="middle">目標月利 ${formatMan(targetMonthlyProfit)}</text>
        <line class="profit-baseline" x1="${padL}" y1="${baselineY.toFixed(1)}" x2="${W - padR}" y2="${baselineY.toFixed(1)}"></line>
        <polygon class="profit-area" points="${areaPoints}"></polygon>
        <polyline class="profit-line" points="${linePoints}"></polyline>
        ${pointsMarkup}
      </svg>`;
  }

  function renderProfitChart(timeline, achievedIdx, targetMonthlyProfit) {
    el.profitChartWrap.innerHTML = buildProfitChartSvg(timeline, achievedIdx, targetMonthlyProfit);
  }

  /* ==================== グラフ（PDF出力用フォールバック） ==================== */
  // html2pdf内蔵のhtml2canvasはライブのChart.js canvasを安定して複製できないため、
  // PDF出力時だけ、このCSSベースの静止棒グラフに差し替えて撮影する。
  function renderChartPdfFallback(timeline, achievedIdx) {
    const maxVal = Math.max(...timeline.map((r) => r.poolAfter), 1);
    const targetLevel = achievedIdx >= 0 ? timeline[achievedIdx].poolAfter : null;
    const targetTopPct = targetLevel !== null ? 100 - (targetLevel / maxVal) * 100 : null;

    el.chartPdfPlot.innerHTML =
      (targetTopPct !== null
        ? `<div class="pdf-target-line" style="top:${targetTopPct}%"><span>目標達成ライン</span></div>`
        : "") +
      timeline
        .map((r, i) => {
          const heightPct = Math.max((r.poolAfter / maxVal) * 100, 1);
          const isAchieved = i === achievedIdx;
          return `
          <div class="pdf-bar-col ${isAchieved ? "is-achieved" : ""}">
            <span class="pdf-bar-value">${formatMan(r.poolAfter)}</span>
            <div class="pdf-bar" style="height:${heightPct}%"></div>
            <span class="pdf-bar-label">${r.monthEnd}ヶ月</span>
          </div>`;
        })
        .join("");
  }

  /* ==================== グラフ描画 ==================== */
  function renderChart(timeline, achievedIdx, targetMonthlyProfit, targetMonths) {
    const ctx = document.getElementById("capitalChart").getContext("2d");

    const points = timeline.map((r) => ({ x: r.monthEnd, y: Math.round(r.poolAfter) }));
    const barColors = timeline.map((_, i) => (i === achievedIdx ? "#d4af37" : "rgba(212,175,55,0.35)"));
    const barBorders = timeline.map((_, i) => (i === achievedIdx ? "#f1d97a" : "rgba(212,175,55,0.5)"));

    const achievedPoint =
      achievedIdx >= 0 && achievedIdx < timeline.length
        ? [{ x: timeline[achievedIdx].monthEnd, y: Math.round(timeline[achievedIdx].poolAfter) }]
        : [];

    const annotations = {};
    if (achievedIdx >= 0 && achievedIdx < timeline.length) {
      annotations.targetLevelLine = {
        type: "line",
        yMin: Math.round(timeline[achievedIdx].poolAfter),
        yMax: Math.round(timeline[achievedIdx].poolAfter),
        borderColor: "#d4af37",
        borderWidth: 2,
        borderDash: [6, 6],
        label: {
          enabled: true,
          content: "目標達成資金ライン",
          position: "start",
          backgroundColor: "#d4af37",
          color: "#1a1204",
          font: { weight: "bold", size: 13 },
        },
      };
    }
    annotations.targetMonthLine = {
      type: "line",
      xMin: targetMonths,
      xMax: targetMonths,
      borderColor: "#e0763a",
      borderWidth: 2,
      borderDash: [4, 4],
      label: {
        enabled: true,
        content: `目標時期（${targetMonths}ヶ月）`,
        position: "end",
        backgroundColor: "#e0763a",
        color: "#fff",
        font: { weight: "bold", size: 13 },
      },
    };

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
      data: {
        datasets: [
          {
            type: "bar",
            label: "資金（プール／サイクル終了時点）",
            data: points,
            backgroundColor: barColors,
            borderColor: barBorders,
            borderWidth: 1.5,
            borderRadius: 4,
            barThickness: 26,
            order: 2,
          },
          {
            type: "scatter",
            label: "目標達成ポイント",
            data: achievedPoint,
            backgroundColor: "#fff2c2",
            borderColor: "#d4af37",
            borderWidth: 2,
            pointStyle: "star",
            pointRadius: 11,
            pointHoverRadius: 13,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "linear",
            min: 0,
            title: { display: true, text: "経過月数", color: "#8b8b93", font: { size: 13 } },
            ticks: {
              stepSize: CYCLE_MONTHS,
              color: "#c9c9cf",
              font: { size: 13 },
              callback: (v) => `${v}ヶ月`,
            },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
          y: {
            title: { display: true, text: "資金（円）", color: "#8b8b93", font: { size: 13 } },
            ticks: {
              color: "#c9c9cf",
              font: { size: 13 },
              callback: (v) => formatMan(v),
            },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
        },
        plugins: {
          legend: {
            labels: { color: "#f6f4ee", font: { size: 14 } },
          },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].parsed.x}ヶ月目`,
              label: (item) => `${item.dataset.label}: ${formatYen(item.parsed.y)}`,
            },
          },
          annotation: { annotations },
        },
      },
    });
  }

  /* ==================== 入力イベント ==================== */
  function syncLabels() {
    el.targetProfitValue.textContent = formatMan(Number(el.targetProfit.value));
    el.targetMonthsValue.textContent = `${el.targetMonths.value}ヶ月後`;
    el.initialCapitalSub.textContent = `＝ ${formatMan(Number(el.initialCapital.value) || 0)}`;
    el.monthlyAdditionalSub.textContent = `＝ ${formatMan(Number(el.monthlyAdditional.value) || 0)} / 月（給与等からの持ち出し）`;
  }

  function handleInput() {
    syncLabels();
    render();
  }

  [el.studentName, el.createdDate, el.targetProfit, el.targetMonths, el.initialCapital, el.monthlyAdditional].forEach(
    (input) => {
      input.addEventListener("input", handleInput);
    }
  );

  /* ==================== PDF出力 ==================== */
  el.pdfButton.addEventListener("click", async () => {
    const studentName = el.studentName.value.trim() || "生徒";
    const dateStr = el.createdDate.value || new Date().toISOString().slice(0, 10);
    const reportEl = document.getElementById("report");

    el.pdfButton.disabled = true;
    const originalLabel = el.pdfButton.innerHTML;
    el.pdfButton.innerHTML = "PDFを生成中…";

    const opt = {
      margin: [10, 8, 12, 8],
      filename: `卸パック発注ロードマップ_${studentName}_${dateStr}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, backgroundColor: "#0b0b0d", useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "avoid-all"] },
    };

    el.chartCanvas.style.display = "none";
    el.chartPdfFallback.classList.add("is-active");
    el.profitChartWrap.style.display = "none";
    el.profitChartPdfFallback.classList.add("is-active");

    try {
      await html2pdf().set(opt).from(reportEl).save();
      el.pdfButton.disabled = false;
      el.pdfButton.innerHTML = originalLabel;
    } catch (e) {
      console.error("PDF export failed:", e);
      el.pdfButton.innerHTML = "生成に失敗しました。再度お試しください";
      setTimeout(() => {
        el.pdfButton.disabled = false;
        el.pdfButton.innerHTML = originalLabel;
      }, 3000);
    } finally {
      el.chartCanvas.style.display = "";
      el.chartPdfFallback.classList.remove("is-active");
      el.profitChartWrap.style.display = "";
      el.profitChartPdfFallback.classList.remove("is-active");
    }
  });

  /* ==================== 初期化 ==================== */
  function init() {
    el.createdDate.value = new Date().toISOString().slice(0, 10);
    syncLabels();
    render();
  }

  init();
})();
