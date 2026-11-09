import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const svg = await readFile('public/icon.svg', 'utf8');
const browser = await chromium.launch();
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:#173b40}svg{display:block;width:100%;height:100%}</style>${svg}`,
    );
    await page.screenshot({ path: `public/icon-${size}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
