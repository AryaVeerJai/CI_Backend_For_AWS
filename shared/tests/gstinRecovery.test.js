const test = require('node:test');
const assert = require('node:assert/strict');
const gstinRecovery = require('../gstinRecovery');

test('extractGstinFromText strict match', () => {
  const result = gstinRecovery.extractGstinFromText('GSTIN 27AABCU9603R1ZP');
  assert.equal(result?.gstin, '27AABCU9603R1ZP');
});

test('label-based GSTIN recovery', () => {
  const result = gstinRecovery.extractGstinFromText('GSTIN: 24AADCP1453JAZZ Road, Bengaluru');
  assert.equal(result?.gstin, '24AADCP1453JAZZ');
});
