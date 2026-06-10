const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');

const BILL = '19.0.pdf';
const BILL_PATH = path.resolve(__dirname, '../../automation_system/datasets/Bills New', BILL);
const API = 'http://localhost:5000/api';
const AI = 'http://localhost:8000';
const AUTH = { email: 'saloni123@example.com', password: 'Saloni@123' };

async function login() {
  const res = await axios.post(`${API}/auth/login`, AUTH);
  return res.data?.data?.token || res.data?.token;
}

async function aiAnalyze() {
  const form = new FormData();
  form.append('file', fs.createReadStream(BILL_PATH), BILL);
  const res = await axios.post(`${AI}/analyze`, form, {
    headers: form.getHeaders(),
    timeout: 420000,
    validateStatus: () => true
  });
  return {
    status: res.status,
    ocr_field_hints: res.data?.data?.ocr_field_hints || null
  };
}

async function upload(token) {
  const form = new FormData();
  form.append('document', fs.createReadStream(BILL_PATH), BILL);
  const res = await axios.post(`${API}/documents/upload`, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
    timeout: 600000,
    validateStatus: () => true
  });
  return res.data;
}

async function reprocess(token, id) {
  const res = await axios.post(`${API}/documents/${id}/reprocess`, {}, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 600000,
    validateStatus: () => true
  });
  return res.data;
}

async function mongoDoc(id) {
  await mongoose.connect('mongodb://localhost:27017/carbon-intelligence');
  const doc = await mongoose.connection.db.collection('documents').findOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { projection: { originalName: 1, status: 1, extractedData: 1 } }
  );
  await mongoose.disconnect();
  return doc;
}

(async () => {
  const ai = await aiAnalyze();
  const token = await login();
  const up = await upload(token);
  const docId = up?.document?.id || up?.document?._id || up?.data?.document?.id;
  if (!docId) {
    console.log(JSON.stringify({ error: 'upload failed', up, ai }, null, 2));
    process.exit(1);
  }
  const rp = await reprocess(token, docId);
  const doc = await mongoDoc(docId);
  const fp = doc?.extractedData?.fieldProvenance?.fields || {};
  const fields = ['gstin', 'referenceNumber', 'date', 'amount'];
  const provenance = Object.fromEntries(fields.map((f) => [f, fp[f]?.winner || null]));
  console.log(JSON.stringify({
    bill: { id: docId, name: BILL, path: BILL_PATH },
    ai,
    upload: { success: up?.success, status: doc?.status },
    reprocess: { success: rp?.success, status: rp?.document?.status },
    extracted: {
      gstin: doc?.extractedData?.gstin,
      referenceNumber: doc?.extractedData?.referenceNumber,
      date: doc?.extractedData?.date,
      amount: doc?.extractedData?.amount
    },
    provenance,
    ocrHintFields: fields.filter((f) => fp[f]?.winner?.source === 'ocr_hint')
  }, null, 2));
})();
