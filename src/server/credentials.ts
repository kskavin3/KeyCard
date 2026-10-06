import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const keyVersion = 1;

function encryptionKey(): Buffer {
  const encoded = process.env.KEYCARD_ENCRYPTION_KEY;
  if (!encoded) throw new Error('KEYCARD_ENCRYPTION_KEY is required to store provider credentials.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('KEYCARD_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export function encryptCredential(value: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    encryptedSecret: encrypted.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  };
}

export function decryptCredential(record: { encrypted_secret: string; nonce: string; auth_tag: string }) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(record.auth_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.encrypted_secret, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
