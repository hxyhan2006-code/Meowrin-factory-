// เลขรุ่นของทั้งระบบ (หน้าหลัก + ฟุตเทจ + ซับ) ใช้เลขเดียว แสดงที่ท้ายแท็บตั้งค่า "meowrin factory v?.?"
// ใช้: node bump-version.mjs 2.1      บวกเลขรุ่นทุกจุดให้ตรงกัน (version.js + ?v= ของทุกไฟล์ .js/.css ใน html และโมดูลหน้าซับ)
//      node bump-version.mjs --check   ตรวจว่าทุกจุดเป็นเลขเดียวกัน
// ต้องรันก่อน push ทุกครั้ง ไม่งั้นมือถือแคชไฟล์เก่าผสมไฟล์ใหม่ หน้าจะเพี้ยน
import { readFileSync, writeFileSync } from 'node:fs';

const STAMP = /(\.(?:js|css|png|json)\?v=)([\w.]+)/g; // รวมไอคอน (.png) และ manifest.json ด้วย ไม่งั้นมือถือจำไอคอนเก่า · ลิงก์ YouTube (watch?v=) ไม่ตรงรูปแบบนี้
const FILES = ['manifest.json', 'index.html', 'footage.html', 'sub/index.html', 'sub/app.js', 'sub/media.js', 'sub/waveform.js', 'sub/voicepick.js'];
const VERSION_JS = ['version.js', /(var VERSION = ")([\w.]+)(")/g];

const arg = process.argv[2];
if (!arg || (arg !== '--check' && !/^\d+\.\d+$/.test(arg))) {
  console.error('ใช้: node bump-version.mjs 2.1   หรือ   node bump-version.mjs --check');
  process.exit(1);
}

const found = [];
function scan(file, re, suffix) { // suffix = null → แค่ตรวจ · ไม่ใช่ null → เขียนเลขรุ่นใหม่ลงไฟล์ (ต่อท้ายด้วย suffix)
  let text = readFileSync(file, 'utf-8');
  const hits = [...text.matchAll(re)];
  if (hits.length === 0) { console.error('ไม่พบเลขรุ่นใน', file); process.exit(1); }
  hits.forEach((m) => found.push([file, m[0], m[2]]));
  if (suffix !== null) writeFileSync(file, text.replace(re, `$1${arg}${suffix}`));
}
for (const f of FILES) scan(f, STAMP, arg === '--check' ? null : '');
scan(VERSION_JS[0], VERSION_JS[1], arg === '--check' ? null : '$3');

const versions = new Set(found.map((f) => f[2]));
if (arg === '--check') {
  if (versions.size === 1) console.log(`เลขรุ่นตรงกันทุกจุด: v${[...versions][0]} (${found.length} จุด)`);
  else { console.error('เลขรุ่นไม่ตรงกัน:'); found.forEach((f) => console.error(' ', f[0], f[1])); process.exit(1); }
} else {
  console.log(`บวกเป็น v${arg} แล้ว ${found.length} จุด`);
}
