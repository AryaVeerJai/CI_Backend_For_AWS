#!/usr/bin/env node
/** Generate a valid TallyPrime Day Book sample PDF for import testing. */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUT_PATH = path.join(
  __dirname,
  '../../ai-model/data/DataConnectors/Import/TallyPrime/Sample_MSME_TallyPrime_Transactions.pdf'
);

const ROWS = [
  '01-04-2026 Purchase PUR/26-27/001 ABC Steel Suppliers 250000 0 Steel coils purchased',
  '03-04-2026 Journal JRN/001 Karnataka Electricity Board 18500 0 Monthly electricity bill',
  '05-04-2026 Payment PAY/001 Indian Oil Corporation 42000 0 Diesel for DG set',
  '07-04-2026 Payroll SAL/001 Employees 375000 0 Monthly payroll',
  '10-04-2026 Sales SAL/26-27/001 XYZ Exports Ltd 0 850000 Export invoice',
  '12-04-2026 Payment PAY/002 Water Board 6200 0 Factory water bill',
  '15-04-2026 Journal JRN/002 Green Waste Services 9800 0 Hazardous waste handling',
  '18-04-2026 Purchase PUR/26-27/002 Chemical Supplier 45000 0 Production chemicals'
];

async function main() {
  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 40 });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(14).text('TallyPrime Day Book Export');
    doc.fontSize(9).text(
      'Date Voucher Type Voucher Number Party A/c Name Debit Amount Credit Amount Narration'
    );
    doc.fontSize(8);
    ROWS.forEach((row) => doc.text(row));

    doc.end();
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buffer);
  console.log(`Wrote ${OUT_PATH} (${buffer.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
