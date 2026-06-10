const crypto = require('crypto');
const documentProcessingExecution = require('../services/documentProcessingExecution');

describe('documentProcessingExecution (single-flight)', () => {
  test('allows one active execution per document', () => {
    const docId = crypto.randomUUID();

    const first = documentProcessingExecution.tryBeginExecution(docId);
    expect(first.acquired).toBe(true);
    expect(first.token).toBeTruthy();

    const second = documentProcessingExecution.tryBeginExecution(docId);
    expect(second.acquired).toBe(false);
    expect(second.reason).toBe('processing_execution_already_active');

    documentProcessingExecution.endExecution(docId, first.token);

    const third = documentProcessingExecution.tryBeginExecution(docId);
    expect(third.acquired).toBe(true);
    documentProcessingExecution.endExecution(docId, third.token);
  });
});
