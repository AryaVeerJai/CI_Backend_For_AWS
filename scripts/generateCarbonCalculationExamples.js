#!/usr/bin/env node
/**
 * Reads Testing/MSME_Tally_Sample_Transactions_10_Sectors.xlsx and writes
 * docs/root/carbon-calculation-examples.json with Sustainow platform metrics.
 *
 * The workbook is maintained separately (user-uploaded sample with 10 sector sheets).
 * This script samples one transaction per voucher type per sector for documentation.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CarbonCalculationService = require('../src/services/carbonCalculationService');
const { inferCategoryDetails } = require('../src/services/connectors/accountingRecordNormalizer');

const ROOT = path.resolve(__dirname, '../..');
const EXCEL_IN = path.join(ROOT, 'Testing/MSME_Tally_Sample_Transactions_10_Sectors.xlsx');
const JSON_OUT = path.join(ROOT, 'docs/root/carbon-calculation-examples.json');

const VOUCHER_TYPES = ['Purchase', 'Receipt', 'Payment', 'Journal', 'Sales'];

const SIMPLE_VOUCHER_FACTORS = {
  Purchase: { factor: 0.8, scope: 'Scope 3 - Purchased Goods' },
  Receipt: { factor: 0.45, scope: 'Scope 2 - Electricity' },
  Payment: { factor: 2.68, scope: 'Scope 1 - Fuel' },
  Journal: { factor: 0.25, scope: 'Scope 3 - Purchased Goods' },
  Sales: { factor: 0.15, scope: 'Scope 3 - Downstream' }
};

const SECTOR_META = {
  Steel_Fabrication: { sector: 'Steel Fabrication', industry: 'manufacturing', businessDomain: 'manufacturing', state: 'Karnataka' },
  Electronics_Mfg: { sector: 'Electronics Manufacturing', industry: 'electronics', businessDomain: 'electronics', state: 'Karnataka' },
  Toys_Mfg: { sector: 'Toys Manufacturing', industry: 'manufacturing', businessDomain: 'manufacturing', state: 'Maharashtra' },
  Auto_Spares: { sector: 'Auto Spares', industry: 'automotive', businessDomain: 'automotive', state: 'Tamil Nadu' },
  Spices_Mfg: { sector: 'Spices Manufacturing', industry: 'food', businessDomain: 'food_processing', state: 'Gujarat' },
  Textiles: { sector: 'Textiles', industry: 'textiles', businessDomain: 'textiles', state: 'Tamil Nadu' },
  Furniture: { sector: 'Furniture', industry: 'manufacturing', businessDomain: 'handicrafts', state: 'Rajasthan' },
  Pharma: { sector: 'Pharmaceuticals', industry: 'pharmaceuticals', businessDomain: 'manufacturing', state: 'Telangana' },
  Plastic_Products: { sector: 'Plastic Products', industry: 'chemicals', businessDomain: 'manufacturing', state: 'Gujarat' },
  Engineering: { sector: 'Engineering', industry: 'manufacturing', businessDomain: 'manufacturing', state: 'Maharashtra' }
};

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

const ITEM_CATEGORY_HINTS = [
  { category: 'maintenance', subcategory: 'amc_service', keywords: ['fabrication', 'assembly', 'machining job'] },
  { category: 'raw_materials', subcategory: 'metals', keywords: ['steel', 'welding', 'bearing', 'shaft', 'gear', 'casting', 'metal', 'tooling', 'machining'] },
  { category: 'raw_materials', subcategory: 'chemical_inputs', keywords: ['paint', 'solvent', 'api', 'excipient', 'polymer', 'resin', 'colorant', 'dye', 'pigment'] },
  { category: 'raw_materials', subcategory: 'plastic', keywords: ['plastic', 'granules', 'moulding', 'packaging'] },
  { category: 'raw_materials', subcategory: 'textiles_inputs', keywords: ['yarn', 'cotton'], wordMatch: ['fabric'] },
  { category: 'raw_materials', subcategory: 'wood', keywords: ['plywood', 'laminate', 'wood', 'furniture', 'polish'] },
  { category: 'raw_materials', subcategory: 'general', keywords: ['capacitor', 'resistor', 'microcontroller', 'pcb', 'chilli', 'coriander', 'turmeric', 'spice', 'consumable'] },
  { category: 'utilities', subcategory: 'electricity_grid', keywords: ['electricity', 'power'] },
  { category: 'transportation', subcategory: 'fuel_diesel', keywords: ['diesel', 'fuel'] },
  { category: 'waste_management', subcategory: 'hazardous', keywords: ['hazardous', 'waste'] }
];

function classifyRow(row) {
  const item = String(row.Item || '').trim();
  const ledger = String(row.Ledger || '').trim();
  const voucherType = String(row['Voucher Type'] || '').trim();
  const itemLower = item.toLowerCase();

  const hint = ITEM_CATEGORY_HINTS.find((entry) => {
    const keywordHit = (entry.keywords || []).some((keyword) => itemLower.includes(keyword));
    const wordHit = (entry.wordMatch || []).some((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(item));
    return keywordHit || wordHit;
  });
  if (hint) {
    const matched = (hint.keywords || []).find((k) => itemLower.includes(k))
      || (hint.wordMatch || []).find((k) => new RegExp(`\\b${k}\\b`, 'i').test(item));
    return { category: hint.category, subcategory: hint.subcategory, confidence: 0.92, matchedKeywords: [matched], classificationSource: 'item_hint' };
  }

  const details = inferCategoryDetails(item, null, null, ledger);

  if (details.category === 'other') {
    const voucherFallback = {
      Purchase: { category: 'raw_materials', subcategory: 'general' },
      Receipt: { category: 'utilities', subcategory: 'electricity_grid' },
      Payment: { category: 'transportation', subcategory: 'fuel_diesel' },
      Journal: { category: 'maintenance', subcategory: 'amc_service' },
      Sales: { category: 'other', subcategory: 'general' }
    };
    const fallback = voucherFallback[voucherType];
    if (fallback) {
      return { ...fallback, confidence: 0.6, matchedKeywords: [], classificationSource: 'voucher_fallback' };
    }
  }

  return { ...details, classificationSource: 'keyword_match' };
}

function normalizeExcelRow(row, sheetName) {
  const meta = SECTOR_META[sheetName] || {
    sector: sheetName.replace(/_/g, ' '),
    industry: 'manufacturing',
    businessDomain: 'manufacturing',
    state: 'Karnataka'
  };

  const qty = Number(row.Qty) || 0;
  const rate = Number(row.Rate) || 0;
  const amount = Number(row.Amount) || round2(qty * rate);
  const gstPercent = Number(row['GST %']) || 0;
  const gstAmount = Number(row['GST Amount']) || round2(amount * (gstPercent / 100));
  const netAmount = Number(row['Net Amount']) || round2(amount + gstAmount);
  const classification = classifyRow(row);
  const simpleMeta = SIMPLE_VOUCHER_FACTORS[row['Voucher Type']] || { factor: 0.8, scope: 'Scope 3 - Purchased Goods' };

  return {
    date: row.Date,
    voucherNo: row['Voucher No'],
    voucherType: row['Voucher Type'],
    sheetName,
    sector: meta.sector,
    ledger: row.Ledger,
    item: row.Item,
    qty,
    rate,
    amountInr: amount,
    gstPercent,
    gstAmount,
    netAmountInr: netAmount,
    simpleTable: {
      scope: simpleMeta.scope,
      emissionFactor: simpleMeta.factor,
      formula: 'Qty × Simple Voucher-Type Emission Factor',
      estimatedEmissionsKgCo2e: round2(qty * simpleMeta.factor)
    },
    _meta: {
      ...meta,
      category: classification.category,
      subcategory: classification.subcategory,
      classificationConfidence: classification.confidence,
      classificationSource: classification.classificationSource,
      matchedKeywords: classification.matchedKeywords || []
    }
  };
}

function mapToPlatformTransaction(row) {
  const meta = row._meta;
  return {
    amount: row.netAmountInr,
    amountInr: row.amountInr,
    gstAmount: row.gstAmount,
    gstPercent: row.gstPercent,
    netAmountInr: row.netAmountInr,
    category: meta.category,
    subcategory: meta.subcategory,
    description: `${row.item} - ${row.voucherType} - ${row.sector}`,
    industry: meta.industry,
    businessDomain: meta.businessDomain,
    state: meta.state,
    voucherType: row.voucherType,
    sustainability: { isGreen: false, greenScore: 0 }
  };
}

function buildWorkedExample(row, footprint, platformTxn) {
  const baseBeforeMultipliers = footprint.adjustmentCompositeCapped > 0
    ? round2(footprint.co2Emissions / footprint.adjustmentCompositeCapped)
    : footprint.co2Emissions;

  return {
    voucherNo: row.voucherNo,
    date: row.date,
    sheetName: row.sheetName,
    sector: row.sector,
    voucherType: row.voucherType,
    item: row.item,
    ledger: row.ledger,
    qty: row.qty,
    rate: row.rate,
    amountInr: row.amountInr,
    gstPercent: row.gstPercent,
    gstAmount: row.gstAmount,
    netAmountInr: row.netAmountInr,
    classification: {
      category: row._meta.category,
      subcategory: row._meta.subcategory,
      confidence: row._meta.classificationConfidence,
      source: row._meta.classificationSource,
      matchedKeywords: row._meta.matchedKeywords
    },
    simpleTable: row.simpleTable,
    sustainowPlatform: {
      category: row._meta.category,
      subcategory: row._meta.subcategory,
      quantificationMethod: footprint.quantificationMethod,
      dataQualityTier: footprint.dataQualityTier,
      estimatedScope: footprint.metrics?.estimatedScope,
      ghgScope3Category: footprint.ghgScope3Category,
      baseEmissionsKgCo2e: baseBeforeMultipliers,
      finalEmissionsKgCo2e: footprint.co2Emissions,
      reportedEmissionFactorKgCo2ePerInr: footprint.emissionFactor,
      emissionsPerThousandInr: footprint.metrics?.emissionsPerThousandCurrency,
      emissionBreakdown: footprint.emissionBreakdown,
      appliedFactors: footprint.metrics?.appliedFactors,
      fuelContext: footprint.fuelContext || null,
      factorLineage: footprint.factorLineage || null,
      adjustmentCompositeUncapped: footprint.adjustmentCompositeUncapped,
      adjustmentCompositeCapped: footprint.adjustmentCompositeCapped,
      carbonModelVersion: footprint.carbonModelVersion,
      carbonReportingLabel: footprint.carbonReportingLabel
    },
    deltaVsSimpleTable: {
      absoluteKgCo2e: round2(footprint.co2Emissions - row.simpleTable.estimatedEmissionsKgCo2e),
      ratio: row.simpleTable.estimatedEmissionsKgCo2e > 0
        ? round4(footprint.co2Emissions / row.simpleTable.estimatedEmissionsKgCo2e)
        : null
    },
    platformInput: platformTxn
  };
}

function loadSampleRows() {
  if (!fs.existsSync(EXCEL_IN)) {
    throw new Error(`Workbook not found: ${EXCEL_IN}`);
  }

  const workbook = XLSX.readFile(EXCEL_IN);
  const samples = [];

  workbook.SheetNames.forEach((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    VOUCHER_TYPES.forEach((voucherType) => {
      const match = rows.find((row) => row['Voucher Type'] === voucherType);
      if (match) {
        samples.push(normalizeExcelRow(match, sheetName));
      }
    });
  });

  return {
    sheetNames: workbook.SheetNames,
    totalRows: workbook.SheetNames.reduce((sum, name) => {
      return sum + XLSX.utils.sheet_to_json(workbook.Sheets[name]).length;
    }, 0),
    samples
  };
}

function main() {
  const { sheetNames, totalRows, samples } = loadSampleRows();

  const examples = samples.map((row) => {
    const platformTxn = mapToPlatformTransaction(row);
    const footprint = CarbonCalculationService.calculateTransactionCarbonFootprint(platformTxn, {
      reportingMode: 'compliance'
    });
    return buildWorkedExample(row, footprint, platformTxn);
  });

  const output = {
    generatedAt: new Date().toISOString(),
    sourceWorkbook: 'Testing/MSME_Tally_Sample_Transactions_10_Sectors.xlsx',
    workbookStructure: {
      sheets: sheetNames,
      totalRows,
      sampledRows: examples.length,
      samplingStrategy: 'First row per voucher type (Purchase, Receipt, Payment, Journal, Sales) in each sector sheet'
    },
    carbonModelVersion: CarbonCalculationService.carbonConfigVersion,
    carbonReportingLabel: CarbonCalculationService.carbonReportingLabel,
    methodologyNote: 'Workbook has no Unit column; Sustainow uses spend-proxy (Tier 2) unless activity units are inferred elsewhere. Simple-table comparison uses flat voucher-type factors (Purchase 0.8, Receipt 0.45, Payment 2.68, Journal 0.25, Sales 0.15).',
    transactionCount: examples.length,
    sectorCount: sheetNames.length,
    examples
  };

  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(output, null, 2));

  console.log(`Read ${EXCEL_IN}`);
  console.log(`Sheets: ${sheetNames.length}, total rows: ${totalRows}, sampled: ${examples.length}`);
  console.log(`Wrote ${JSON_OUT}`);
}

main();
