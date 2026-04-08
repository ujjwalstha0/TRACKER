import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(':');
  if (!salt || !storedHash) {
    return false;
  }

  const computed = scryptSync(plain, salt, KEY_LENGTH);
  const target = Buffer.from(storedHash, 'hex');
  if (computed.length !== target.length) {
    return false;
  }

  return timingSafeEqual(computed, target);
}
