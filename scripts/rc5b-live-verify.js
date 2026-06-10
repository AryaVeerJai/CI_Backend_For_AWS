#!/usr/bin/env node
/**
 * RC-5B live verification — no code changes, read-only orchestration.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');

const DATASET = path.resolve(__dirname, '../../automation_system/datasets/Bills New');
const API = 'http://localhost:5000/api';
const AI = 'http://localhost:8000';
const AUTH = {
  email: process.env.AUTOMATION_AUTH_EMAIL || 'saloni123@example.com',
  password: process.env.AUTOMATION_AUTH_PASSWORD || 'Saloni@123'
};

const BILLS = [
  {
    key: 'A',
    label: 'Missing GSTIN candidate',
    id: '6a1d85d80b7734907e1513be',
    file: '11.0_p03.png',
    expectHintField: 'gstin'
  },
  {
    key: 'B',
    label: 'Missing Invoice candidate',
    id: '6a1d84290b7734907e14f4c0',
    file: '104.png',
    expectHintField: 'referenceNumber'
  },
  {
    key: 'C',
    label: 'Missing Date candidate',
    id: '6a1d7fc80b7734907e14c673',
    file: '1.0_p02.png',
    expectHintField: 'date'
  },
  {
    key: 'D',
    label: 'Missing Amount candidate',
    id: '6a1d83c40b7734907e14f080',
    file: '102.png',
    expectHintField: 'amount'
  },
  {
    key: 'E',
    label: 'Normal bill',
    id: '6a1d818d0b7734907e14d2b9',
    file: '10.0.pdf',
    expectHintField: null
  }
];

const FALLBACK_BILL = {
  key: 'F',
  label: 'Fallback (no hints path)',
  id: '6a1d7f4a0b7734907e14c2a1',
  file: '1.0.pdf'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restoreUploadFiles() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon-intelligence');
  const col = mongoose.connection.db.collection('documents');
  const all = [...BILLS, FALLBACK_BILL];
  for (const bill of all) {
    const doc = await col.findOne({ _id: new mongoose.Types.ObjectId(bill.id) });
    if (!doc?.filePath) {
      throw new Error(`No filePath for ${bill.file}`);
    }
    const src = path.join(DATASET, bill.file);
    if (!fs.existsSync(src)) {
      throw new Error(`Dataset missing ${src}`);
    }
    fs.mkdirSync(path.dirname(doc.filePath), { recursive: true });
    fs.copyFileSync(src, doc.filePath);
    bill.filePath = doc.filePath;
    bill.originalName = doc.originalName;
  }
}

async function analyzeWithAI(bill) {
  const src = path.join(DATASET, bill.file);
  const form = new FormData();
  form.append('file', fs.createReadStream(src), bill.file);
  const started = Date.now();
  try {
    const res = await axios.post(`${AI}/analyze`, form, {
      headers: form.getHeaders(),
      timeout: 420000,
      validateStatus: () => true
    });
    return {
      status: res.status,
      elapsedMs: Date.now() - started,
      hints: res.data?.data?.ocr_field_hints || null,
      dataKeys: res.data?.data ? Object.keys(res.data.data) : [],
      error: res.data?.detail || res.data?.message || null
    };
  } catch (err) {
    return {
      status: err.response?.status || 0,
      elapsedMs: Date.now() - started,
      hints: null,
      error: err.message
    };
  }
}

async function login() {
  const res = await axios.post(`${API}/auth/login`, AUTH);
  const token = res.data?.data?.token || res.data?.token;
  if (!token) {
    throw new Error(`Login failed: ${JSON.stringify(res.data)}`);
  }
  return token;
}

async function reprocess(token, bill) {
  const started = Date.now();
  const res = await axios.post(
    `${API}/documents/${bill.id}/reprocess`,
    {},
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 600000,
      validateStatus: () => true
    }
  );
  return {
    status: res.status,
    elapsedMs: Date.now() - started,
    success: res.data?.success,
    message: res.data?.message,
    docStatus: res.data?.document?.status,
    resultSuccess: res.data?.result?.success
  };
}

async function fetchProvenance(billId) {
  const doc = await mongoose.connection.db.collection('documents').findOne(
    { _id: new mongoose.Types.ObjectId(billId) },
    { projection: { originalName: 1, status: 1, extractedData: 1 } }
  );
  const fp = doc?.extractedData?.fieldProvenance?.fields || {};
  const fields = ['gstin', 'referenceNumber', 'date', 'amount'];
  const summary = {};
  for (const f of fields) {
    summary[f] = {
      value: fp[f]?.value ?? doc?.extractedData?.[f] ?? null,
      winner: fp[f]?.winner || null,
      modifications: (fp[f]?.modifications || []).length
    };
  }
  return {
    originalName: doc?.originalName,
    status: doc?.status,
    hasOcrFieldHintsOnExtracted: Boolean(doc?.extractedData?.ocr_field_hints),
    summary,
    extractedSnapshot: {
      gstin: doc?.extractedData?.gstin || doc?.extractedData?.seller_gstin || null,
      referenceNumber: doc?.extractedData?.referenceNumber || doc?.extractedData?.invoice_number || null,
      date: doc?.extractedData?.date || null,
      amount: doc?.extractedData?.amount ?? null
    }
  };
}

function summarizeHints(hints) {
  if (!hints) {
    return null;
  }
  return {
    version: hints.version,
    has_gstin: hints.has_gstin,
    has_invoice_number: hints.has_invoice_number,
    has_date: hints.has_date,
    has_total: hints.has_total,
    gstin_candidates: hints.gstin_candidates?.length || 0,
    invoice_number_candidates: hints.invoice_number_candidates?.length || 0,
    date_candidates: hints.date_candidates?.length || 0,
    total_candidates: hints.total_candidates?.length || 0,
    sample_gstin: hints.gstin_candidates?.[0] || null,
    sample_invoice: hints.invoice_number_candidates?.[0] || null,
    sample_date: hints.date_candidates?.[0] || null,
    sample_total: hints.total_candidates?.length
      ? Math.max(...hints.total_candidates.map(Number).filter(Number.isFinite))
      : null
  };
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    services: {},
    aiVerification: [],
    reprocessResults: [],
    mongoVerification: [],
    fallbackVerification: null,
    overwriteVerification: null
  };

  report.services.ai = (await axios.get(`${AI}/health`, { timeout: 10000 })).data;
  report.services.backend = (await axios.get('http://localhost:5000/health', { timeout: 10000 })).data;

  console.log('Restoring upload files...');
  await restoreUploadFiles();

  console.log('SECTION 1 — AI /analyze verification...');
  for (const bill of BILLS) {
    console.log(`  AI analyze ${bill.key}: ${bill.file}`);
    const ai = await analyzeWithAI(bill);
    report.aiVerification.push({
      bill: bill.key,
      file: bill.file,
      status: ai.status,
      elapsedMs: ai.elapsedMs,
      hintsSummary: summarizeHints(ai.hints),
      hintsPresent: Boolean(ai.hints),
      versionOk: ai.hints?.version === '1.0',
      error: ai.error
    });
  }

  console.log('Login + reprocess bills...');
  const token = await login();
  for (const bill of BILLS) {
    console.log(`  Reprocess ${bill.key}: ${bill.id}`);
    const rp = await reprocess(token, bill);
    report.reprocessResults.push({ bill: bill.key, ...rp });
    await sleep(2000);
    const mongo = await fetchProvenance(bill.id);
    report.mongoVerification.push({
      bill: bill.key,
      expectHintField: bill.expectHintField,
      ...mongo
    });
  }

  console.log('SECTION 4 — Fallback bill reprocess (1.0.pdf)...');
  const fbRp = await reprocess(token, FALLBACK_BILL);
  const fbMongo = await fetchProvenance(FALLBACK_BILL.id);
  const fbAi = await analyzeWithAI(FALLBACK_BILL);
  report.fallbackVerification = {
    reprocess: fbRp,
    aiHintsPresent: Boolean(fbAi.hints),
    aiStatus: fbAi.status,
    mongo: fbMongo,
    ocrTextWinners: Object.entries(fbMongo.summary)
      .filter(([, v]) => v.winner?.source === 'ocr_text')
      .map(([k]) => k)
  };

  const normal = report.mongoVerification.find((m) => m.bill === 'E');
  report.overwriteVerification = {
    bill: 'E',
    fields: normal?.summary,
    ocrHintWinners: Object.entries(normal?.summary || {})
      .filter(([, v]) => v.winner?.source === 'ocr_hint')
      .map(([k]) => k),
    reconcileOrAiWinners: Object.entries(normal?.summary || {})
      .filter(([, v]) => v.winner && v.winner.source !== 'ocr_hint')
      .map(([k, v]) => ({ field: k, winner: v.winner }))
  };

  report.completedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('VERIFY_FAILED', err.message);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
