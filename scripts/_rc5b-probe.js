const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');

const DATASET = path.resolve(__dirname, '../../automation_system/datasets/Bills New');
const AI = 'http://localhost:8000';

async function probe(name) {
  const p = path.join(DATASET, name);
  if (!fs.existsSync(p)) return null;
  const form = new FormData();
  form.append('file', fs.createReadStream(p), name);
  const res = await axios.post(`${AI}/analyze`, form, {
    headers: form.getHeaders(),
    timeout: 420000,
    validateStatus: () => true
  });
  return {
    name,
    status: res.status,
    hasHints: Boolean(res.data?.data?.ocr_field_hints),
    version: res.data?.data?.ocr_field_hints?.version || null,
    detail: res.data?.detail?.error || res.data?.detail || null
  };
}

(async () => {
  const files = fs.readdirSync(DATASET).filter((f) => f.endsWith('.pdf')).slice(0, 40);
  await mongoose.connect('mongodb://localhost:27017/carbon-intelligence');
  const col = mongoose.connection.db.collection('documents');
  const results = [];
  for (const name of files) {
    const r = await probe(name);
    if (!r) continue;
    const doc = await col.findOne({ originalName: name }, { projection: { _id: 1, filePath: 1, status: 1 } });
    results.push({ ...r, docId: doc?._id?.toString() || null, hasDoc: Boolean(doc) });
    if (r.status === 200 && r.hasHints) {
      console.log('FOUND', JSON.stringify({ ...r, docId: doc?._id?.toString() }));
    }
  }
  console.log(JSON.stringify(results.filter((r) => r.status === 200), null, 2));
  await mongoose.disconnect();
})();
