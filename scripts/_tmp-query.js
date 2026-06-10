const mongoose = require('mongoose');
(async () => {
  await mongoose.connect('mongodb://localhost:27017/carbon-intelligence');
  const col = mongoose.connection.db.collection('documents');
  const hintDocs = await col.find({
    $or: [
      { 'extractedData.fieldProvenance.fields.gstin.winner.source': 'ocr_hint' },
      { 'extractedData.fieldProvenance.fields.referenceNumber.winner.source': 'ocr_hint' },
      { 'extractedData.fieldProvenance.fields.date.winner.source': 'ocr_hint' },
      { 'extractedData.fieldProvenance.fields.amount.winner.source': 'ocr_hint' }
    ]
  }).project({ originalName: 1, 'extractedData.fieldProvenance.fields': 1 }).toArray();
  const ocrTextDocs = await col.find({
    $or: [
      { 'extractedData.fieldProvenance.fields.referenceNumber.winner.source': 'ocr_text' },
      { 'extractedData.fieldProvenance.fields.gstin.winner.source': 'ocr_text' }
    ]
  }).limit(3).project({ originalName: 1, 'extractedData.fieldProvenance.fields': 1 }).toArray();
  console.log(JSON.stringify({ ocr_hint_count: hintDocs.length, hintDocs, ocr_text_samples: ocrTextDocs }, null, 2));
  await mongoose.disconnect();
})();
