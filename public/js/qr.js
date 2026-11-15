// QR codes as inline SVG, drawn from the vendored qrcode-generator (MIT, see vendor/).
import qrcode from './vendor/qrcode-generator-2.0.4.js';

/** An <svg> (as markup) of a QR code for `text`: black on white with a quiet zone, for scanning. */
export function qrSvg(text, { label = 'QR code' } = {}) {
  const qr = qrcode(0, 'M'); // 0 = smallest size that fits; M = medium error correction
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let path = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const size = n + quiet * 2;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label.replace(/[&<>"]/g, '')}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
