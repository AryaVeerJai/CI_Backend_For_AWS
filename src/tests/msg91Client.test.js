jest.mock('axios');

const axios = require('axios');
const MSG91Client = require('../services/msg91Client');

describe('MSG91Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { success: true } });
  });

  test('throws when auth key is missing', async () => {
    const client = new MSG91Client({ senderId: 'SENDER' });

    await expect(client.sendMessage({ to: '9876543210', message: 'Hello' }))
      .rejects
      .toThrow('MSG91 auth key is not configured');
  });

  test('throws when sender id is missing', async () => {
    const client = new MSG91Client({ authKey: 'test-key' });

    await expect(client.sendMessage({ to: '9876543210', message: 'Hello' }))
      .rejects
      .toThrow('MSG91 sender ID is not configured');
  });

  test('sends message with normalized recipients and variables', async () => {
    const client = new MSG91Client({
      authKey: 'test-key',
      senderId: 'SENDER',
      baseUrl: 'https://example.com/api',
      apiVersion: 'v5',
      route: '4',
      unicode: 0
    });

    await client.sendMessage({
      to: ['9876543210', '919876543210'],
      message: 'Carbon score updated',
      variables: { score: '72' }
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, payload, config] = axios.post.mock.calls[0];

    expect(url).toBe('https://example.com/api/v5/message');
    expect(payload).toMatchObject({
      sender: 'SENDER',
      route: '4',
      sms: [
        {
          message: 'Carbon score updated',
          to: ['919876543210'],
          variables: { score: '72' }
        }
      ]
    });
    expect(config).toMatchObject({
      headers: expect.objectContaining({ authkey: 'test-key' })
    });
  });

  test('uses request-level sender id override when provided', async () => {
    const client = new MSG91Client({
      authKey: 'test-key',
      senderId: 'DEFAULT'
    });

    await client.sendMessage({
      to: '9876543210',
      message: 'OTP test',
      senderId: 'AIRTELH'
    });

    const [, payload] = axios.post.mock.calls[0];
    expect(payload.sender).toBe('AIRTELH');
  });

  test('throws when message and templateId are missing', async () => {
    const client = new MSG91Client({ authKey: 'key', senderId: 'SENDER' });

    await expect(client.sendMessage({ to: '9876543210' }))
      .rejects
      .toThrow('Either a message body or a templateId must be provided');
  });
});
