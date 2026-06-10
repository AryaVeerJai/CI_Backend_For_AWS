const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const logger = require('../utils/logger');

class EmailIngestionAgent {
  constructor() {
    this.providerDefaults = {
      'gmail.com': { host: 'imap.gmail.com', port: 993, secure: true },
      'googlemail.com': { host: 'imap.gmail.com', port: 993, secure: true },
      'outlook.com': { host: 'outlook.office365.com', port: 993, secure: true },
      'hotmail.com': { host: 'outlook.office365.com', port: 993, secure: true },
      'live.com': { host: 'outlook.office365.com', port: 993, secure: true },
      'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993, secure: true },
      'yahoo.in': { host: 'imap.mail.yahoo.com', port: 993, secure: true },
      'icloud.com': { host: 'imap.mail.me.com', port: 993, secure: true },
      'zoho.com': { host: 'imap.zoho.com', port: 993, secure: true },
      'protonmail.com': { host: 'imap.protonmail.com', port: 993, secure: true }
    };
  }

  resolveConnectionSettings(email, overrides = {}) {
    const domain = (email || '').split('@')[1]?.toLowerCase();
    const defaults = (domain && this.providerDefaults[domain]) || {
      host: overrides.host || 'imap.gmail.com',
      port: overrides.port || 993,
      secure: overrides.secure !== undefined ? overrides.secure : true
    };

    return {
      host: overrides.host || defaults.host,
      port: overrides.port || defaults.port,
      secure: overrides.secure !== undefined ? overrides.secure : defaults.secure
    };
  }

  async fetchEmails(options) {
    const {
      email,
      password,
      imapServer,
      imapPort,
      secure = true,
      limit = 25,
      sinceDays = 30,
      mailbox = 'INBOX'
    } = options;

    const connection = this.resolveConnectionSettings(email, {
      host: imapServer,
      port: imapPort,
      secure
    });

    const client = new ImapFlow({
      host: connection.host,
      port: connection.port,
      secure: connection.secure,
      auth: {
        user: email,
        pass: password
      }
    });

    const emails = [];
    const metadata = {
      fetched: 0,
      mailbox,
      sinceDays,
      connection: {
        host: connection.host,
        port: connection.port,
        secure: connection.secure
      }
    };

    try {
      await client.connect();
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - sinceDays);

      const lock = await client.getMailboxLock(mailbox);
      try {
        const searchCriteria = { since: sinceDate };

        for await (const message of client.fetch(searchCriteria, {
          source: true,
          internalDate: true,
          envelope: true
        })) {
          if (!message || !message.source) {
            continue;
          }

          try {
            const parsed = await simpleParser(message.source);

            emails.push({
              id: parsed.messageId || message.envelope?.messageId || `${message.uid}`,
              subject: parsed.subject || message.envelope?.subject || '(no subject)',
              from: parsed.from?.value?.[0]?.address || message.envelope?.from?.[0]?.address || 'unknown@unknown',
              to:
                parsed.to?.value?.map((recipient) => recipient.address) ||
                message.envelope?.to?.map((recipient) => recipient.address) || [],
              date: parsed.date || message.internalDate || new Date(),
              body: parsed.html || parsed.textAsHtml || parsed.text || '',
              textBody: parsed.text || '',
              attachments: parsed.attachments?.length || 0
            });

            metadata.fetched += 1;
            if (emails.length >= limit) {
              break;
            }
          } catch (parseError) {
            logger.warn('Failed to parse email message', {
              error: parseError.message,
              uid: message.uid
            });
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();

      return {
        success: true,
        emails,
        metadata
      };
    } catch (error) {
      logger.error('Email ingestion error', {
        error: error.message,
        host: connection.host,
        port: connection.port,
        mailbox
      });

      try {
        await client.logout();
      } catch (logoutError) {
        logger.warn('Failed to gracefully close IMAP connection', {
          error: logoutError.message
        });
      }

      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new EmailIngestionAgent();
