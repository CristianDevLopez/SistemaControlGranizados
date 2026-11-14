import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import QRCode from 'qrcode';
import { decodeGeneratedQr } from './support/qr.ts';

// PNG es una dependencia del generador; se resuelve desde su propio paquete.
const require = createRequire(import.meta.url);
const { PNG } = createRequire(require.resolve('qrcode'))('pngjs') as {
  PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Uint8Array } } };
};

it.each([
  'T3VU-4RYW-7U8M-YTUR-CCQ9-4Y77', // QR que falló en GitHub Actions.
  'QUZK-VZCV-SCVE-P2TZ-N9V5-ETNQ',
  'XA98-MW2N-XHFD-88EW-DGRG-3Q32',
  'WNC3-9NTM-RXXP-JRJ8-H6J9-KPG5',
  'PTZS-CFVY-GFBJ-MVFZ-RPK4-Z8N4',
  '9K94-6C4K-WGHX-EPSH-L8H3-TS7X',
  'FHBX-XFQ5-MYGS-TCW6-4DBP-3WU7',
])('lee el PNG completo del código %s sin confundir patrones con marcadores de cámara', async (code) => {
  const png = PNG.sync.read(
    await QRCode.toBuffer(code, { width: 350, margin: 3, errorCorrectionLevel: 'M' }),
  );
  const pixels = Uint8ClampedArray.from({ length: png.width * png.height }, (_, i) => png.data[i * 4]);
  expect(decodeGeneratedQr(pixels, png.width, png.height)).toBe(code);
});

it.each([0, 255])(
  'rechaza una imagen uniforme de intensidad %i en lugar de aceptar cualquier PNG',
  (value) => {
    expect(() => decodeGeneratedQr(new Uint8ClampedArray(350 * 350).fill(value), 350, 350)).toThrow();
  },
);
