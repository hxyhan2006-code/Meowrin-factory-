// tools/render-icons.mjs — สร้าง icon-192.png / icon-512.png จาก icon.svg (ไอคอนแอพ: ตัว M เขียวบนพื้นดำ)
// รัน: node tools/render-icons.mjs   (ต้องมี Playwright · ใช้เฉพาะตอนแก้ icon.svg ไม่ได้อยู่ในแอพ)
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pw; try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const chromium = pw.chromium || pw.default?.chromium;
const svg = readFileSync(join(ROOT, 'icon.svg'), 'utf-8');
const browser = await chromium.launch(); const page = await browser.newPage();
for (const [size, name] of [[512, 'icon-512.png'], [192, 'icon-192.png']]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent('<body style="margin:0;background:#0b0e0d">' + svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `) + '</body>');
  await page.screenshot({ path: join(ROOT, name), clip: { x: 0, y: 0, width: size, height: size } });
  console.log('สร้าง', name);
}
await browser.close();
