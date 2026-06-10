const documentLifecycle = require('../services/documentLifecycle');

describe('documentLifecycle state machine', () => {
  test('allows expected production transitions', () => {
    expect(documentLifecycle.canTransition('uploaded', 'processing')).toBe(true);
    expect(documentLifecycle.canTransition('uploaded', 'failed')).toBe(true);
    expect(documentLifecycle.canTransition('processing', 'processed')).toBe(true);
    expect(documentLifecycle.canTransition('processing', 'failed')).toBe(true);
    expect(documentLifecycle.canTransition('processing', 'duplicate')).toBe(true);
    expect(documentLifecycle.canTransition('processed', 'processing')).toBe(true);
    expect(documentLifecycle.canTransition('failed', 'processing')).toBe(true);
    expect(documentLifecycle.canTransition('duplicate', 'processing')).toBe(true);
  });

  test('rejects invalid transitions', () => {
    expect(documentLifecycle.canTransition('uploaded', 'processed')).toBe(false);
    expect(documentLifecycle.canTransition('processing', 'uploaded')).toBe(false);
    expect(documentLifecycle.canTransition('processed', 'failed')).toBe(false);

    expect(() => documentLifecycle.assertValidTransition('uploaded', 'processed')).toThrow(
      /Invalid document status transition/
    );
  });

  test('isValidFileBuffer', () => {
    expect(documentLifecycle.isValidFileBuffer(Buffer.from('x'))).toBe(true);
    expect(documentLifecycle.isValidFileBuffer(Buffer.alloc(0))).toBe(false);
    expect(documentLifecycle.isValidFileBuffer(null)).toBe(false);
  });

  test('buildInvalidTransitionReport lists only invalid pairs', () => {
    const report = documentLifecycle.buildInvalidTransitionReport();
    expect(report.length).toBeGreaterThan(0);
    expect(report.every((row) => !documentLifecycle.canTransition(row.from, row.to))).toBe(true);
  });
});
