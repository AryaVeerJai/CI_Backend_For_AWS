const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

const resolveEncryptionKey = () => {
  const raw = process.env.CONNECTOR_CREDENTIALS_KEY || process.env.JWT_SECRET || '';
  if (!raw) {
    throw new Error('CONNECTOR_CREDENTIALS_KEY or JWT_SECRET must be set to store connector credentials');
  }
  return crypto.createHash('sha256').update(String(raw)).digest();
};

const encryptJson = (payload) => {
  const key = resolveEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(payload ?? {});
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decryptJson = (ciphertext) => {
  if (!ciphertext) return null;
  const parts = String(ciphertext).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted connector credential payload');
  }

  const [ivB64, tagB64, dataB64] = parts;
  const key = resolveEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString('utf8'));
};

module.exports = {
  encryptJson,
  decryptJson
};
