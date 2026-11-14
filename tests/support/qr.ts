import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';

/** PNG monocromo generado por la app, sin rotación ni perspectiva; no es una captura de cámara. */
export function decodeGeneratedQr(pixels: Uint8ClampedArray, width: number, height: number): string {
  return new QRCodeReader()
    .decode(
      new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height))),
      new Map([[DecodeHintType.PURE_BARCODE, true]]),
    )
    .getText();
}
