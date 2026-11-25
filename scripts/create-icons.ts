import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const logo = await readFile('public/LogoDexterTaraza.jpeg', 'base64');
const browser = await chromium.launch();
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    // El aro del icono adaptable debe caber en el círculo seguro del 80 %.
    const logoSize = size === 512 ? '74%' : '89%';
    await page.setContent(`
      <style>
        body { margin: 0; height: 100vh; display: grid; place-items: center; background: #173b40; }
        img { width: ${logoSize}; aspect-ratio: 1; border-radius: 50%; box-shadow: 0 0 0 1.5vw #fff; }
      </style>
      <img src="data:image/jpeg;base64,${logo}" alt="">
    `);
    await page.screenshot({ path: `public/dexter-taraza-${size}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
