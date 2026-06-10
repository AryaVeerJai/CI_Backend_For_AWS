const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');

const DATASET = path.resolve(__dirname, '../../automation_system/datasets/Bills New');
const API = 'http://localhost:5000/api';
const AUTH = { email: 'saloni123@example.com', password: 'Saloni@123' };

const BILLS = [
  { key: 'PDF-1', type: 'pdf', name: '1.0.pdf', id: '6a1d7f4a0b7734907e14c2a1' },
  { key: 'PDF-2', type: 'pdf', name: '9.0.pdf', id: '6a1fae324216b630ee12ad3b' },
  { key: 'IMG-1', type: 'image', name: '1.0_p02.png', id: '6a1d7fc80b7734907e14c673' },
  { key: 'IMG-2', type: 'image', name: '102.png', id: '6a1d83c40b7734907e14f080' },
  { key: 'WEAK', type: 'weak-ocr', name: '104.png', id: '6a1d84290b7734907e14f4c0' }
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function restoreFiles() {
  await mongoose.connect('mongodb://localhost:27017/carbon-intelligence');
  const col = mongoose.connection.db.collection('documents');
  for (const bill of BILLS) {
    const doc = await col.findOne({ _id: new mongoose.Types.ObjectId(bill.id) });
    if (!doc?.filePath) throw new Error(`Missing doc ${bill.name}`);
    const src = path.join(DATASET, bill.name);
    if (!fs.existsSync(src)) throw new Error(`Missing dataset file ${src}`);
    fs.mkdirSync(path.dirname(doc.filePath), { recursive: true });
    fs.copyFileSync(src, doc.filePath);
    bill.filePath = doc.filePath;
  }
  await mongoose.disconnect();
}

async function login() {
  const res = await axios.post(`${API}/auth/login`, AUTH);
  return res.data?.data?.token || res.data?.token;
}

async function reprocess(token, bill) {
  const started = Date.now();
  const res = await axios.post(`${API}/documents/${bill.id}/reprocess`, {}, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 600000,
    validateStatus: () => true
  });
  return { status: res.status, elapsedMs: Date.now() - started, body: res.data };
}

async function fetchDoc(bill) {
  await mongoose.connect('mongodb://localhost:27017/carbon-intelligence');
  const doc = await mongoose.connection.db.collection('documents').findOne(
    { _id: new mongoose.Types.ObjectId(bill.id) },
    { projection: { originalName: 1, status: 1, extractedData: 1 } }
  );
  await mongoose.disconnect();
  return doc;
}

function summarizeProvenance(doc) {
  const fp = doc?.extractedData?.fieldProvenance?.fields || {};
  const fields = ['gstin', 'referenceNumber', 'date', 'amount'];
  const out = {};
  for (const f of fields) {
    out[f] = {
      value: fp[f]?.value ?? doc?.extractedData?.[f] ?? null,
      winner: fp[f]?.winner || null
    };
  }
  return out;
}

(async () => {
  const health = await axios.get('http://localhost:5000/health', { validateStatus: () => true });
  const flagProbe = process.env.MULTI_OCR_RECOVERY_ENABLED;
  console.log(JSON.stringify({
    phase: 'startup',
    backendHealth: health.data,
    processEnvFlag: flagProbe,
    note: 'Flag must be 1/true in backend process env at startup'
  }, null, 2));

  await restoreFiles();
  const token = await login();
  const results = [];

  for (const bill of BILLS) {
    const before = await fetchDoc(bill);
    const beforeProv = summarizeProvenance(before);
    const rp = await reprocess(token, bill);
    await sleep(3000);
    const after = await fetchDoc(bill);
    const afterProv = summarizeProvenance(after);

    const multiOcrFields = ['gstin', 'referenceNumber', 'date', 'amount'].filter(
      (f) => afterProv[f]?.winner?.source === 'multi_ocr'
    );
    const overwriteDetected = ['gstin', 'referenceNumber', 'date', 'amount'].some((f) => {
      const beforeWinner = beforeProv[f]?.winner;
      const afterWinner = afterProv[f]?.winner;
      if (!beforeWinner || beforeWinner.stage === 'recovery') return false;
      if (!beforeProv[f]?.value || !afterProv[f]?.value) return false;
      return beforeWinner.source !== 'multi_ocr' && String(beforeProv[f].value) !== String(afterProv[f].value);
    });

    results.push({
      bill,
      reprocess: { status: rp.status, success: rp.body?.success, docStatus: rp.body?.document?.status, elapsedMs: rp.elapsedMs },
      status: after?.status,
      provenance: afterProv,
      multiOcrFields,
      multiOcrRecoveryHappened: multiOcrFields.length > 0,
      overwriteDetected,
      extracted: {
        gstin: after?.extractedData?.gstin || after?.extractedData?.seller_gstin,
        referenceNumber: after?.extractedData?.referenceNumber || after?.extractedData?.invoice_number,
        date: after?.extractedData?.date,
        amount: after?.extractedData?.amount
      }
    });
  }

  console.log(JSON.stringify({ phase: 'results', results }, null, 2));
})().catch((err) => {
  console.error('VERIFY_FAILED', err.message);
  process.exit(1);
});
