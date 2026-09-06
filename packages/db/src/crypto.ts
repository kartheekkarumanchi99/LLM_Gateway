import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// A 32-byte key derived from BYOK_ENCRYPTION_KEY (any string works; hashed to 32 bytes).
function getKey(): Buffer {
  const raw = process.env.BYOK_ENCRYPTION_KEY;
  if (!raw) throw new Error('BYOK_ENCRYPTION_KEY is not set.');
  return createHash('sha256').update(raw).digest();
}

export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.BYOK_ENCRYPTION_KEY);
}

// Returns "iv.tag.ciphertext", all base64. AES-256-GCM (authenticated).
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivb, tagb, encb] = payload.split('.');
  if (!ivb || !tagb || !encb) throw new Error('Malformed ciphertext.');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivb, 'base64'));
  decipher.setAuthTag(Buffer.from(tagb, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encb, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
