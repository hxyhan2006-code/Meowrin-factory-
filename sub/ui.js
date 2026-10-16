// ui.js — ชิ้นส่วนหน้าจอที่ไม่ผูกกับ state ของแอพ แยกออกจาก app.js (v1.16)
// setupFineSlider = สไลเดอร์ลากละเอียดในกล่องสไตล์ · createStagedProgress = แถบคืบหน้าของ "แยกบรรทัดด้วย AI"
// escapeHtml / getReliableDuration = ตัวช่วยเล็กๆ

  // ---------- custom fine-step slider (drag the round thumb only; tapping
  // the bar itself does nothing — that's the point) ----------
  export function setupFineSlider({ trackWrapId, thumbId, fillId, minusBtnId, plusBtnId, min, max, step, initial, valueLabelEl, onChange }){
    const trackWrap = document.getElementById(trackWrapId);
    const thumb = document.getElementById(thumbId);
    const fill = document.getElementById(fillId);
    const minusBtn = document.getElementById(minusBtnId);
    const plusBtn = document.getElementById(plusBtnId);
    let value = initial;

    function clamp(v){ return Math.min(max, Math.max(min, v)); }
    function pctFor(v){ return ((v - min) / (max - min)) * 100; }

    function render(){
      const pct = pctFor(value);
      thumb.style.left = pct + '%';
      fill.style.width = pct + '%';
      if (valueLabelEl) valueLabelEl.textContent = String(value);
    }

    function setValue(raw, fire){
      const stepped = Math.round(raw / step) * step;
      const v = clamp(stepped);
      const changed = v !== value;
      value = v;
      render();
      if (fire && changed) onChange(value);
    }

    // Dragging starts ONLY from a pointerdown on the thumb itself — tapping
    // anywhere else on the track is intentionally inert.
    let dragging = false;
    thumb.addEventListener('pointerdown', (e) => {
      dragging = true;
      thumb.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = trackWrap.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      setValue(min + ratio * (max - min), true);
    });
    function endDrag(e){
      if (!dragging) return;
      dragging = false;
      try { thumb.releasePointerCapture(e.pointerId); } catch (_){}
    }
    thumb.addEventListener('pointerup', endDrag);
    thumb.addEventListener('pointercancel', endDrag);

    minusBtn.addEventListener('click', () => setValue(value - step, true));
    plusBtn.addEventListener('click', () => setValue(value + step, true));

    render();
    return { get: () => value };
  }

  // ---------- staged progress bar (ใช้กับ "แยกบรรทัดด้วย AI") ----------
  // wrap/fill/pctEl = แถบในหน้า · status = { show(msg), hide() } บรรทัดสถานะใต้แถบ
  export function createStagedProgress({ wrap, fill, pctEl, status }){
    // ---------- AI split progress bar: staged milestones (15 -> 45 -> 85 -> 100) with a gentle
    // creep toward each milestone so the bar keeps moving and never looks frozen ----------
    let asProgress = 0, asTarget = 0, asCreepId = null, asHideTimer = null, asRemoveTimer = null;
    function renderAutoSplitProgress(){
      const p = Math.max(0, Math.min(100, Math.round(asProgress)));
      fill.style.width = p + '%';
      pctEl.textContent = p + '%';
    }
    function stopAutoSplitCreep(){ if (asCreepId){ clearInterval(asCreepId); asCreepId = null; } }
    function clearAutoSplitTimers(){
      stopAutoSplitCreep();
      if (asHideTimer){ clearTimeout(asHideTimer); asHideTimer = null; }
      if (asRemoveTimer){ clearTimeout(asRemoveTimer); asRemoveTimer = null; }
    }
    function beginAutoSplitProgress(){
      clearAutoSplitTimers();
      asProgress = 15; asTarget = 15;
      wrap.classList.remove('fading');
      wrap.classList.add('show');
      renderAutoSplitProgress();
      status.show('กำลังเตรียมไฟล์เสียง...');
    }
    // move toward a milestone: snap forward quickly, then keep creeping so it never looks stuck
    function autoSplitProgressTo(target){
      asTarget = target;
      stopAutoSplitCreep();
      asCreepId = setInterval(() => {
        const gap = asTarget - asProgress;
        asProgress = gap < 0.4 ? asTarget : asProgress + gap * 0.1;
        renderAutoSplitProgress();
        if (asProgress >= asTarget) stopAutoSplitCreep();
      }, 300);
    }
    function finishAutoSplitProgress(){
      stopAutoSplitCreep();
      asProgress = 100; renderAutoSplitProgress();
      status.show('เสร็จแล้ว');
      asHideTimer = setTimeout(() => {
        wrap.classList.add('fading');
        status.hide();
        asRemoveTimer = setTimeout(() => {
          wrap.classList.remove('show', 'fading');
        }, 500);
      }, 900);
    }
    function failAutoSplitProgress(){
      clearAutoSplitTimers();
      wrap.classList.remove('show', 'fading');
      status.hide();
    }
    return {
      begin: beginAutoSplitProgress,
      to: autoSplitProgressTo,
      atLeast(p){ asProgress = Math.max(asProgress, p); renderAutoSplitProgress(); }, // ข้ามไปอย่างน้อย p% ทันที (ขั้นก่อนหน้าเสร็จแล้ว)
      finish: finishAutoSplitProgress,
      fail: failAutoSplitProgress
    };
  }

  export function escapeHtml(s){
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Chrome/Android sometimes reports duration=Infinity for blob-URL media
  // until the element is seeked once. Force a real duration value.
  export function getReliableDuration(mediaEl){
    return new Promise((resolve) => {
      if (isFinite(mediaEl.duration) && mediaEl.duration > 0){
        resolve(mediaEl.duration);
        return;
      }
      const onTimeUpdate = () => {
        mediaEl.removeEventListener('timeupdate', onTimeUpdate);
        mediaEl.currentTime = 0;
        resolve(isFinite(mediaEl.duration) ? mediaEl.duration : 0);
      };
      mediaEl.addEventListener('timeupdate', onTimeUpdate);
      mediaEl.currentTime = 1e10;
    });
  }
