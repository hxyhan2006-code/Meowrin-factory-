// tests/smoke.mjs — ทดสอบเร็วก่อน push: เปิดทั้ง 3 หน้าในเบราว์เซอร์จำลองกว้าง 380px แล้วเช็กว่าไม่พัง
// รัน: node tests/smoke.mjs   (ต้องมี Playwright · เครื่อง cloud มีติดตั้งไว้แล้ว) ไม่เรียก API จริง ไม่เสียเงิน
// เช็ก: เลขรุ่นตรงกัน · เทสต์ของ sub ผ่าน · ชื่อไอคอนที่เรียกมีครบ · ไม่มี confirm/alert/prompt ของเบราว์เซอร์ ·
//       แต่ละหน้าโหลดได้ไม่มี error/ไฟล์หาย/หน้าล้นจอ/อีโมจิหรือสัญลักษณ์ ★✓▶ ค้างบนจอ · เลขรุ่นท้ายตั้งค่าตรง version.js ·
//       เสียงที่เก็บไว้ (เล่น/หยุดตอนปิด ความยาว) · ลิงก์ ?voice= ของหน้าซับและหน้าฟุตเทจ
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? 'ผ่าน  ' : 'ไม่ผ่าน') + ' ' + name + (ok || !detail ? '' : '\n         ' + detail)); };
const sh = (cmd, cwd = ROOT) => { try { return { ok: true, out: execSync(cmd, { cwd, stdio: 'pipe' }).toString() }; } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') }; } };
const files = (dir, ext) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));
const text = (f) => readFileSync(join(ROOT, f), 'utf-8');

// ---------- เช็กไฟล์ (ไม่ต้องเปิดเบราว์เซอร์) ----------
let r = sh('node bump-version.mjs --check'); check('เลขรุ่นตรงกันทุกจุด (bump-version --check)', r.ok, r.out);
r = sh('node ai.test.mjs', join(ROOT, 'sub')); check('เทสต์ sub/ai.test.mjs', r.ok, r.out.slice(-400));
r = sh('node aligner.energy.test.mjs', join(ROOT, 'sub')); check('เทสต์ sub/aligner.energy.test.mjs', r.ok, r.out.slice(-400));
for (const f of [...files('.', '.js'), ...files('sub', '.js')]) { const t = text(f); try { new Function(t.replace(/^\s*import .*$/gm, '').replace(/\bexport\s+/g, '').replace(/\bawait\b/g, '')); } catch (e) { if (!/await|import|export/.test(String(e))) check('syntax ' + f, false, String(e)); } }
const jsAll = [...files('.', '.js'), ...files('sub', '.js')];
const defined = new Set([...text('icons.js').matchAll(/^\s{4}([a-z]+):\s*'/gm)].map((m) => m[1]));
const used = new Set(); const subUsed = new Set();
for (const f of [...jsAll.filter((x) => !x.startsWith('sub')), 'index.html', 'footage.html']) for (const m of text(f).matchAll(/MWIcon\("([a-z]+)"\)|#i-([a-z]+)/g)) used.add(m[1] || m[2]);
const subSyms = new Set([...text('sub/index.html').matchAll(/<symbol id="i-([a-z]+)"/g)].map((m) => m[1]));
for (const f of ['sub/index.html', ...files('sub', '.js')]) for (const m of text(f).matchAll(/#i-([a-z]+)/g)) subUsed.add(m[1]);
const missing = [...used].filter((n) => !defined.has(n)); const subMissing = [...subUsed].filter((n) => !subSyms.has(n));
check('ชื่อไอคอนที่เรียกใช้มีครบ (icons.js + sprite ของ sub)', !missing.length && !subMissing.length, 'ขาด: ' + [...missing, ...subMissing].join(', '));
const dialogs = [];
for (const f of jsAll.filter((x) => x !== 'dialog.js')) text(f).split('\n').forEach((l, i) => { if (/window\.(confirm|alert|prompt)\b|(?<![.\w])(alert|confirm)\(/.test(l)) dialogs.push(f + ':' + (i + 1)); });
check('ไม่มี confirm/alert/prompt ของเบราว์เซอร์ (ใช้ MWDialog)', !dialogs.length, dialogs.join(', '));

// ---------- เปิดหน้าในเบราว์เซอร์ ----------
let pw;
try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const chromium = pw.chromium || pw.default?.chromium;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { let p = join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); });
await new Promise((ok) => server.listen(0, ok)); const base = 'http://localhost:' + server.address().port;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 380, height: 820 } }); // ทุกหน้าใช้ที่เก็บข้อมูลเดียวกัน (เสียงที่เซ็ตไว้ในหน้าหลักเห็นในหน้าอื่น)
const GLYPH = /[\u{1F300}-\u{1FAFF}⚠✂⚙⏹⏳☁⬇★☆✓✗✕▶❚]/u;
const wavBlobJs = `(n, sr) => { const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 10) * 8000, true); return new Blob([buf], { type: 'audio/wav' }); }`;
async function open(path, name) {
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|accounts\.google|youtube|ytimg/.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('response', (x) => { if (x.url().startsWith(base) && x.status() >= 400) problems.push(x.status() + ' ' + x.url()); });
  await page.addInitScript(() => { window.__auds = []; const op = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__auds.push(this); return op.call(this); }; });
  await page.goto(base + path); await page.waitForTimeout(2200);
  return { page, problems, name };
}
async function finishPage(p) {
  const over = await p.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const glyph = await p.page.evaluate((re) => (document.body.innerText.match(new RegExp(re, 'gu')) || []).join(''), GLYPH.source);
  check(`${p.name}: โหลดได้ ไม่มี error/ไฟล์หาย`, !p.problems.length, p.problems.join('\n         '));
  check(`${p.name}: หน้าไม่ล้นจอ`, !over);
  check(`${p.name}: ไม่มีอีโมจิ/สัญลักษณ์ตัวอักษรบนจอ`, !glyph, 'เจอ: ' + glyph);
}
try {
  // หน้าหลัก
  const main = await open('/index.html', 'หน้าหลัก');
  await main.page.click('nav [data-tab=settings]'); await main.page.waitForTimeout(300);
  const label = await main.page.textContent('#appVersion'); const ver = /var VERSION = "([\w.]+)"/.exec(text('version.js'))[1];
  check('ท้ายตั้งค่าโชว์เลขรุ่นตรง version.js', label === 'meowrin factory v' + ver, `ได้ "${label}"`);
  await main.page.evaluate(`(async () => { const mk = ${wavBlobJs}; await MWVoice.put({ id: 1700000000001, text: 'บทของเทคนี้', name: 'take.mp3', blob: mk(80000, 8000) }); })()`);
  await main.page.reload(); await main.page.waitForTimeout(2000);
  await main.page.click('nav [data-tab=voice]'); await main.page.click('#vSavedBtn'); await main.page.waitForTimeout(1500);
  check('เสียงที่เก็บไว้: การ์ดขึ้นพร้อมความยาว', /0:00 \/ 0:\d\d/.test(await main.page.textContent('.vtime')));
  await main.page.click('.vplay'); await main.page.waitForTimeout(600);
  const playing = await main.page.evaluate(() => window.__auds.some((a) => !a.paused));
  await main.page.click('#vSavedClose'); await main.page.waitForTimeout(300);
  check('เสียงที่เก็บไว้: กดเล่นแล้วปิดหน้าต่าง เสียงหยุด', playing && !(await main.page.evaluate(() => window.__auds.some((a) => !a.paused))));
  await finishPage(main);
  // หน้าซับ (?voice=)
  const sub = await open('/sub/?voice=1700000000001', 'หน้าซับ');
  await sub.page.waitForTimeout(1500);
  check('หน้าซับ: ?voice= ใส่เสียงและบทให้', (await sub.page.textContent('#fileInfo')).includes('take.mp3') && (await sub.page.inputValue('#rawScript')) === 'บทของเทคนี้');
  await finishPage(sub);
  // หน้าฟุตเทจ (?voice=)
  const foot = await open('/footage.html?voice=1700000000001', 'หน้าฟุตเทจ');
  await foot.page.waitForTimeout(1200);
  check('หน้าฟุตเทจ: ?voice= ไปแท็บผู้กำกับ เลือกเสียงให้', (await foot.page.evaluate(() => document.querySelector('#p-plan').classList.contains('on'))) && (await foot.page.inputValue('#plVoice')) === '1700000000001');
  await foot.page.click('nav button[data-p="set"]'); await foot.page.waitForTimeout(300);
  await finishPage(foot);
} finally { await browser.close(); server.close(); }
const bad = results.filter((x) => !x.ok);
console.log(`\n${bad.length ? 'มี ' + bad.length + ' ข้อไม่ผ่าน' : 'ผ่านทั้งหมด'} (${results.length} ข้อ)`);
process.exit(bad.length ? 1 : 0);
