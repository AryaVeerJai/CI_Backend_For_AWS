const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { getApiVersion, getBaselineCodebaseVersion } = require('../config/version');

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toText = (value, fallback = 'NA') => {
  if (value === null || value === undefined || value === '') return fallback;
  const str = String(value);
  // Strip non-printable ASCII characters and known corruption patterns
  return str.replace(/[^\x20-\x7E\s]/g, '').trim() || fallback;
};

const sanitize = (text) => toText(text);

const SYSTEM_GENERATED_FOOTER =
  'This report is system-generated from Sustainow Carbon Intelligence workspace data and automated workflows. '
  + 'It supports planning and disclosure preparation only and does not replace statutory filings, registry submissions, or independent assurance unless explicitly stated.';

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

const centerBlockOffset = (doc, blockWidth) => {
  const usable = contentWidth(doc);
  return doc.page.margins.left + Math.max(0, (usable - blockWidth) / 2);
};

const resetContentCursor = (doc) => {
  doc.x = doc.page.margins.left;
};

const initPageContentTracking = (doc) => {
  doc._pageMaxY = [doc.page.margins.top];
  const originalAddPage = doc.addPage.bind(doc);
  doc.addPage = (...args) => {
    const result = originalAddPage(...args);
    doc._pageMaxY.push(doc.page.margins.top);
    resetContentCursor(doc);
    return result;
  };
};

const recordPageContentY = (doc, y) => {
  if (!Array.isArray(doc._pageMaxY) || doc._pageMaxY.length === 0) {
    return;
  }
  const pageIndex = doc._pageMaxY.length - 1;
  doc._pageMaxY[pageIndex] = Math.max(doc._pageMaxY[pageIndex], y);
};

const pruneTrailingBlankPages = (doc) => {
  if (typeof doc.bufferedPageRange !== 'function' || !Array.isArray(doc._pageBuffer)) {
    return;
  }
  let { start, count } = doc.bufferedPageRange();
  const minContentY = doc.page.margins.top + 28;
  while (count > 1) {
    const lastIndex = start + count - 1;
    doc.switchToPage(lastIndex);
    const trackedMaxY = Array.isArray(doc._pageMaxY) ? doc._pageMaxY[doc._pageMaxY.length - 1] : doc.y;
    const contentExtent = Math.max(doc.y, trackedMaxY);
    if (contentExtent > minContentY) {
      break;
    }
    doc._pageBuffer.pop();
    if (Array.isArray(doc._pageMaxY)) {
      doc._pageMaxY.pop();
    }
    ({ start, count } = doc.bufferedPageRange());
    if (count > 0) {
      doc.switchToPage(start + count - 1);
      resetContentCursor(doc);
    }
  }
};

const applyPdfPageFooters = (doc) => {
  if (typeof doc.bufferedPageRange !== 'function') {
    return;
  }
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  const footerTop = doc.page.height - 38;
  for (let i = 0; i < pageCount; i += 1) {
    doc.switchToPage(range.start + i);
    const w = contentWidth(doc);
    const left = doc.page.margins.left;
    doc.save();
    resetContentCursor(doc);
    doc
      .font('Helvetica-Oblique')
      .fontSize(6.5)
      .fillColor('#616161')
      .text(SYSTEM_GENERATED_FOOTER, left, footerTop, {
        width: w,
        align: 'center',
        lineGap: 1,
        height: 28
      });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#9E9E9E')
      .text(`Page ${i + 1} of ${pageCount}`, left, doc.page.height - 14, {
        width: w,
        align: 'right',
        height: 10,
        lineBreak: false
      });
    doc.restore();
    resetContentCursor(doc);
  }
};

const createPdfBuffer = (renderFn) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 42, bottom: 58, left: 42, right: 42 },
    bufferPages: true,
    info: {
      Producer: 'Carbon Intelligence MSME Carbon Workspace'
    }
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  initPageContentTracking(doc);
  renderFn(doc);
  recordPageContentY(doc, doc.y);
  pruneTrailingBlankPages(doc);
  applyPdfPageFooters(doc);
  doc.end();
});

const ensureSpace = (doc, minimum = 36) => {
  if (doc.y + minimum > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
  resetContentCursor(doc);
};

const writeHeading = (doc, text, options = {}) => {
  ensureSpace(doc, 40);
  const left = doc.page.margins.left;
  const align = options.align === 'center' ? 'center' : 'left';
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#0D47A1')
    .text(text, left, doc.y, { width: contentWidth(doc), align });
  recordPageContentY(doc, doc.y);
  doc.moveDown(0.25);
};

const writeChartSubheading = (doc, text) => {
  ensureSpace(doc, 22);
  const left = doc.page.margins.left;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#1565C0')
    .text(text, left, doc.y, { width: contentWidth(doc), align: 'center' });
  recordPageContentY(doc, doc.y);
  doc.moveDown(0.15);
};

const writeBodyParagraph = (doc, text, options = {}) => {
  ensureSpace(doc, 28);
  const left = doc.page.margins.left;
  doc
    .font(options.font || 'Helvetica')
    .fontSize(options.fontSize || 10)
    .fillColor(options.color || '#222222')
    .text(text, left, doc.y, {
      width: contentWidth(doc),
      align: 'left',
      paragraphGap: options.paragraphGap ?? 6
    });
  recordPageContentY(doc, doc.y);
};

const writeChartTitle = (doc, title, options = {}) => {
  if (options.subheading) {
    writeChartSubheading(doc, title);
    return;
  }
  writeHeading(doc, title);
};

const writeLabelValue = (doc, label, value) => {
  ensureSpace(doc, 22);
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#111111')
    .text(`${label}: `, left, doc.y, { width, align: 'left', continued: true });
  doc
    .font('Helvetica')
    .text(toText(value), { width, align: 'left' });
  recordPageContentY(doc, doc.y);
  resetContentCursor(doc);
};

const writeBullet = (doc, text) => {
  ensureSpace(doc, 20);
  const left = doc.page.margins.left;
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#222222')
    .text(`• ${text}`, left, doc.y, { width: contentWidth(doc), align: 'left' });
  recordPageContentY(doc, doc.y);
};

const CHART_PALETTE = ['#1565C0', '#2E7D32', '#F9A825', '#C62828', '#6A1B9A', '#00897B'];

const truncateChartLabel = (value, maxLen = 34) => {
  const t = toText(value, '');
  if (!t) return '';
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
};

const renderPdfVerticalBarChart = (doc, title, bars, options = {}) => {
  const { unit = '', maxBarHeight = 72, barWidth = 46, subheading = false } = options;
  const items = (Array.isArray(bars) ? bars : [])
    .map((b, idx) => ({
      label: truncateChartLabel(b.label || b.name || `S${idx + 1}`, 12),
      value: safeNumber(b.value)
    }))
    .filter((b) => b.label || b.value > 0);
  if (items.length === 0) {
    return;
  }

  writeChartTitle(doc, title, { subheading });
  ensureSpace(doc, maxBarHeight + 52);
  const maxVal = Math.max(...items.map((i) => i.value), 1);
  const totalWidth = contentWidth(doc);
  const gap = 14;
  const groupWidth = Math.min(barWidth + gap, (totalWidth - gap) / Math.max(items.length, 1));
  const chartSpan = items.length * groupWidth;
  const startX = centerBlockOffset(doc, chartSpan);
  const baselineY = doc.y + maxBarHeight + 12;

  items.forEach((item, idx) => {
    const x = startX + idx * groupWidth + (groupWidth - barWidth) / 2;
    const h = maxVal > 0 ? (item.value / maxVal) * maxBarHeight : 0;
    const y = baselineY - h;
    doc.save();
    doc.rect(x, y, barWidth, Math.max(h, 0)).fill(CHART_PALETTE[idx % CHART_PALETTE.length]);
    doc.restore();
    const valStr = `${item.value.toFixed(item.value >= 100 ? 0 : 2)}${unit ? ` ${unit}` : ''}`;
    const valueTop = h > 0 ? y - 11 : baselineY - 13;
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#111111')
      .text(valStr, x - 2, valueTop, { width: barWidth + 4, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#333333')
      .text(item.label, x - 2, baselineY + 4, { width: barWidth + 4, align: 'center' });
  });

  doc.y = baselineY + 26;
  recordPageContentY(doc, doc.y);
  resetContentCursor(doc);
  doc.moveDown(0.15);
};

const renderPdfHorizontalBarChart = (doc, title, rows, options = {}) => {
  const {
    labelKey = 'label',
    valueKey = 'value',
    unit = '',
    maxItems = 14,
    subheading = false
  } = options;
  const data = (Array.isArray(rows) ? rows : []).slice(0, maxItems).map((row, i) => ({
    label: truncateChartLabel(row[labelKey] ?? row.name ?? '', 38),
    value: safeNumber(row[valueKey])
  }));

  if (data.length === 0) {
    return;
  }

  writeChartTitle(doc, title, { subheading });
  const maxVal = Math.max(...data.map((r) => r.value), 1);
  const chartWidth = contentWidth(doc);
  const barHeight = 12;
  const rowGap = 5;
  const valueColW = 80;
  const labelW = Math.min(132, chartWidth * 0.4);
  const barAreaW = Math.max(80, chartWidth - labelW - valueColW - 10);
  const blockWidth = labelW + 4 + barAreaW + 6 + valueColW;
  const chartLeft = centerBlockOffset(doc, Math.min(blockWidth, chartWidth));

  data.forEach((row, i) => {
    ensureSpace(doc, barHeight + rowGap + 12);
    const y = doc.y;
    doc.font('Helvetica').fontSize(8).fillColor('#333333').text(row.label || '—', chartLeft, y + 1, {
      width: labelW,
      ellipsis: true
    });
    const x0 = chartLeft + labelW + 4;
    doc.save();
    doc.lineWidth(0.35).strokeColor('#cccccc').rect(x0, y, barAreaW, barHeight).stroke();
    const fillW = Math.max((row.value / maxVal) * barAreaW, row.value > 0 ? 1.2 : 0);
    doc.fillColor(CHART_PALETTE[i % CHART_PALETTE.length]).rect(x0, y, fillW, barHeight).fill();
    doc.restore();
    const valText = `${row.value.toFixed(2)}${unit ? ` ${unit}` : ''}`;
    doc.font('Helvetica').fontSize(8).fillColor('#111111').text(valText, x0 + barAreaW + 6, y + 1, { width: valueColW, align: 'left' });
    doc.y = y + barHeight + rowGap;
    recordPageContentY(doc, doc.y);
  });
  resetContentCursor(doc);
  doc.moveDown(0.15);
};

const renderPdfMultiLineChart = (doc, title, points, seriesList, options = {}) => {
  const { yAxisHint = '', subheading = false } = options;
  const pts = Array.isArray(points) ? points.filter((p) => p && typeof p === 'object') : [];
  if (pts.length === 0 || !Array.isArray(seriesList) || seriesList.length === 0) {
    return;
  }

  const chartHeight = 102;
  writeChartTitle(doc, title, { subheading });
  ensureSpace(doc, chartHeight + 52);
  const padL = 42;
  const padB = 26;
  const padT = 8;
  const chartW = contentWidth(doc);
  const plotW = chartW - padL;
  const plotH = chartHeight - padB - padT;

  const topY = doc.y;
  const plotLeft = centerBlockOffset(doc, chartW) + padL;
  const plotTop = topY + padT;
  const plotBottom = plotTop + plotH;

  let maxY = 0;
  seriesList.forEach((s) => {
    pts.forEach((p) => {
      maxY = Math.max(maxY, safeNumber(p[s.key]));
    });
  });
  if (maxY <= 0) {
    maxY = 1;
  }

  doc.save().lineWidth(0.25).strokeColor('#eeeeee');
  for (let g = 0; g <= 4; g += 1) {
    const gy = plotBottom - (g / 4) * plotH;
    doc.moveTo(plotLeft, gy).lineTo(plotLeft + plotW, gy).stroke();
  }
  doc.restore();

  doc.lineWidth(0.55).strokeColor('#bdbdbd').rect(plotLeft, plotTop, plotW, plotH).stroke();

  const n = pts.length;
  const xAt = (i) => (n <= 1 ? plotLeft + plotW / 2 : plotLeft + (i / Math.max(n - 1, 1)) * plotW);

  seriesList.forEach((s) => {
    doc.save().strokeColor(s.color).lineWidth(1.15);
    let first = true;
    pts.forEach((p, i) => {
      const val = safeNumber(p[s.key]);
      const py = plotBottom - (val / maxY) * plotH;
      const px = xAt(i);
      if (first) {
        doc.moveTo(px, py);
        first = false;
      } else {
        doc.lineTo(px, py);
      }
    });
    doc.stroke().restore();
  });

  const labelStep = n > 10 ? Math.ceil(n / 10) : 1;
  pts.forEach((p, i) => {
    if (i % labelStep !== 0 && i !== n - 1) {
      return;
    }
    const lab = truncateChartLabel(p.period || p.label || String(i), 11);
    doc.font('Helvetica').fontSize(6).fillColor('#616161').text(lab, xAt(i) - 20, plotBottom + 3, { width: 40, align: 'center' });
  });

  if (yAxisHint) {
    const hintLeft = centerBlockOffset(doc, chartW);
    doc.font('Helvetica').fontSize(7).fillColor('#757575').text(yAxisHint, hintLeft, plotTop - 2, { width: chartW, align: 'center' });
  }

  doc.font('Helvetica').fontSize(7);
  let legX = plotLeft;
  const legY = plotBottom + padB - 2;
  seriesList.forEach((s, idx) => {
    const wLabel = 22 + doc.widthOfString(s.label);
    if (legX + wLabel > plotLeft + plotW && idx > 0) {
      legX = plotLeft;
    }
    doc.save().rect(legX, legY + 2, 9, 4).fill(s.color).restore();
    doc.font('Helvetica').fontSize(7).fillColor('#424242').text(s.label, legX + 12, legY, { lineBreak: false });
    legX += wLabel + 12;
  });

  doc.y = plotBottom + padB + 10;
  recordPageContentY(doc, doc.y);
  resetContentCursor(doc);
  doc.moveDown(0.15);
};

const renderBrsrCarbonAnalyticsCharts = (doc, report) => {
  const ghg = report?.environmental?.greenhouseGasEmissions || {};
  const detail = report?.environmental?.carbonEmissionDetails || {};
  const categoryBreakdown = Array.isArray(detail?.categoryBreakdown) ? detail.categoryBreakdown : [];
  const trendPeriods = Array.isArray(detail?.assessmentTrend?.periods) ? detail.assessmentTrend.periods : [];
  const sector = report?.sectorCarbonAnalytics;
  const hotspots = Array.isArray(report?.environmental?.hotspotMitigationPlan?.hotspots)
    ? report.environmental.hotspotMitigationPlan.hotspots
    : [];
  const valueChainStages = Array.isArray(report?.valueChain?.stages) ? report.valueChain.stages : [];
  const pct = ghg.scopeContributionPercent;
  const scopeBars = [
    { label: 'Scope 1', value: safeNumber(ghg.scope1) },
    { label: 'Scope 2', value: safeNumber(ghg.scope2) },
    { label: 'Scope 3', value: safeNumber(ghg.scope3) }
  ];
  const hasScopeMixPercent = pct
    && typeof pct === 'object'
    && (safeNumber(pct.scope1) + safeNumber(pct.scope2) + safeNumber(pct.scope3)) > 0;
  const willRender = scopeBars.some((b) => b.value > 0)
    || hasScopeMixPercent
    || categoryBreakdown.length > 0
    || (Array.isArray(sector?.focusCategories) && sector.focusCategories.length > 0)
    || hotspots.length > 0
    || valueChainStages.length > 0
    || trendPeriods.length >= 2;
  if (!willRender) {
    return;
  }

  writeHeading(doc, 'Carbon emissions analytics', { align: 'center' });
  const chartOpts = { subheading: true };
  if (scopeBars.some((b) => b.value > 0)) {
    renderPdfVerticalBarChart(doc, 'Scope emissions (kgCO2e)', scopeBars, { unit: 'kgCO2e', ...chartOpts });
  }

  if (hasScopeMixPercent) {
    renderPdfVerticalBarChart(doc, 'Scope mix (% of reported total)', [
      { label: 'S1', value: safeNumber(pct.scope1) },
      { label: 'S2', value: safeNumber(pct.scope2) },
      { label: 'S3', value: safeNumber(pct.scope3) }
    ], { unit: '%', ...chartOpts });
  }

  if (categoryBreakdown.length > 0) {
    renderPdfHorizontalBarChart(doc, 'Category emissions (kgCO2e)', categoryBreakdown, {
      labelKey: 'label',
      valueKey: 'value',
      unit: 'kgCO2e',
      ...chartOpts
    });
  }

  if (Array.isArray(sector?.focusCategories) && sector.focusCategories.length > 0) {
    renderPdfHorizontalBarChart(doc, 'Sector carbon focus categories (kgCO2e)', sector.focusCategories, {
      labelKey: 'label',
      valueKey: 'emissionsKgCO2e',
      unit: 'kgCO2e',
      maxItems: 12,
      ...chartOpts
    });
  }

  if (trendPeriods.length >= 2) {
    renderPdfMultiLineChart(doc, 'Historical emissions trend by scope', trendPeriods, [
      { key: 'totalEmissions', label: 'Total', color: '#1565C0' },
      { key: 'scope1', label: 'Scope 1', color: '#C62828' },
      { key: 'scope2', label: 'Scope 2', color: '#F9A825' },
      { key: 'scope3', label: 'Scope 3', color: '#475569' }
    ], { yAxisHint: 'kgCO2e (relative scale)', ...chartOpts });
  }

  if (hotspots.length > 0) {
    renderPdfHorizontalBarChart(doc, 'Emission hotspots (BRSR)', hotspots.slice(0, 10), {
      labelKey: 'hotspot',
      valueKey: 'emissionsKgCO2e',
      unit: 'kgCO2e',
      maxItems: 10,
      ...chartOpts
    });
  }

  if (valueChainStages.length > 0) {
    renderPdfHorizontalBarChart(doc, 'Value chain stage contribution (%)', valueChainStages, {
      labelKey: 'label',
      valueKey: 'contributionPercent',
      unit: '%',
      maxItems: 10,
      ...chartOpts
    });
  }

  if (doc.y + 28 <= doc.page.height - doc.page.margins.bottom) {
    doc.font('Helvetica').fontSize(7).fillColor('#616161').text(
      'Methodology note: values are CO2-equivalent (CO2e), AR5 GWP-100 basis unless your inventory explicitly overrides emission factors.',
      doc.page.margins.left,
      doc.y,
      { width: contentWidth(doc), align: 'center' }
    );
    recordPageContentY(doc, doc.y);
    doc.moveDown(0.4);
  }
};

const renderBrsrSupplementaryVisualizations = (doc, report) => {
  const solar = report?.environmental?.solarPowerGenerationAndUsage || {};
  const carbonSavings = report?.environmental?.carbonSavings || {};
  const carbonCredits = report?.environmental?.carbonCredits || {};
  const detail = report?.environmental?.carbonEmissionDetails || {};
  const directIndirect = detail?.directVsIndirect || {};
  const workflow = detail?.manufacturingWorkflow || {};

  let openedSection = false;
  const ensureSection = () => {
    if (!openedSection) {
      writeHeading(doc, 'Operational programme visualisations');
      openedSection = true;
    }
  };

  const solarBars = [
    { label: 'Generation', value: safeNumber(solar?.generationKwh) },
    { label: 'Usage', value: safeNumber(solar?.usageKwh) }
  ];
  const chartOpts = { subheading: true };
  if (solarBars.some((b) => b.value > 0)) {
    ensureSection();
    renderPdfVerticalBarChart(doc, 'Solar generation vs usage (kWh)', solarBars, { unit: 'kWh', ...chartOpts });
  }

  const savingsBars = [
    { label: 'Baseline', value: safeNumber(carbonSavings?.baselineEmissionsKgCO2e) },
    { label: 'Current', value: safeNumber(carbonSavings?.currentEmissionsKgCO2e) },
    { label: 'Net savings', value: safeNumber(carbonSavings?.netSavingsKgCO2e) }
  ];
  if (savingsBars.some((b) => b.value > 0)) {
    ensureSection();
    renderPdfVerticalBarChart(doc, 'Carbon savings trajectory (kgCO2e)', savingsBars, { unit: 'kgCO2e', ...chartOpts });
  }

  const creditRows = [
    { label: 'Earned', value: safeNumber(carbonCredits?.earnedCredits) },
    { label: 'Available', value: safeNumber(carbonCredits?.availableCredits) },
    { label: 'Used', value: safeNumber(carbonCredits?.usedCredits) },
    { label: 'Retired', value: safeNumber(carbonCredits?.retiredCredits) }
  ];
  if (creditRows.some((r) => r.value > 0)) {
    ensureSection();
    renderPdfHorizontalBarChart(doc, 'Carbon credit balances', creditRows, {
      labelKey: 'label',
      valueKey: 'value',
      unit: 'credits',
      ...chartOpts
    });
  }

  const directRows = [
    { label: 'Direct emissions', value: safeNumber(directIndirect.directEmissions) },
    { label: 'Indirect emissions', value: safeNumber(directIndirect.indirectEmissions) }
  ];
  if (directRows.some((r) => r.value > 0)) {
    ensureSection();
    renderPdfHorizontalBarChart(doc, 'Direct vs indirect emissions (kgCO2e)', directRows, {
      labelKey: 'label',
      valueKey: 'value',
      unit: 'kgCO2e',
      ...chartOpts
    });
  }

  const wfRows = workflow?.isAvailable
    ? [
      { label: 'Machinery', value: safeNumber(workflow.machineryEmissions) },
      { label: 'Raw materials', value: safeNumber(workflow.rawMaterialEmissions) },
      { label: 'Packaging', value: safeNumber(workflow.packagingMaterialEmissions) },
      { label: 'Commuting (S3)', value: safeNumber(workflow.scope3Commuting) }
    ].filter((r) => r.value > 0)
    : [];
  if (wfRows.length > 0) {
    ensureSection();
    renderPdfHorizontalBarChart(doc, 'Manufacturing workflow emissions (kgCO2e)', wfRows, {
      labelKey: 'label',
      valueKey: 'value',
      unit: 'kgCO2e',
      ...chartOpts
    });
  }
};

const renderCbamCarbonAnalyticsCharts = (doc, report) => {
  const trend = Array.isArray(report?.emissionsTrend) ? report.emissionsTrend : [];
  const goods = Array.isArray(report?.goods) ? report.goods : [];
  const overview = report?.overview || {};
  const overviewBars = [
    { label: 'Total emb.', value: safeNumber(overview.totalEmbeddedEmissions) },
    { label: 'Direct', value: safeNumber(overview.totalDirectEmbeddedEmissions) },
    { label: 'Indirect', value: safeNumber(overview.totalIndirectEmbeddedEmissions) }
  ];
  const hasOverviewBars = overviewBars.some((b) => b.value > 0);
  if (trend.length < 2 && goods.length === 0 && !hasOverviewBars) {
    return;
  }

  writeHeading(doc, 'Carbon emissions analytics', { align: 'center' });
  const chartOpts = { subheading: true };
  if (hasOverviewBars) {
    renderPdfVerticalBarChart(doc, 'Embedded emissions snapshot (tCO2e)', overviewBars, { unit: 'tCO2e', ...chartOpts });
  }
  if (trend.length >= 2) {
    renderPdfMultiLineChart(doc, 'Quarterly embedded emissions trend', trend, [
      { key: 'embeddedEmissions', label: 'Embedded', color: '#1565C0' },
      { key: 'directEmbeddedEmissions', label: 'Direct', color: '#C62828' },
      { key: 'indirectEmbeddedEmissions', label: 'Indirect', color: '#2E7D32' }
    ], { yAxisHint: 'tCO2e (relative scale)', ...chartOpts });
  }

  if (goods.length > 0) {
    const rows = [...goods]
      .sort((a, b) => safeNumber(b.embeddedEmissions) - safeNumber(a.embeddedEmissions))
      .slice(0, 12)
      .map((g) => ({
        label: truncateChartLabel(`${toText(g.name)} (${toText(g.hsCode)})`, 40),
        value: safeNumber(g.embeddedEmissions)
      }));
    renderPdfHorizontalBarChart(doc, 'Embedded emissions by covered good', rows, {
      labelKey: 'label',
      valueKey: 'value',
      unit: 'tCO2e',
      ...chartOpts
    });
  }
};

const renderCbamSupplementaryVisualizations = (doc, report) => {
  const trend = Array.isArray(report?.emissionsTrend) ? report.emissionsTrend : [];
  const exportRows = trend
    .filter((t) => safeNumber(t.exportVolume) > 0)
    .slice(0, 12)
    .map((t) => ({
      label: truncateChartLabel(toText(t.period), 14),
      value: safeNumber(t.exportVolume)
    }));
  if (exportRows.length === 0) {
    return;
  }
  writeHeading(doc, 'Trade volume visualisations');
  renderPdfHorizontalBarChart(doc, 'Export volumes by reporting period (tonnes)', exportRows, {
    labelKey: 'label',
    valueKey: 'value',
    unit: 't',
    subheading: true
  });
};

const renderIsoCarbonVisualizationPdf = (doc, visualization, kind) => {
  if (!visualization || typeof visualization !== 'object') {
    return;
  }

  const show14064 = kind === 'iso14064' && (
    (Array.isArray(visualization.scopeContribution) && visualization.scopeContribution.length > 0)
    || (Array.isArray(visualization.qualityBreakdown) && visualization.qualityBreakdown.length > 0)
    || (Array.isArray(visualization.emissionsTrend) && visualization.emissionsTrend.length >= 2)
    || (Array.isArray(visualization.governanceCoverage) && visualization.governanceCoverage.length > 0)
  );
  const show14067 = kind === 'iso14067' && (
    (Array.isArray(visualization.lifecycleStageContribution) && visualization.lifecycleStageContribution.length > 0)
    || (Array.isArray(visualization.productComparison) && visualization.productComparison.length > 0)
    || (Array.isArray(visualization.uncertaintyBand) && visualization.uncertaintyBand.length >= 2)
  );
  if (!show14064 && !show14067) {
    return;
  }

  writeHeading(doc, 'Carbon emissions analytics', { align: 'center' });
  const chartOpts = { subheading: true };

  if (kind === 'iso14064') {
    if (Array.isArray(visualization.scopeContribution) && visualization.scopeContribution.length > 0) {
      renderPdfHorizontalBarChart(doc, 'Scope contribution (tCO2e)', visualization.scopeContribution, {
        labelKey: 'scope',
        valueKey: 'emissions',
        unit: 'tCO2e',
        ...chartOpts
      });
    }
    if (Array.isArray(visualization.qualityBreakdown) && visualization.qualityBreakdown.length > 0) {
      renderPdfHorizontalBarChart(doc, 'Inventory data quality scores', visualization.qualityBreakdown, {
        labelKey: 'metric',
        valueKey: 'value',
        unit: '%',
        ...chartOpts
      });
    }
    if (Array.isArray(visualization.emissionsTrend) && visualization.emissionsTrend.length >= 2) {
      renderPdfMultiLineChart(doc, 'Emissions trend by scope', visualization.emissionsTrend, [
        { key: 'total', label: 'Total', color: '#1565C0' },
        { key: 'scope1', label: 'Scope 1', color: '#C62828' },
        { key: 'scope2', label: 'Scope 2', color: '#F9A825' },
        { key: 'scope3', label: 'Scope 3', color: '#2E7D32' }
      ], { yAxisHint: 'tCO2e (relative scale)', ...chartOpts });
    }
    if (Array.isArray(visualization.governanceCoverage) && visualization.governanceCoverage.length > 0) {
      renderPdfHorizontalBarChart(doc, 'Governance control coverage', visualization.governanceCoverage.slice(0, 12), {
        labelKey: 'control',
        valueKey: 'score',
        unit: '%',
        ...chartOpts
      });
    }
    return;
  }

  if (kind === 'iso14067') {
    const lifecycleRows = (Array.isArray(visualization.lifecycleStageContribution)
      ? visualization.lifecycleStageContribution
      : []).filter((r) => safeNumber(r.emissions) > 0);
    if (lifecycleRows.length > 0) {
      renderPdfHorizontalBarChart(doc, 'Lifecycle stage contribution (tCO2e)', lifecycleRows, {
        labelKey: 'label',
        valueKey: 'emissions',
        unit: 'tCO2e',
        ...chartOpts
      });
    }
    if (Array.isArray(visualization.productComparison) && visualization.productComparison.length > 0) {
      const products = [...visualization.productComparison]
        .filter((p) => safeNumber(p.totalFootprint) > 0)
        .sort((a, b) => safeNumber(b.totalFootprint) - safeNumber(a.totalFootprint))
        .slice(0, 10)
        .map((p) => ({
          label: truncateChartLabel(p.productName, 36),
          value: safeNumber(p.totalFootprint)
        }));
      renderPdfHorizontalBarChart(doc, 'Product footprint comparison (tCO2e)', products, {
        labelKey: 'label',
        valueKey: 'value',
        unit: 'tCO2e',
        ...chartOpts
      });
    }
    if (Array.isArray(visualization.uncertaintyBand) && visualization.uncertaintyBand.length >= 2) {
      renderPdfMultiLineChart(doc, 'Uncertainty band profile', visualization.uncertaintyBand, [
        { key: 'value', label: 'tCO2e', color: '#C62828' }
      ], { yAxisHint: 'tCO2e (relative scale)', ...chartOpts });
    }
  }
};

const renderCompanyAndOperationsIntro = (doc, companyProfile = {}, operationsProfile = {}) => {
  writeHeading(doc, 'Company Profile');
  writeLabelValue(doc, 'Company', companyProfile.companyName);
  writeLabelValue(doc, 'Industry', companyProfile.industry);
  writeLabelValue(doc, 'Business Domain', companyProfile.businessDomain);
  writeLabelValue(doc, 'Company Type', companyProfile.companyType);
  writeLabelValue(
    doc,
    'Location',
    `${toText(companyProfile?.location?.city)}, ${toText(companyProfile?.location?.state)}, ${toText(companyProfile?.location?.country)}`
  );

  doc.moveDown(0.3);
  writeHeading(doc, 'Operations Profile');
  writeLabelValue(doc, 'Annual Turnover (INR)', operationsProfile.annualTurnoverINR);
  writeLabelValue(doc, 'Employees', operationsProfile.employeeCount);
  writeLabelValue(doc, 'Manufacturing Units', operationsProfile.manufacturingUnits);
  writeLabelValue(doc, 'Primary Products', operationsProfile.primaryProducts);
  writeLabelValue(doc, 'Primary Energy Source', operationsProfile.primaryEnergySource);
  writeLabelValue(doc, 'Waste Management', operationsProfile.wasteManagementPractice);
};

const SOFTWARE_NAME = 'Sustainow Carbon Intelligence Solution';
const LOGO_PATH = path.resolve(__dirname, '../../../public/sustainow-ci-logo.png');

const renderSystemGeneratedCallout = (doc) => {
  ensureSpace(doc, 36);
  const left = doc.page.margins.left;
  const w = doc.page.width - left - doc.page.margins.right;
  const top = doc.y;
  doc.save();
  doc.lineWidth(0.45).fillColor('#E3F2FD').strokeColor('#90CAF9');
  doc.roundedRect(left, top, w, 28, 3).fillAndStroke();
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#0D47A1')
    .text('System-generated report', left + 8, top + 5, { width: w - 16 });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#37474F')
    .text(
      'This PDF was produced automatically from workspace data. Validate all figures against primary evidence before assurance, customs, or regulatory use.',
      left + 8,
      top + 16,
      { width: w - 16, lineGap: 1 }
    );
  doc.x = left;
  doc.y = top + 32;
};

const renderSoftwareHeader = (doc, reportTitle) => {
  const baselineVersion = getBaselineCodebaseVersion();
  const apiVersion = getApiVersion();

  const headerTop = doc.page.margins.top - 8;
  const headerBottom = headerTop + 42;
  doc
    .save()
    .fillColor('#E8F5E9')
    .rect(doc.page.margins.left, headerTop, doc.page.width - doc.page.margins.left - doc.page.margins.right, 42)
    .fill()
    .restore();

  const headerWidth = contentWidth(doc);
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, doc.page.margins.left + 8, headerTop + 6, {
        fit: [32, 30],
        align: 'center',
        valign: 'center'
      });
    } catch (_error) {
      // Skip logo rendering if runtime parser fails.
    }
  }

  const textStartX = doc.page.margins.left + 48;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#1B5E20')
    .text(SOFTWARE_NAME, textStartX, headerTop + 7, { width: headerWidth - 48, align: 'left' });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#2E7D32')
    .text(`Version: ${baselineVersion} | API: ${apiVersion}`, textStartX, headerTop + 21, { width: headerWidth - 48, align: 'left' });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#0D47A1')
    .text(reportTitle, doc.page.margins.left, headerTop + 28, {
      width: headerWidth,
      align: 'center'
    });

  doc.moveTo(doc.page.margins.left, headerBottom).lineTo(doc.page.width - doc.page.margins.right, headerBottom).stroke('#C8E6C9');
  resetContentCursor(doc);
  doc.y = headerBottom + 10;
};

const renderBRSRReport = (doc, report, options = {}) => {
  renderSoftwareHeader(doc, 'BRSR Carbon Emissions Report');
  renderSystemGeneratedCallout(doc);
  const ghg = report?.environmental?.greenhouseGasEmissions || {};
  const detail = report?.environmental?.carbonEmissionDetails || {};
  const solar = report?.environmental?.solarPowerGenerationAndUsage || {};
  const solarReduction = solar?.emissionReductionPotential || {};
  const solarCredits = solar?.carbonCreditBenefits || {};
  const directIndirect = detail?.directVsIndirect || {};
  const categoryBreakdown = Array.isArray(detail?.categoryBreakdown) ? detail.categoryBreakdown : [];
  const topDrivers = Array.isArray(detail?.topEmissionDrivers) ? detail.topEmissionDrivers : [];
  const trendPeriods = Array.isArray(detail?.assessmentTrend?.periods) ? detail.assessmentTrend.periods : [];
  const workflow = detail?.manufacturingWorkflow || {};
  const compliance = report?.compliance || {};
  const profile = report?.msmeProfileDetailed || {};
  const carbonSavings = report?.environmental?.carbonSavings || {};
  const carbonCredits = report?.environmental?.carbonCredits || {};
  const assurance = report?.assuranceAndCompliance || {};
  const registrations = report?.organization?.registrations || {};
  const billAnnexure = report?.annexure?.billsAttachedForReference || {};
  const annexureBills = Array.isArray(billAnnexure?.bills) ? billAnnexure.bills : [];
  const companyProfile = report?.companyProfile || {};
  const operationsProfile = report?.operationsProfile || {};
  const brsrComplianceSummary = report?.brsrComplianceSummary || {};
  const sectorCarbonAnalytics = report?.sectorCarbonAnalytics || {};
  const hotspotMitigationPlan = report?.environmental?.hotspotMitigationPlan || {};
  const valueChain = report?.valueChain || {};
  const methodologyAndAssumptions = report?.methodologyAndAssumptions || {};
  const sectionC = report?.sectionC || {};
  const reportId = options.reportId || `BRSR-${Date.now()}`;

  resetContentCursor(doc);
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor('#0D47A1')
    .text('BRSR Carbon Emissions Report', doc.page.margins.left, doc.y, {
      width: contentWidth(doc),
      align: 'center'
    });
  recordPageContentY(doc, doc.y);

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#333333');
  writeLabelValue(doc, 'Report ID', reportId);
  writeLabelValue(doc, 'Generated At', toText(report?.generatedAt));
  writeLabelValue(
    doc,
    'Reporting Period',
    `${toText(report?.reportingPeriod?.financialYear)} (${toText(report?.reportingPeriod?.requestedPeriod)})`
  );
  doc.moveDown(0.4);

  const orgName = toText(report?.organization?.companyName, 'The organisation');
  const fyLabel = toText(report?.reportingPeriod?.financialYear, 'the selected financial year');
  const totalGhg = safeNumber(ghg.total);
  const completeness = safeNumber(compliance?.completenessScore);

  writeHeading(doc, 'Executive summary');
  writeBodyParagraph(
    doc,
    `${orgName} consolidates Scope 1–3 emissions of ${totalGhg.toFixed(2)} kgCO2e for ${fyLabel}, aligned to the GHG Protocol Corporate Standard and the BRSR-aligned template encoded in the workspace. Category drivers, solar performance, workflow proxies, and bill-backed annexures are summarised in the sections that follow.`
  );
  writeBodyParagraph(
    doc,
    `Template completeness is shown at approximately ${completeness.toFixed(0)}% based on mandatory field coverage; this is a system indicator and not a substitute for management review or third-party assurance.`
  );
  writeBodyParagraph(
    doc,
    'Use this export alongside primary records (utility bills, fuel logs, procurement data, and travel surveys) when preparing statutory BRSR disclosures or responding to investor questionnaires.'
  );
  doc.moveDown(0.35);

  writeHeading(doc, 'Report scope, boundaries, and limitations');
  writeBodyParagraph(
    doc,
    'Boundaries include on-site energy, purchased electricity, and modelled Scope 3 categories represented in the workspace dataset at generation time. Emission factors, currency conversions, and allocation rules follow the platform configuration active for this MSME.'
  );
  writeBodyParagraph(
    doc,
    'Figures may omit activities that were not captured digitally, exclude confidential supplier data, or reflect interim OCR quality on uploaded bills. Carbon credit valuations and solar credit eligibility are indicative and depend on registry rules, vintage, and prevailing market prices.'
  );
  doc.moveDown(0.35);

  renderCompanyAndOperationsIntro(doc, companyProfile, operationsProfile);
  doc.moveDown(0.35);

  writeHeading(doc, 'Organization');
  writeLabelValue(doc, 'Company', report?.organization?.companyName);
  writeLabelValue(doc, 'Industry', report?.organization?.industry);
  writeLabelValue(doc, 'Business Domain', report?.organization?.businessDomain);
  writeLabelValue(doc, 'Company Type', report?.organization?.companyType);
  writeLabelValue(doc, 'Udyam Registration', registrations?.udyamRegistrationNumber || 'NA');
  writeLabelValue(doc, 'GST Number', registrations?.gstNumber || 'NA');
  writeLabelValue(doc, 'PAN Number', registrations?.panNumber || 'NA');

  doc.moveDown(0.35);
  writeHeading(doc, 'MSME Profile (Template Details)');
  writeLabelValue(doc, 'Establishment Year', profile?.legalIdentity?.establishmentYear);
  writeLabelValue(doc, 'Primary Products', profile?.businessProfile?.primaryProducts);
  writeLabelValue(doc, 'Annual Turnover (INR)', profile?.businessProfile?.annualTurnoverINR);
  writeLabelValue(doc, 'Employees', profile?.businessProfile?.employeeCount);
  writeLabelValue(doc, 'Manufacturing Units', profile?.businessProfile?.manufacturingUnits);
  writeLabelValue(doc, 'Location', `${toText(profile?.location?.city)}, ${toText(profile?.location?.state)}, ${toText(profile?.location?.country)}`);
  writeLabelValue(doc, 'Industry Sector', profile?.operationalFineDetails?.industrySector);
  writeLabelValue(doc, 'NIC Code', profile?.operationalFineDetails?.nicCode);
  writeLabelValue(doc, 'Primary Energy Source', profile?.operationalFineDetails?.primaryEnergySource);
  writeLabelValue(doc, 'Waste Management Practice', profile?.operationalFineDetails?.wasteManagementPractice);

  doc.moveDown(0.35);
  writeHeading(doc, 'Greenhouse Gas Summary (kgCO2e)');
  writeLabelValue(doc, 'Total Emissions', safeNumber(ghg.total).toFixed(2));
  writeLabelValue(doc, 'Scope 1', safeNumber(ghg.scope1).toFixed(2));
  writeLabelValue(doc, 'Scope 2', safeNumber(ghg.scope2).toFixed(2));
  writeLabelValue(doc, 'Scope 3', safeNumber(ghg.scope3).toFixed(2));
  writeLabelValue(doc, 'Intensity per INR Million Turnover', ghg?.intensity?.perINRMillionTurnover);
  writeLabelValue(doc, 'Intensity per Employee', ghg?.intensity?.perEmployee);
  writeLabelValue(doc, 'Methodology', 'GHG Protocol Corporate Standard');

  doc.moveDown(0.35);
  renderBrsrCarbonAnalyticsCharts(doc, report);

  doc.moveDown(0.35);
  writeHeading(doc, 'Solar Power Generation and Usage (BRSR Highlight)');
  writeLabelValue(doc, 'Installed Capacity (kW)', safeNumber(solar?.installedCapacityKw).toFixed(2));
  writeLabelValue(doc, 'Solar Generation (kWh)', safeNumber(solar?.generationKwh).toFixed(2));
  writeLabelValue(doc, 'Solar Usage (kWh)', safeNumber(solar?.usageKwh).toFixed(2));
  writeLabelValue(doc, 'Estimated Emission Reduction Potential', `${safeNumber(solarReduction?.totalKgCO2e).toFixed(2)} kgCO2e`);
  writeLabelValue(doc, 'Eligible for Carbon Credit Benefits', solarCredits?.eligibleForCarbonCreditBenefits ? 'Yes' : 'No');
  writeLabelValue(doc, 'Estimated Carbon Credits', safeNumber(solarCredits?.estimatedCarbonCredits).toFixed(2));
  if (solar?.brsrHighlight) {
    writeBullet(doc, toText(solar.brsrHighlight));
  }

  doc.moveDown(0.35);
  writeHeading(doc, 'Carbon Savings (kgCO2e)');
  writeLabelValue(doc, 'Baseline Emissions', safeNumber(carbonSavings?.baselineEmissionsKgCO2e).toFixed(2));
  writeLabelValue(doc, 'Current Emissions', safeNumber(carbonSavings?.currentEmissionsKgCO2e).toFixed(2));
  writeLabelValue(doc, 'Trend Reduction', `${safeNumber(carbonSavings?.trendReductionKgCO2e).toFixed(2)} (${safeNumber(carbonSavings?.trendReductionPercent).toFixed(2)}%)`);
  writeLabelValue(doc, 'Realized Recommendation Savings', safeNumber(carbonSavings?.recommendations?.realizedSavingsKgCO2e).toFixed(2));
  writeLabelValue(doc, 'Potential Recommendation Savings', safeNumber(carbonSavings?.recommendations?.potentialSavingsKgCO2e).toFixed(2));
  writeLabelValue(doc, 'Solar Savings', safeNumber(carbonSavings?.renewableAndSolar?.solarSavingsKgCO2e).toFixed(2));
  writeLabelValue(doc, 'Net Savings', safeNumber(carbonSavings?.netSavingsKgCO2e).toFixed(2));
  writeLabelValue(doc, 'Potential Total Savings', safeNumber(carbonSavings?.potentialTotalSavingsKgCO2e).toFixed(2));
  writeLabelValue(doc, 'Equivalent Savings Credits', safeNumber(carbonSavings?.estimatedSavingsCreditEquivalent).toFixed(2));

  doc.moveDown(0.35);
  writeHeading(doc, 'Carbon Credits');
  writeLabelValue(doc, 'Earned Credits', safeNumber(carbonCredits?.earnedCredits).toFixed(2));
  writeLabelValue(doc, 'Available Credits', safeNumber(carbonCredits?.availableCredits).toFixed(2));
  writeLabelValue(doc, 'Used Credits', safeNumber(carbonCredits?.usedCredits).toFixed(2));
  writeLabelValue(doc, 'Retired Credits', safeNumber(carbonCredits?.retiredCredits).toFixed(2));
  writeLabelValue(doc, 'Transferred In', safeNumber(carbonCredits?.transferredInCredits).toFixed(2));
  writeLabelValue(doc, 'Transferred Out', safeNumber(carbonCredits?.transferredOutCredits).toFixed(2));
  writeLabelValue(doc, 'Net Transfers', safeNumber(carbonCredits?.netTransferredCredits).toFixed(2));
  writeLabelValue(doc, 'Estimated Monetary Value (INR)', safeNumber(carbonCredits?.estimatedMonetaryValueINR).toFixed(2));
  writeLabelValue(doc, 'Eligible Credits from Savings', safeNumber(carbonCredits?.estimatedEligibleCreditsFromSavings).toFixed(2));

  doc.moveDown(0.35);
  writeHeading(doc, 'Embedded Carbon Split: Direct vs Indirect');
  writeLabelValue(doc, 'Direct Emissions', `${safeNumber(directIndirect.directEmissions).toFixed(2)} kgCO2e (${safeNumber(directIndirect.directSharePercent).toFixed(2)}%)`);
  writeLabelValue(doc, 'Indirect Emissions', `${safeNumber(directIndirect.indirectEmissions).toFixed(2)} kgCO2e (${safeNumber(directIndirect.indirectSharePercent).toFixed(2)}%)`);

  doc.moveDown(0.35);
  writeHeading(doc, 'Category-wise Carbon Emissions');
  if (categoryBreakdown.length === 0) {
    writeBullet(doc, 'No category-level emissions available.');
  } else {
    categoryBreakdown.forEach((item) => {
      writeBullet(doc, `${toText(item.label)}: ${safeNumber(item.value).toFixed(2)} kgCO2e (${safeNumber(item.sharePercent).toFixed(2)}%)`);
    });
  }

  doc.moveDown(0.35);
  writeHeading(doc, 'Top Emission Drivers');
  if (topDrivers.length === 0) {
    writeBullet(doc, 'No top driver data available.');
  } else {
    topDrivers.forEach((driver) => {
      writeBullet(doc, `${toText(driver.source)} [${toText(driver.sourceType)}]: ${safeNumber(driver.emissions).toFixed(2)} kgCO2e`);
    });
  }

  doc.moveDown(0.35);
  writeHeading(doc, 'Period-wise Emissions Trend');
  if (trendPeriods.length === 0) {
    writeBullet(doc, 'No historical trend data available.');
  } else {
    trendPeriods.forEach((period) => {
      writeBullet(
        doc,
        `${toText(period.period)} | Total: ${safeNumber(period.totalEmissions).toFixed(2)} | S1: ${safeNumber(period.scope1).toFixed(2)} | S2: ${safeNumber(period.scope2).toFixed(2)} | S3: ${safeNumber(period.scope3).toFixed(2)}`
      );
    });
  }

  doc.moveDown(0.35);
  writeHeading(doc, 'Manufacturing Workflow Emission Details');
  writeLabelValue(doc, 'Workflow Data Available', workflow?.isAvailable ? 'Yes' : 'No');
  writeLabelValue(doc, 'Units Tracked', workflow?.unitsTracked);
  writeLabelValue(doc, 'Employees Tracked', workflow?.employeesTracked);
  writeLabelValue(doc, 'Machinery Emissions', safeNumber(workflow?.machineryEmissions).toFixed(2));
  writeLabelValue(doc, 'Raw Material Emissions', safeNumber(workflow?.rawMaterialEmissions).toFixed(2));
  writeLabelValue(doc, 'Packaging Emissions', safeNumber(workflow?.packagingMaterialEmissions).toFixed(2));
  writeLabelValue(doc, 'Scope 3 Commuting Emissions', safeNumber(workflow?.scope3Commuting).toFixed(2));
  writeLabelValue(doc, 'Workflow Total', safeNumber(workflow?.workflowTotal).toFixed(2));
  writeLabelValue(doc, 'Workflow Contribution to BRSR Total', `${safeNumber(workflow?.contributionToBRSRTotal).toFixed(2)}%`);

  doc.moveDown(0.35);
  renderBrsrSupplementaryVisualizations(doc, report);

  doc.moveDown(0.35);
  writeHeading(doc, 'BRSR Disclosure Readiness');
  writeLabelValue(doc, 'Completeness Score', `${safeNumber(compliance?.completenessScore).toFixed(1)}%`);
  writeLabelValue(
    doc,
    'Readiness Score',
    `${safeNumber(brsrComplianceSummary?.disclosureReadinessPercent, compliance?.completenessScore).toFixed(1)}%`
  );
  const disclosurePrepReady = Boolean(
    compliance?.disclosurePrepReady ?? compliance?.isBRSRCompliant
  );
  writeLabelValue(doc, 'Disclosure prep ready (≥75%)', disclosurePrepReady ? 'Yes' : 'No');
  writeLabelValue(doc, 'Report scope', report?.reportScope || brsrComplianceSummary?.reportScope || 'BRSR Principle 6 Environmental Pack');
  writeLabelValue(doc, 'Readiness level', report?.reportReadiness?.reportReadinessLabel || 'Prep draft');
  if (report?.scope3Quality?.warnings?.length) {
    writeLabelValue(doc, 'Scope 3 quality', report.scope3Quality.assuranceGradeReady ? 'Assurance-grade' : 'Review required');
    report.scope3Quality.warnings.forEach((warning) => writeBullet(doc, warning));
  }
  writeLabelValue(doc, 'Environmental Compliance Score', `${safeNumber(compliance?.environmentalComplianceScore).toFixed(1)}%`);

  doc.moveDown(0.35);
  writeHeading(doc, 'Assurance and Governance');
  writeLabelValue(doc, 'Overall Status', assurance?.overallStatus);
  writeLabelValue(doc, 'Assurance Level', assurance?.assurance?.level);
  writeLabelValue(doc, 'Assessment Status', assurance?.assurance?.assessmentStatus);
  writeLabelValue(doc, 'Framework', assurance?.reportingTemplate?.framework);
  writeLabelValue(doc, 'Regulator', assurance?.reportingTemplate?.regulator);

  const mandatoryFields = compliance?.mandatoryFields || {};
  Object.keys(mandatoryFields).forEach((fieldKey) => {
    writeBullet(doc, `${toText(fieldKey)}: ${mandatoryFields[fieldKey] ? 'Provided' : 'Missing'}`);
  });

  doc.moveDown(0.35);
  writeHeading(doc, 'Annexure - Bills Attached for Reference');
  writeLabelValue(doc, 'Total Bills Attached', billAnnexure?.totalBillsAttached || 0);
  writeLabelValue(
    doc,
    'Total Bill Amount (INR)',
    safeNumber(billAnnexure?.totalBillAmountINR).toFixed(2)
  );

  if (annexureBills.length === 0) {
    writeBullet(doc, 'No bill attachments available for this reporting period.');
  } else {
    annexureBills.forEach((bill) => {
      writeBullet(
        doc,
        `#${toText(bill?.serialNumber)} ${toText(bill?.fileName)} | Type: ${toText(bill?.documentType)} | Status: ${toText(bill?.status)} | Uploaded: ${toText(bill?.uploadedAt)} | Amount: INR ${safeNumber(bill?.amountINR).toFixed(2)}`
      );
    });
  }

};

const renderGenericReport = (doc, payload = {}) => {
  renderSoftwareHeader(doc, toText(payload.title, 'Sustainability Report'));
  renderSystemGeneratedCallout(doc);
  resetContentCursor(doc);
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor('#0D47A1')
    .text(toText(payload.title, 'Sustainability Report'), doc.page.margins.left, doc.y, {
      width: contentWidth(doc),
      align: 'center'
    });
  recordPageContentY(doc, doc.y);

  writeLabelValue(doc, 'Generated At', new Date().toISOString());
  doc.moveDown(0.5);

  if (payload.companyProfile || payload.operationsProfile) {
    renderCompanyAndOperationsIntro(doc, payload.companyProfile || {}, payload.operationsProfile || {});
    doc.moveDown(0.3);
  }

  if (payload.summary && typeof payload.summary === 'object') {
    writeHeading(doc, 'Summary');
    Object.entries(payload.summary).forEach(([key, value]) => {
      writeLabelValue(doc, toText(key), value);
    });
  }

  if (Array.isArray(payload.sections) && payload.sections.length > 0) {
    doc.moveDown(0.3);
    writeHeading(doc, 'Sections');
    payload.sections.forEach((section) => writeBullet(doc, toText(section)));
  }

  if (Array.isArray(payload.sectionDetails) && payload.sectionDetails.length > 0) {
    payload.sectionDetails.forEach((section) => {
      doc.moveDown(0.3);
      writeHeading(doc, toText(section?.title, 'Section'));
      const content = section?.content;
      if (Array.isArray(content)) {
        content.forEach((line) => writeBullet(doc, toText(line)));
      } else if (content) {
        writeBodyParagraph(doc, toText(content));
      }
    });
  }

  if (Array.isArray(payload.recommendationsList) && payload.recommendationsList.length > 0) {
    doc.moveDown(0.3);
    writeHeading(doc, 'Recommendations');
    payload.recommendationsList.forEach((rec) => {
      writeBullet(doc, `${toText(rec?.title, 'Recommendation')} (${toText(rec?.status, 'pending')})`);
    });
  }

  if (payload.emissionsAndCompliance && typeof payload.emissionsAndCompliance === 'object') {
    doc.moveDown(0.3);
    writeHeading(doc, 'GHG and Compliance Snapshot');
    Object.entries(payload.emissionsAndCompliance).forEach(([key, value]) => {
      writeLabelValue(doc, toText(key), value);
    });
    const snapRows = Object.entries(payload.emissionsAndCompliance)
      .map(([key, value]) => {
        const n = Number(value);
        return {
          label: truncateChartLabel(String(key).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim(), 40),
          value: Number.isFinite(n) ? n : NaN
        };
      })
      .filter((r) => Number.isFinite(r.value));
    if (snapRows.length >= 2) {
      doc.moveDown(0.25);
      renderPdfHorizontalBarChart(doc, 'GHG and compliance snapshot (numeric)', snapRows, {
        labelKey: 'label',
        valueKey: 'value',
        maxItems: 12,
        subheading: true
      });
    }
  }

  if (payload.carbonVisualization && payload.carbonVisualizationKind) {
    doc.moveDown(0.3);
    renderIsoCarbonVisualizationPdf(doc, payload.carbonVisualization, payload.carbonVisualizationKind);
  }

  doc.moveDown(0.3);
  writeHeading(doc, 'Report scope and system interpretation');
  writeBodyParagraph(
    doc,
    'This export summarises model outputs, system-generated narratives, and tabular metrics present in the workspace at generation time. It is system-generated and should be reviewed by a qualified practitioner before contractual, customs, or certification use.'
  );
  writeBodyParagraph(
    doc,
    'Where charts appear, scales are chosen for legibility within the PDF and may compress wide numerical ranges; refer to the tabular sections for exact values.'
  );

  if (payload.notes) {
    doc.moveDown(0.3);
    writeHeading(doc, 'Notes');
    writeBullet(doc, toText(payload.notes));
  }
};

const renderCbamReport = (doc, report, options = {}) => {
  renderSoftwareHeader(doc, 'CBAM Quarterly Compliance Report');
  renderSystemGeneratedCallout(doc);
  const reportId = options.reportId || `CBAM-${Date.now()}`;
  const overview = report?.overview || {};
  const goods = Array.isArray(report?.goods) ? report.goods : [];
  const trend = Array.isArray(report?.emissionsTrend) ? report.emissionsTrend : [];
  const documentation = Array.isArray(report?.documentation) ? report.documentation : [];
  const recommendations = Array.isArray(report?.recommendations) ? report.recommendations : [];
  const profile = report?.msmeProfile || {};
  const companyProfile = report?.companyProfile || {};
  const operationsProfile = report?.operationsProfile || {};
  resetContentCursor(doc);
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor('#0D47A1')
    .text('CBAM Quarterly Compliance Report', doc.page.margins.left, doc.y, {
      width: contentWidth(doc),
      align: 'center'
    });
  recordPageContentY(doc, doc.y);

  writeLabelValue(doc, 'Report ID', reportId);
  writeLabelValue(doc, 'Generated At', new Date().toISOString());
  writeLabelValue(doc, 'Reporting Frequency', toText(overview.reportingFrequency, 'Quarterly'));
  writeLabelValue(
    doc,
    'Reporting Quarter',
    toText(overview.reportingQuarter || overview.reportingPeriod)
  );
  doc.moveDown(0.4);

  const cbamCompany = toText(profile.companyName || companyProfile.companyName, 'The exporter');
  const quarterLabel = toText(overview.reportingQuarter || overview.reportingPeriod, 'the selected quarter');
  const embedded = safeNumber(overview.totalEmbeddedEmissions);
  const readiness = safeNumber(overview.readinessScore);

  writeHeading(doc, 'Executive summary');
  writeBodyParagraph(
    doc,
    `${cbamCompany} is positioned for CBAM monitoring for ${quarterLabel}. Embedded emissions attributed to covered goods total approximately ${embedded.toFixed(2)} tCO2e in this workspace snapshot, with direct and indirect contributions detailed under goods-level tables and trend charts.`
  );
  writeBodyParagraph(
    doc,
    `Readiness is indicated at ${readiness.toFixed(0)}% against the embedded checklist model; this is an automated signal and must be validated against customs instructions, verifier expectations, and importer evidence requests.`
  );
  writeBodyParagraph(
    doc,
    'Use this PDF together with default values, actual emissions data, and CBAM Transitional Registry submissions as applicable. Liability estimates in EUR are indicative only.'
  );
  doc.moveDown(0.35);

  writeHeading(doc, 'Report scope and limitations');
  writeBodyParagraph(
    doc,
    'Figures reflect goods mapped in the catalogue, export volumes captured digitally, and emissions factors configured for the MSME. Unmapped products, subcontracted processing, or post-border logistics may require manual adjustment.'
  );
  doc.moveDown(0.35);

  renderCompanyAndOperationsIntro(doc, companyProfile, operationsProfile);
  doc.moveDown(0.35);

  writeHeading(doc, 'MSME Profile');
  writeLabelValue(doc, 'Company', profile.companyName);
  writeLabelValue(doc, 'Industry', profile.industry);
  writeLabelValue(doc, 'Business Domain', profile.businessDomain);
  writeLabelValue(doc, 'Company Type', profile.companyType);

  doc.moveDown(0.35);
  writeHeading(doc, 'CBAM Compliance Snapshot');
  writeLabelValue(doc, 'Compliance Status', overview.complianceStatus);
  writeLabelValue(doc, 'Exposure Level', overview.exposureLevel);
  writeLabelValue(doc, 'Readiness Score', `${safeNumber(overview.readinessScore).toFixed(1)}%`);
  writeLabelValue(doc, 'Covered Goods', safeNumber(overview.coveredGoodsCount, 0));
  writeLabelValue(doc, 'Total Embedded Emissions', `${safeNumber(overview.totalEmbeddedEmissions).toFixed(2)} tCO2e`);
  writeLabelValue(doc, 'Direct Embedded Emissions', `${safeNumber(overview.totalDirectEmbeddedEmissions).toFixed(2)} tCO2e`);
  writeLabelValue(doc, 'Indirect Embedded Emissions', `${safeNumber(overview.totalIndirectEmbeddedEmissions).toFixed(2)} tCO2e`);
  writeLabelValue(doc, 'Estimated Liability (EUR)', safeNumber(overview.estimatedLiabilityEUR).toFixed(0));
  writeLabelValue(doc, 'Next Deadline', overview.nextDeadline);
  writeLabelValue(doc, 'Last Submitted', overview.lastSubmitted || 'Not submitted');

  doc.moveDown(0.35);
  writeHeading(doc, 'Covered Goods Emissions');
  if (goods.length === 0) {
    writeBullet(doc, 'No CBAM covered goods identified for this period.');
  } else {
    goods.forEach((good) => {
      ensureSpace(doc, 42);
      const left = doc.page.margins.left;
      const width = contentWidth(doc);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#111111')
        .text(`${toText(good.name)} (${toText(good.hsCode)})`, left, doc.y, { width, align: 'left' });
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(
          `Export: ${safeNumber(good.exportVolumeTonnes).toFixed(2)} t | Embedded: ${safeNumber(good.embeddedEmissions).toFixed(2)} tCO2e | Direct: ${safeNumber(good.directEmbeddedEmissions).toFixed(2)} | Indirect: ${safeNumber(good.indirectEmbeddedEmissions).toFixed(2)} | Liability: EUR ${safeNumber(good.estimatedLiabilityEUR).toFixed(0)}`,
          left,
          doc.y,
          { width, align: 'left' }
        );
      doc.text(`Status: ${toText(good.reportingStatus)} | Data Quality: ${toText(good.dataQuality)}`, left, doc.y, {
        width,
        align: 'left'
      });
    });
  }

  doc.moveDown(0.35);
  writeHeading(doc, 'Quarterly Trend');
  if (trend.length === 0) {
    writeBullet(doc, 'No quarterly trend data available.');
  } else {
    trend.forEach((row) => {
      writeBullet(
        doc,
        `${toText(row.period)} | Embedded: ${safeNumber(row.embeddedEmissions).toFixed(2)} tCO2e | Direct: ${safeNumber(row.directEmbeddedEmissions).toFixed(2)} | Indirect: ${safeNumber(row.indirectEmbeddedEmissions).toFixed(2)} | Export: ${safeNumber(row.exportVolume).toFixed(2)} t`
      );
    });
  }

  doc.moveDown(0.35);
  renderCbamCarbonAnalyticsCharts(doc, report);
  renderCbamSupplementaryVisualizations(doc, report);

  doc.moveDown(0.35);
  writeHeading(doc, 'Documentation Checklist');
  if (documentation.length === 0) {
    writeBullet(doc, 'No documentation checklist items available.');
  } else {
    documentation.forEach((item) => {
      writeBullet(doc, `${toText(item.title)} | Owner: ${toText(item.owner)} | Status: ${toText(item.status)}`);
    });
  }

  doc.moveDown(0.35);
  writeHeading(doc, 'Recommended Actions');
  if (recommendations.length === 0) {
    writeBullet(doc, 'No recommendations available.');
  } else {
    recommendations.forEach((recommendation) => {
      writeBullet(doc, toText(recommendation));
    });
  }

  if (overview.methodology) {
    doc.moveDown(0.35);
    writeHeading(doc, 'Methodology');
    writeBullet(doc, toText(overview.methodology));
  }
};

const generateBRSRReportPdf = async (report, options = {}) => {
  return createPdfBuffer((doc) => {
    renderBRSRReport(doc, report, options);
  });
};

const generateGenericReportPdf = async (payload = {}) => {
  return createPdfBuffer((doc) => {
    renderGenericReport(doc, payload);
  });
};

const generateCbamReportPdf = async (report, options = {}) => {
  return createPdfBuffer((doc) => {
    renderCbamReport(doc, report, options);
  });
};

module.exports = {
  generateBRSRReportPdf,
  generateGenericReportPdf,
  generateCbamReportPdf
};
