jest.mock('../models/Document', () => ({
  findOneAndUpdate: jest.fn()
}));

const Document = require('../models/Document');
const documentLifecycle = require('../services/documentLifecycle');

describe('emitProcessingHeartbeat (BE-103 concurrency)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses atomic findOneAndUpdate instead of document.save', async () => {
    const save = jest.fn();
    const markModified = jest.fn();
    const document = {
      _id: '507f1f77bcf86cd799439011',
      status: 'processing',
      metadata: {},
      processingResults: { confidence: 0.5, errors: [], warnings: [] },
      save,
      markModified
    };

    Document.findOneAndUpdate.mockResolvedValue({
      metadata: {
        processingLifecycle: {
          currentStage: 'ai_analyze',
          lastHeartbeatAt: '2026-06-02T00:00:00.000Z',
          heartbeatCount: 1,
          lastTransitionAt: '2026-06-02T00:00:00.000Z'
        }
      },
      processingResults: {
        heartbeatAt: '2026-06-02T00:00:00.000Z',
        heartbeatSeq: 1
      }
    });

    await documentLifecycle.emitProcessingHeartbeat(document, { stage: 'ai_analyze' });

    expect(Document.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Document.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: document._id,
      status: 'processing'
    });
    expect(Document.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({
      'metadata.processingLifecycle.heartbeatCount': 1,
      'processingResults.heartbeatSeq': 1
    });
    expect(save).not.toHaveBeenCalled();
    expect(document.processingResults.heartbeatSeq).toBe(1);
  });
});
