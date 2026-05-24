const crypto = require('crypto');

const keyBase64 = process.env.ENCRYPTION_KEY;
if (!keyBase64) {
  throw new Error('ENCRYPTION_KEY must be set (32-byte Base64)');
}
const key = Buffer.from(keyBase64, 'base64');
if (key.length !== 32) {
  throw new Error('ENCRYPTION_KEY must decode to 32 bytes (Base64)');
}

// Encrypt plaintext using AES-256-GCM. Returns base64(iv + tag + ciphertext).
const encrypt = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
};

// Decrypt payload produced by encrypt().
const decrypt = (payloadBase64) => {
  const buf = Buffer.from(payloadBase64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
};

module.exports = { encrypt, decrypt };
