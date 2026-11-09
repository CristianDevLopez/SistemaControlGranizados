export function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value),
  );
  return Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, '0')).join('');
}
function bytes(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/.{1,2}/g) ?? [], (x) => parseInt(x, 16));
}
export async function pinHash(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytes(salt), iterations: 210000, hash: 'SHA-256' },
    key,
    256,
  );
  return Array.from(new Uint8Array(derived), (x) => x.toString(16).padStart(2, '0')).join('');
}
export function constantEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function couponCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (v) => alphabet[v & 31])
    .join('')
    .match(/.{1,4}/g)!
    .join('-');
}
export async function encryptPermit(
  pin: string,
  token: string,
): Promise<{ salt: string; iv: string; encrypted: string }> {
  const salt = randomToken(16),
    iv = randomToken(12),
    hash = await pinHash(pin, salt);
  const key = await crypto.subtle.importKey('raw', bytes(hash), 'AES-GCM', false, ['encrypt']);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytes(iv) },
    key,
    new TextEncoder().encode(token),
  );
  return {
    salt,
    iv,
    encrypted: Array.from(new Uint8Array(data), (x) => x.toString(16).padStart(2, '0')).join(''),
  };
}
export async function decryptPermit(
  pin: string,
  permit: { salt: string; iv: string; encrypted: string },
): Promise<string> {
  const hash = await pinHash(pin, permit.salt),
    key = await crypto.subtle.importKey('raw', bytes(hash), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(permit.iv) }, key, bytes(permit.encrypted)),
  );
}
