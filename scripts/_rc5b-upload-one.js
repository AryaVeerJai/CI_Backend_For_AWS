const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');

const BILL = process.argv[2] || '22.0.pdf';
const BILL_PATH = path.resolve(__dirname, '../../automation_system/datasets/Bills New', BILL);
const API = 'http://localhost:5000/api';
const AI = 'http://localhost:8000';

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitDoc(id) {
  for (let i = 0; i < 80; i += 1) {
    await sleep(5000);
    await mongoose.connect('mongodb://localhost:27017/carbon-intelligence');
    const doc = await mongoose.connection.db.collection('documents').findOne({
      _id: new mongoose.Types.ObjectId(id)
    });
    await mongoose.disconnect();
    if (['processed', 'failed', 'duplicate'].includes(doc?.status)) return doc;
  }
  return null;
}

(async () => {
  const login = await axios.post(`${API}/auth/login`, {
    email: 'saloni123@example.com',
    password: 'Saloni@123'
  });
  const token = login.data.data.token;

  const upForm = new FormData();
  upForm.append('document', fs.createReadStream(BILL_PATH), BILL);
  const upRes = await axios.post(`${API}/documents/upload`, upForm, {
    headers: { ...upForm.getHeaders(), Authorization: `Bearer ${token}` },
    timeout: 600000,
    validateStatus: () => true
  });
  const id = upRes.data?.document?.id || upRes.data?.document?._id;

  let doc = await waitDoc(id);

  const rpRes = await axios.post(`${API}/documents/${id}/reprocess`, {}, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 600000,
    validateStatus: () => true
  });
  doc = await waitDoc(id);

  const aiForm = new FormData();
  aiForm.append('file', fs.createReadStream(BILL_PATH), BILL);
  const aiRes = await axios.post(`${AI}/analyze`, aiForm, {
    headers: aiForm.getHeaders(),
    timeout: 420000,
    validateStatus: () => true
  });

  const fp = doc?.extractedData?.fieldProvenance?.fields || {};
  const fields = ['gstin', 'referenceNumber', 'date', 'amount'];
  console.log(JSON.stringify({
    bill: { id, name: BILL },
    aiAnalyzeAfter: {
      status: aiRes.status,
      hasHints: Boolean(aiRes.data?.data?.ocr_field_hints),
      version: aiRes.data?.data?.ocr_field_hints?.version || null
    },
    reprocess: { success: rpRes.data?.success, status: rpRes.data?.document?.status },
    docStatus: doc?.status,
    provenance: Object.fromEntries(fields.map((f) => [f, fp[f]?.winner || null])),
    ocrHintFields: fields.filter((f) => fp[f]?.winner?.source === 'ocr_hint')
  }, null, 2));
})();
