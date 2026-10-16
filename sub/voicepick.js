// voicepick.js — เลือกเสียงที่เจนไว้ในแอพหลัก (MWVoice ในเครื่อง + คลัง R2 ที่ยังไม่ได้ดึงมา) แยกออกจาก app.js (v1.16)
// ทางเข้า 2 ทาง: ปุ่ม "เลือกจากเสียงที่เจนไว้ในแอพ" และลิงก์ ?voice=รหัส จากปุ่ม "ทำซับ" ในแท็บเสียงของแอพหลัก
// loadAudioFile = ตัวเดียวกับตอนแนบไฟล์ (app.js) · rawScriptInput = ช่องสคริปต์ดิบ · fileInfo = กล่องชื่อไฟล์
import { escapeHtml } from './ui.js?v=5.4';

export function setupVoicePicker({ loadAudioFile, rawScriptInput, fileInfo }){
  const pickVoiceBtn = document.getElementById('pickVoiceBtn');
  const voiceModalBackdrop = document.getElementById('voiceModalBackdrop');
  const voiceList = document.getElementById('voiceList');
  const closeVoiceModal = () => voiceModalBackdrop.classList.remove('show');
  document.getElementById('voiceCloseBtn').addEventListener('click', closeVoiceModal);
  voiceModalBackdrop.addEventListener('click', (e) => { if (e.target === voiceModalBackdrop) closeVoiceModal(); });
  pickVoiceBtn.addEventListener('click', async () => {
    voiceModalBackdrop.classList.add('show');
    voiceList.textContent = 'กำลังโหลด...';
    const V = window.MWVoice;
    if (!V) { voiceList.textContent = 'โหลดระบบเสียงของแอพไม่ได้ ลองรีเฟรชหน้า'; return; }
    let local = [], cloudOnly = [];
    try { local = await V.list(); } catch (err) { /* ไม่มีเสียงในเครื่อง */ }
    if (V.cloudOn()) {
      try { cloudOnly = (await V.cloudList()).filter(c => !local.some(v => v.id === c.id)); } catch (err) { /* คลังเปิดไม่ได้ ใช้เฉพาะในเครื่อง */ }
    }
    if (!local.length && !cloudOnly.length) { voiceList.textContent = 'ยังไม่มีเสียงที่เจนไว้ สร้างเสียงที่แอพหลัก (แท็บ เสียง) ก่อน'; return; }
    const when = (id) => new Date(id).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    voiceList.innerHTML = local.map(v => `<button type="button" class="voice-item" data-id="${v.id}"><b>${escapeHtml(v.name || 'เสียง')} · ${when(v.id)}</b><small>${escapeHtml((v.text || '').replace(/\s+/g, ' ').slice(0, 60))}</small></button>`).join('')
      + cloudOnly.map(c => `<button type="button" class="voice-item" data-id="${c.id}" data-cloud="1"><b>จากคลัง · ${when(c.id)}</b><small>ยังไม่ได้ดึงมาเครื่องนี้ (${(c.size / 1048576).toFixed(1)} MB)</small></button>`).join('');
  });
  voiceList.addEventListener('click', async (e) => {
    const item = e.target.closest('.voice-item');
    if (!item) return;
    const note = item.querySelector('small');
    try {
      note.textContent = 'กำลังเปิดเสียง...';
      await useVoice(Number(item.dataset.id));
      closeVoiceModal();
    } catch (err) {
      note.textContent = `เปิดไม่ได้: ${err.message || err}`;
    }
  });
  // ใช้เทคเสียงที่เจนไว้ (ทั้งจากรายการด้านบน และจากปุ่ม "ทำซับจอเขียว" ในแท็บเสียงของแอพหลัก ผ่าน ?voice=รหัส)
  async function useVoice(id){
    const rec = (await window.MWVoice.get(id)) || (await window.MWVoice.pull(id));
    if (!rec || !rec.blob) throw new Error('ไม่เจอไฟล์เสียงนี้');
    const name = (rec.name || String(id)).replace(/\.[^.]+$/, '');
    await loadAudioFile(new File([rec.blob], `${name}.mp3`, { type: 'audio/mpeg' }), { fromApp: true });
    // บทของเทคนี้ = บทที่ใช้เจนเสียงนี้ ใส่ช่อง "สคริปต์ดิบ" ให้เลย (ทับของเดิม เพราะเสียงกับบทต้องเป็นชุดเดียวกัน)
    if (rec.text && rec.text.trim()) {
      rawScriptInput.value = rec.text.trim();
      fileInfo.insertAdjacentHTML('beforeend', ' <span class="badge">ใส่บทของเสียงนี้ให้แล้ว</span>');
    }
  }
  const voiceFromUrl = new URLSearchParams(location.search).get('voice');
  if (voiceFromUrl) {
    history.replaceState(null, '', location.pathname); // กันรีเฟรชแล้วโหลดซ้ำ
    useVoice(Number(voiceFromUrl)).catch((err) => {
      fileInfo.innerHTML = `เปิดเสียงที่เลือกไม่ได้: ${escapeHtml(err.message || String(err))}`;
      fileInfo.classList.add('show');
    });
  }
}
