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
// ไอคอนแอพ: ทุกไฟล์ใน manifest.json ต้องมีจริงและเป็น PNG ขนาดตรงที่ประกาศไว้
const man = JSON.parse(text('manifest.json')); const badIcons = [];
for (const ic of man.icons) { try { const b = readFileSync(join(ROOT, ic.src.split('?')[0])); const w = b.readUInt32BE(16), h = b.readUInt32BE(20); if (b.toString('latin1', 1, 4) !== 'PNG' || `${w}x${h}` !== ic.sizes) badIcons.push(ic.src + ' ขนาด ' + w + 'x' + h); } catch { badIcons.push(ic.src + ' ไม่มีไฟล์'); } }
check('ไอคอนแอพใน manifest.json มีจริงและขนาดตรง', !badIcons.length, badIcons.join(', '));
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
  check('ท้ายตั้งค่าโชว์เลขรุ่นตรง version.js', label === 'Meowrin factory v' + ver, `ได้ "${label}"`);
  await main.page.evaluate(`(async () => { const mk = ${wavBlobJs}; await MWVoice.put({ id: 1700000000001, text: 'บทของเทคนี้', name: 'take.mp3', blob: mk(80000, 8000) }); })()`);
  await main.page.reload(); await main.page.waitForTimeout(2000);
  await main.page.click('nav [data-tab=voice]'); await main.page.click('#vSavedBtn'); await main.page.waitForTimeout(1500);
  check('เสียงที่เก็บไว้: การ์ดขึ้นพร้อมความยาว', /0:00 \/ 0:\d\d/.test(await main.page.textContent('.vtime')));
  await main.page.click('#vSavedList .vplay'); await main.page.waitForTimeout(600);
  const playing = await main.page.evaluate(() => window.__auds.some((a) => !a.paused));
  await main.page.click('#vSavedClose'); await main.page.waitForTimeout(300);
  // แถวปุ่มใต้เสียงที่เจนแล้ว ต้องไม่ล้นจอ (ล้น = มือถือซูมออกทั้งหน้า) แม้ปุ่มโชว์ครบทั้ง 5
  await main.page.evaluate(() => { document.querySelector('#vBody').hidden = false; document.querySelector('#vNo').hidden = true; document.querySelector('#ttsOut').hidden = false; ['ttsSub', 'ttsDirect', 'ttsRaw', 'ttsShare'].forEach((i) => { document.getElementById(i).hidden = false; }); });
  check('แท็บเสียง: แถวปุ่มใต้เสียงที่เจนแล้วไม่ล้นจอ', await main.page.evaluate(() => { const bs = [...document.querySelectorAll('#ttsOut .row .btn')]; return bs.length === 5 && bs.every((b) => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().right <= innerWidth + 1); }));
  check('แท็บเสียง: ตัวเล่นของแอพเอง (ไม่มีตัวเล่นของเบราว์เซอร์) ไม่ล้นจอ', await main.page.evaluate(() => { const r = document.querySelector('#ttsOut .tplayer').getBoundingClientRect(); return !document.querySelector('#ttsAudio').controls && r.width > 0 && r.right <= innerWidth + 1 && document.querySelector('#ttsPlay svg') !== null; }));
  check('เสียงที่เก็บไว้: กดเล่นแล้วปิดหน้าต่าง เสียงหยุด', playing && !(await main.page.evaluate(() => window.__auds.some((a) => !a.paused))));
  // บทพากย์: แก้ในหน้าเสียงต้องไม่ทับต้นฉบับในหน้าบท · จัดบรรทัดใหม่ต้องรวมบรรทัดที่ถูกตัด (ไม่ตัดตามความกว้างจอ)
  await main.page.evaluate(() => {
    const clip = { id: 'smokeclip', title: 'คลิปทดสอบ', channel: 'ช่อง', views: 1, published: '2026-01-01', score: 1 };
    MW.history.merge([{ id: 'smokeclip', clip, at: Date.now(), trans: '', active: 0, vers: [{ pid: 'A', pname: 'A', eye: 'x', writer: 'x', chat: [{ role: 'user', content: 'u' }, { role: 'assistant', content: 's1' }], s1Len: 2, s1: 's1', s2: 'PART 1\nชื่อ\nPART 2\nลูฟี่เคยสร้างอุบัติเหตุ\nพุ่งชนหน้าอกสาว\n\nรอบแรกเกิดขึ้นที่เกาะ', at: Date.now() }] }]);
    MW.data.picked = clip; MW.persist();
  });
  await main.page.click('nav [data-tab=script]'); await main.page.click('nav [data-tab=voice]'); await main.page.waitForTimeout(500);
  const orig = 'ลูฟี่เคยสร้างอุบัติเหตุ\nพุ่งชนหน้าอกสาว\n\nรอบแรกเกิดขึ้นที่เกาะ';
  await main.page.evaluate(() => document.querySelector('#quickFb [data-q=lines]').click()); await main.page.waitForTimeout(300);
  check('จัดบรรทัดใหม่: รวมบรรทัดที่ถูกตัดในท่อนเดียวกัน คงบรรทัดว่างคั่นท่อน', (await main.page.inputValue('#vText')) === 'ลูฟี่เคยสร้างอุบัติเหตุ พุ่งชนหน้าอกสาว\n\nรอบแรกเกิดขึ้นที่เกาะ', await main.page.inputValue('#vText'));
  check('หน้าบทยังโชว์ต้นฉบับ แม้แก้ในหน้าเสียงแล้ว', (await main.page.textContent('#s2View')) === orig);
  const st = () => main.page.evaluate(() => ({ back: !document.querySelector('#s2Back').disabled, fwd: !document.querySelector('#s2Fwd').disabled }));
  const s1 = await st();
  check('ย้อน/ไปข้างหน้า: หลังแก้ ย้อนได้ ไปข้างหน้าไม่ได้ (ปุ่มเทา)', s1.back && !s1.fwd);
  await main.page.evaluate(() => document.querySelector('#s2Back').click()); await main.page.waitForTimeout(300);
  const s2 = await st();
  check('กดย้อน: บทกลับเป็นต้นฉบับ และปุ่มย้อนเป็นสีเทา (สุดทาง) ปุ่มไปข้างหน้ากดได้', (await main.page.inputValue('#vText')) === orig && !s2.back && s2.fwd);
  await main.page.evaluate(() => document.querySelector('#s2Fwd').click()); await main.page.waitForTimeout(300);
  const s3 = await st();
  check('กดไปข้างหน้า: บทกลับเป็นฉบับแก้ และปุ่มไปข้างหน้าเป็นสีเทา', (await main.page.inputValue('#vText')).startsWith('ลูฟี่เคยสร้างอุบัติเหตุ พุ่ง') && s3.back && !s3.fwd);
  await main.page.fill('#vText', 'พิมพ์แก้เองหนึ่งรอบ'); await main.page.dispatchEvent('#vText', 'change'); await main.page.evaluate(() => document.querySelector('#s2Back').click()); await main.page.waitForTimeout(300);
  check('พิมพ์แก้เองแล้วแตะออก = หนึ่งขั้น ย้อนได้ทีละขั้น', (await main.page.inputValue('#vText')).startsWith('ลูฟี่เคยสร้างอุบัติเหตุ พุ่ง'));
  check('หน้าบทยังโชว์ต้นฉบับหลังย้อน/แก้หลายรอบ', (await main.page.textContent('#s2View')) === orig);
  check('แท็บเสียง: แถวปุ่มคัดลอก/ย้อน/ไปข้างหน้า ไม่ล้นจอ', await main.page.evaluate(() => { const bs = ['copyBtn', 's2Back', 's2Fwd'].map((i) => document.getElementById(i).getBoundingClientRect()); return bs.every((b) => b.width > 0 && b.right <= innerWidth + 1); }));
  await main.page.evaluate(`MWVoice.put({ id: 1700000000002, text: 'ลูฟี่เคยสร้างอุบัติเหตุพุ่งชนหน้าอกสาวรอบแรกเกิดขึ้นที่เกาะ', name: 'h.mp3', blob: new Blob(['x'], { type: 'audio/mpeg' }) })`);
  await main.page.click('nav [data-tab=script]');
  await main.page.click('#histBtn'); await main.page.waitForTimeout(600);
  check('ประวัติบท: บทที่เคยสร้างเสียงมีป้าย "มีเสียง"', await main.page.evaluate(() => { const t = document.querySelector('#histList [data-vo="smokeclip"]'); return !!t && !t.hidden && t.textContent.includes('มีเสียง'); }));
  await main.page.click('#histClose');
  await main.page.click('#histBtn'); await main.page.waitForTimeout(300);
  check('ประวัติบท: ปุ่มลบซ่อนไว้ แตะสามจุดเปิด แตะซ้ำปิด', await main.page.evaluate(async () => { const r = document.querySelector('#histList .hrow'), d = r.querySelector('.hdel'), m = r.querySelector('[data-more]'); const hid = getComputedStyle(d).display === 'none'; m.click(); const sh = getComputedStyle(d).display !== 'none'; m.click(); return hid && sh && getComputedStyle(d).display === 'none'; }));
  await main.page.click('#histClose');
  await finishPage(main);
  // หน้าซับ (?voice=)
  const sub = await open('/sub/?voice=1700000000001', 'หน้าซับ');
  await sub.page.waitForTimeout(1500);
  check('หน้าซับ: ?voice= ใส่เสียงและบทให้', (await sub.page.textContent('#fileInfo')).includes('take.mp3') && (await sub.page.inputValue('#rawScript')) === 'บทของเทคนี้');
  const subAlign = await sub.page.evaluate(() => { const c = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }; return Math.abs(c(document.querySelector('.back-link')) - c(document.querySelector('.topbar h1'))); });
  check('หน้าซับ: ปุ่มย้อนกลับกับชื่อหน้าอยู่กึ่งกลางแนวเดียวกัน', subAlign < 3, `ต่างกัน ${subAlign.toFixed(1)}px`);
  await finishPage(sub);
  // หน้าฟุตเทจ (?voice=)
  const foot = await open('/footage.html?voice=1700000000001', 'หน้าฟุตเทจ');
  await foot.page.waitForTimeout(1200);
  check('หน้าฟุตเทจ: ?voice= ไปแท็บผู้กำกับ เลือกเสียงให้', (await foot.page.evaluate(() => document.querySelector('#p-plan').classList.contains('on'))) && (await foot.page.textContent('#plVoiceBtn')).includes('take.mp3') && !(await foot.page.textContent('#plVoiceBtn')).includes('ไม่ใส่เสียง'));
  check('หน้าฟุตเทจ: ไม่มี select/datalist ของเบราว์เซอร์', (await foot.page.evaluate(() => document.querySelectorAll('select,datalist,[list]').length)) === 0);
  await foot.page.click('#plModeBtn'); check('หน้าฟุตเทจ: ช่องเลือกแบบเปิดชีตของแอพ', (await foot.page.evaluate(() => document.querySelectorAll('#pkList .alrow').length)) === 2); await foot.page.click('#pkDone');
  const footAlign = await foot.page.evaluate(() => { const c = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }; return Math.abs(c(document.querySelector('header a.back')) - c(document.querySelector('header h1'))); });
  check('หน้าฟุตเทจ: ปุ่มย้อนกลับกับชื่อหน้าอยู่กึ่งกลางแนวเดียวกัน', footAlign < 3, `ต่างกัน ${footAlign.toFixed(1)}px`);
  await foot.page.click('nav button[data-p="set"]'); await foot.page.waitForTimeout(300);
  await finishPage(foot);
} finally { await browser.close(); server.close(); }
const bad = results.filter((x) => !x.ok);
console.log(`\n${bad.length ? 'มี ' + bad.length + ' ข้อไม่ผ่าน' : 'ผ่านทั้งหมด'} (${results.length} ข้อ)`);
process.exit(bad.length ? 1 : 0);
