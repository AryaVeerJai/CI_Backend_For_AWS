const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');

const DATASET = path.resolve(__dirname, '../../automation_system/datasets/Bills New');
const API = 'http://localhost:5000/api';
const AI = 'http://localhost:8000';
const AUTH = { email: 'saloni123@example.com', password: 'Saloni@123' };

async function analyzeFile(filePath, name) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), name);
  const res = await axios.post(`${AI}/analyze`, form, {
    headers: form.getHeaders(),
    timeout: 420000,
    validateStatus: () => true
  });
  return {
    status: res.status,
    hints: res.data?.data?.ocr_field_hints || null,
    detail: res.data?.detail || res.data?.message || null
  };
}

async function main() {
  await mongoose.connect('mongodb://localhost:27017/carbon-intelligence');
  const col = mongoose.connection.db.collection('documents');

  const candidates = [
    '12.0.pdf', '13.0.pdf', '14.0.pdf', '15.0.pdf', '16.0.pdf', '17.0.pdf', '18.0.pdf',
    '1.0.pdf', '10.0.pdf', '11.0.pdf'
  ];

  let chosen = null;
  let aiProbe = null;

  for (const name of candidates) {
    const datasetPath = path.join(DATASET, name);
    if (!fs.existsSync(datasetPath)) continue;
    const probe = await analyzeFile(datasetPath, name);
    if (probe.status === 200 && probe.hints) {
      let doc = await col.findOne({ originalName: name });
      if (!doc) {
        doc = await col.findOne({ originalName: name, status: 'processed' });
      }
      if (!doc) {
        doc = await col.findOne({ originalName: name });
      }
      if (!doc) {
        const any = await col.find({ originalName: name }).limit(1).toArray();
        doc = any[0] || null;
      }
      if (doc?.filePath) {
        fs.mkdirSync(path.dirname(doc.filePath), { recursive: true });
        fs.copyFileSync(datasetPath, doc.filePath);
      }
      chosen = { name, docId: doc?._id?.toString() || null, filePath: doc?.filePath || datasetPath, probe };
      aiProbe = probe;
      break;
    }
    if (probe.status === 200 && !chosen) {
      chosen = { name, probe, pendingDoc: true };
    }
  }

  if (!chosen || !chosen.docId) {
    for (const name of candidates) {
      const datasetPath = path.join(DATASET, name);
      if (!fs.existsSync(datasetPath)) continue;
      const probe = await analyzeFile(datasetPath, name);
      if (probe.status !== 409) {
        const doc = await col.findOne({ originalName: name });
        if (doc) {
          if (doc.filePath) {
            fs.mkdirSync(path.dirname(doc.filePath), { recursive: true });
            fs.copyFileSync(datasetPath, doc.filePath);
          }
          chosen = { name, docId: doc._id.toString(), filePath: doc.filePath, probe };
          aiProbe = probe;
          break;
        }
      }
    }
  }

  if (!chosen?.docId) {
    console.log(JSON.stringify({ error: 'No suitable bill found', tried: candidates }, null, 2));
    await mongoose.disconnect();
    process.exit(1);
  }

  const login = await axios.post(`${API}/auth/login`, AUTH);
  const token = login.data?.data?.token || login.data?.token;

  const rp = await axios.post(`${API}/documents/${chosen.docId}/reprocess`, {}, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 600000,
    validateStatus: () => true
  });

  const fresh = await col.findOne({ _id: new mongoose.Types.ObjectId(chosen.docId) });
  const fp = fresh?.extractedData?.fieldProvenance?.fields || {};
  const hintFields = ['gstin', 'referenceNumber', 'date', 'amount'];
  const provenance = {};
  for (const f of hintFields) {
    provenance[f] = fp[f]?.winner || null;
  }

  console.log(JSON.stringify({
    bill: { id: chosen.docId, name: chosen.name, filePath: chosen.filePath },
    aiBeforeReprocess: aiProbe || chosen.probe,
    reprocess: { status: rp.status, success: rp.data?.success, docStatus: rp.data?.document?.status },
    extractedSnapshot: {
      gstin: fresh?.extractedData?.gstin,
      referenceNumber: fresh?.extractedData?.referenceNumber || fresh?.extractedData?.invoice_number,
      date: fresh?.extractedData?.date,
      amount: fresh?.extractedData?.amount,
      hasOcrFieldHints: Boolean(fresh?.extractedData?.ocr_field_hints)
    },
    provenance,
    ocrHintWinners: hintFields.filter((f) => fp[f]?.winner?.source === 'ocr_hint')
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
