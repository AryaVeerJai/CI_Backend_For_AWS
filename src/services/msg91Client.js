const axios = require('axios');
const logger = require('../utils/logger');

class MSG91Client {
  constructor(options = {}) {
    this.authKey = options.authKey || process.env.MSG91_AUTH_KEY;
    this.senderId = options.senderId || process.env.MSG91_SENDER_ID;
    this.route = options.route || process.env.MSG91_ROUTE || '4';
    this.baseUrl = options.baseUrl || process.env.MSG91_API_BASE_URL || 'https://control.msg91.com/api';
    this.apiVersion = options.apiVersion || process.env.MSG91_API_VERSION || 'v5';
    this.unicode = options.unicode ?? (process.env.MSG91_UNICODE ? Number(process.env.MSG91_UNICODE) : 0);
    this.shortUrl = options.shortUrl ?? (process.env.MSG91_SHORT_URL ? process.env.MSG91_SHORT_URL === 'true' : false);
  }

  async sendMessage({
    to,
    message,
    templateId,
    variables = {},
    countryCode = process.env.MSG91_COUNTRY_CODE || '91',
    senderId
  }) {
    if (!this.authKey) {
      throw new Error('MSG91 auth key is not configured');
    }

    const resolvedSenderId = senderId || this.senderId;

    if (!resolvedSenderId) {
      throw new Error('MSG91 sender ID is not configured');
    }

    const recipients = this.normalizeRecipients(to, countryCode);

    if (recipients.length === 0) {
      throw new Error('At least one recipient mobile number is required');
    }

    if (!message && !templateId) {
      throw new Error('Either a message body or a templateId must be provided');
    }

    const payload = {
      sender: resolvedSenderId,
      route: this.route,
      unicode: this.unicode,
      short_url: this.shortUrl,
      sms: [
        {
          message: message || '',
          to: recipients
        }
      ]
    };

    if (templateId) {
      payload.sms[0].template_id = templateId;
    }

    if (variables && Object.keys(variables).length > 0) {
      payload.sms[0].variables = variables;
    }

    const url = `${this.baseUrl}/${this.apiVersion}/message`;

    try {
      const response = await axios.post(url, payload, {
        headers: {
          authkey: this.authKey,
          'Content-Type': 'application/json'
        }
      });

      logger.info('MSG91 SMS sent successfully', {
        recipients,
        templateId,
        senderId: resolvedSenderId,
        hasVariables: Boolean(variables && Object.keys(variables).length > 0)
      });

      return response.data;
    } catch (error) {
      logger.error('MSG91 SMS sending failed', {
        error: error.response?.data || error.message,
        recipients,
        templateId
      });

      throw new Error(error.response?.data?.message || error.message || 'Failed to send SMS via MSG91');
    }
  }

  normalizeRecipients(recipients, countryCode) {
    if (!recipients) {
      return [];
    }

    const numbers = Array.isArray(recipients) ? recipients : [recipients];

    const normalized = numbers
      .map(number => this.normalizeMobileNumber(number, countryCode))
      .filter(Boolean);

    return Array.from(new Set(normalized));
  }

  normalizeMobileNumber(number, countryCode) {
    if (!number) {
      return null;
    }

    const digits = String(number).replace(/\D/g, '');

    if (!digits) {
      return null;
    }

    if (digits.startsWith(countryCode)) {
      return digits;
    }

    if (digits.length === 10 && countryCode) {
      return `${countryCode}${digits}`;
    }

    return digits;
  }
}

module.exports = MSG91Client;
