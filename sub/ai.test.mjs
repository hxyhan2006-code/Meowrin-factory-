// รันด้วย: node ai.test.mjs
// ทดสอบการเลือกโมเดล Gemini ใน ai.js (จำลอง fetch ไม่ได้เรียก API จริง ไม่เสียเงิน)
import assert from 'node:assert/strict';
import { GEMINI_MODELS, DEFAULT_GEMINI_MODEL, callGeminiSplit, removeThaiSpaces } from './ai.js';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ผ่าน:', name); }

async function urlUsed(model) {
  let url = null;
  globalThis.fetch = async (u) => {
    url = u;
    return { ok: true, text: async () => '', json: async () => ({ candidates: [{ content: { parts: [{ text: 'บรรทัด' }] } }] }) };
  };
  await callGeminiSplit('K E', 'สคริปต์', 'a [PAUSE] b', false, 2, 3, model);
  return url;
}

await test('มีโมเดลให้เลือก 3 ตัว id ไม่ซ้ำ ตัวแรกคือค่าเริ่มต้น (3.8 Flash)', () => {
  assert.equal(GEMINI_MODELS.length, 3);
  assert.equal(new Set(GEMINI_MODELS.map(m => m.id)).size, 3);
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
  for (const m of GEMINI_MODELS) assert.ok(m.id && m.label && m.name);
});

await test('เลือกโมเดลไหน คำขอไปที่โมเดลนั้น (และ key ถูกเข้ารหัสใน URL)', async () => {
  for (const m of GEMINI_MODELS) {
    assert.equal(await urlUsed(m.id), `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=K%20E`);
  }
});

await test('ไม่ระบุหรือชื่อที่ไม่รู้จัก -> ใช้ค่าเริ่มต้น ไม่ยิงไปที่ชื่อมั่ว', async () => {
  const expected = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent?key=K%20E`;
  assert.equal(await urlUsed(undefined), expected);
  assert.equal(await urlUsed('gemini-ที่ไม่มี'), expected);
  assert.equal(await urlUsed('../evil'), expected);
});

await test('ตัดเว้นวรรคระหว่างไทยกับไทย แต่คงข้างตัวเลข/อังกฤษ', () => {
  assert.equal(removeThaiSpaces('เริ่มจาก นามิ'), 'เริ่มจากนามิ');
  assert.equal(removeThaiSpaces('โบอา  แฮนค็อก'), 'โบอาแฮนค็อก');
  assert.equal(removeThaiSpaces('2 ครั้งที่'), '2 ครั้งที่');
  assert.equal(removeThaiSpaces('ลูฟี่ Gear 5'), 'ลูฟี่ Gear 5');
  assert.equal(removeThaiSpaces('[AI] กับ โรบิน'), '[AI] กับโรบิน');
  assert.equal(removeThaiSpaces('นี่คือ 2 ครั้ง'), 'นี่คือ 2 ครั้ง');
  assert.equal(removeThaiSpaces('จังหวะ\u2009แอบ\u3000พา\u202fลูฟี่'), 'จังหวะแอบพาลูฟี่'); // ช่องว่างแบบอื่นๆ (บางๆ/เต็มความกว้าง/ไม่ตัดบรรทัด)
  assert.equal(removeThaiSpaces('เริ่มจาก นามิ\nกับ โรบิน'), 'เริ่มจากนามิ\nกับโรบิน');
  assert.equal(removeThaiSpaces(null), '');
});

// ---------- สำรอง OpenRouter ----------
function mockFetch(handler) { const calls = []; globalThis.fetch = async (u, o) => { calls.push(u); return handler(u, o); }; return calls; }
const gemOk = () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'จาก Gemini' }] } }] }) });
const gemErr = (st) => ({ ok: false, status: st, text: async () => 'quota', json: async () => ({}) });
const orOk = (cost) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'จาก OR' } }], usage: { cost } }) });
const mkFb = (extra = {}) => { const log = { added: 0, notes: [], checks: 0 }; return { log, fb: { orKey: 'OR', check: () => log.checks++, add: (x) => (log.added += x), onFallback: (m) => log.notes.push(m), ...extra } }; };
const run = (key, fb) => callGeminiSplit(key, 'ส', 'a', false, 2, 3, 'gemini-3.8-flash', fb);

await test('Gemini ใช้ได้ -> ไม่แตะ OpenRouter ไม่เสียเงิน', async () => {
  const calls = mockFetch((u) => (u.includes('openrouter') ? orOk(1) : gemOk())); const { fb, log } = mkFb();
  assert.equal(await run('K', fb), 'จาก Gemini');
  assert.equal(calls.length, 1); assert.equal(log.checks, 0);
});

await test('Gemini โควต้าเต็ม (429) / ล่ม (503) / ต่อไม่ได้ -> ถอยไป OpenRouter โมเดลเดียวกัน บันทึกค่าใช้จ่าย', async () => {
  for (const mode of [429, 503, 'net']) {
    let body = null;
    const calls = mockFetch((u, o) => {
      if (u.includes('openrouter')) { body = JSON.parse(o.body); return orOk(0.002); }
      if (mode === 'net') throw new TypeError('fetch failed');
      return gemErr(mode);
    });
    const { fb, log } = mkFb();
    assert.equal(await run('K', fb), 'จาก OR');
    assert.equal(body.model, 'google/gemini-3.8-flash'); assert.equal(calls.length, 2);
    assert.equal(log.added, 0.002); assert.equal(log.checks, 1); assert.equal(log.notes.length, 1);
  }
});

await test('ไม่มี OpenRouter key -> error ของ Gemini เดิม ไม่เรียก OpenRouter', async () => {
  const calls = mockFetch(() => gemErr(429));
  await assert.rejects(run('K', null), /Gemini API error \(429\)/);
  assert.equal(calls.length, 1);
});

await test('ไม่มี Gemini key แต่มี OpenRouter -> ใช้ OpenRouter เลย', async () => {
  const calls = mockFetch(() => orOk(0)); const { fb } = mkFb();
  assert.equal(await run('', fb), 'จาก OR'); assert.equal(calls.length, 1); assert.ok(calls[0].includes('openrouter'));
});

await test('เกินเพดานค่าใช้จ่าย -> หยุด ไม่ยิง OpenRouter', async () => {
  const calls = mockFetch((u) => (u.includes('openrouter') ? orOk(1) : gemErr(429)));
  const { fb } = mkFb({ check: () => { throw new Error('ถึงเพดาน'); } });
  await assert.rejects(run('K', fb), /ถึงเพดาน/); assert.equal(calls.length, 1);
});

await test('OpenRouter เครดิตหมด (402) -> ข้อความชัด', async () => {
  mockFetch((u) => (u.includes('openrouter') ? { ok: false, status: 402, json: async () => ({ error: { message: 'x' } }) } : gemErr(429)));
  const { fb } = mkFb();
  await assert.rejects(run('K', fb), /เครดิต OpenRouter ไม่พอ/);
});

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`);
