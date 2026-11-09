import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function key(secret: string) {
  if (!/^[a-f\d]{64}$/i.test(secret))
    throw new Error('BACKUP_ENCRYPTION_KEY debe contener 32 bytes codificados en hexadecimal.');
  return Buffer.from(secret, 'hex');
}
export function seal(bytes: Uint8Array, secret: string): Buffer {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from('DEXTER-BACKUP-V1'));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([Buffer.from('DGBK1'), iv, cipher.getAuthTag(), data]);
}
export function unseal(bytes: Uint8Array, secret: string): Buffer {
  const data = Buffer.from(bytes);
  if (data.subarray(0, 5).toString() !== 'DGBK1') throw new Error('Formato de respaldo desconocido.');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), data.subarray(5, 17));
  decipher.setAAD(Buffer.from('DEXTER-BACKUP-V1'));
  decipher.setAuthTag(data.subarray(17, 33));
  return Buffer.concat([decipher.update(data.subarray(33)), decipher.final()]);
}
export function archive(files: Record<string, Uint8Array>): Uint8Array {
  const manifest = Object.entries(files).map(([name, bytes]) => ({
    name,
    size: bytes.byteLength,
    sha256: digest(bytes),
  }));
  return zipSync(
    {
      ...files,
      'manifest.json': strToU8(
        JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files: manifest }),
      ),
    },
    { level: 6 },
  );
}
export function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  const files = unzipSync(bytes),
    raw = files['manifest.json'];
  if (!raw) throw new Error('Falta manifiesto.');
  const manifest = JSON.parse(strFromU8(raw));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Manifiesto inválido.');
  for (const item of manifest.files) {
    if (item.name.includes('..') || item.name.startsWith('/') || item.name.includes('\\'))
      throw new Error('Ruta insegura en respaldo.');
    const data = files[item.name];
    if (!data || data.byteLength !== item.size || digest(data) !== item.sha256)
      throw new Error(`Archivo corrupto: ${item.name}`);
  }
  return files;
}
export function retain<T extends { key: string; at: Date }>(
  items: T[],
  kind: 'hourly' | 'daily' | 'monthly',
): T[] {
  const copies = kind === 'hourly' ? 168 : kind === 'daily' ? 30 : 12;
  return [...items].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(copies);
}
