import { alignLinesToWords, refineSegmentBoundariesWithEnergy } from './aligner.js?v=5.4';
import { buildSrt } from './srt.js?v=5.4';
import { callGroqWhisper, buildTranscriptForGemini, callGeminiSplit, removeThaiSpaces, GEMINI_MODELS, DEFAULT_GEMINI_MODEL } from './ai.js?v=5.4';
import { loadMediabunny, decodeAudioFile, isVideoFile, extractAudioFromVideo, audioBufferToWavBlob } from './media.js?v=5.4';
import { CANVAS_W, FONT_FAMILY, BOTTOM_MARGIN_RATIO, renderVideo } from './render.js?v=5.4';
import { createTrimEditor } from './waveform.js?v=5.4';
import { setupFineSlider, createStagedProgress, escapeHtml, getReliableDuration } from './ui.js?v=5.4';
import { setupVoicePicker } from './voicepick.js?v=5.4';

// ===== ที่เก็บข้อมูลร่วมกับแอพหลัก (MWStore จาก ../store.js) — service worker ของแอพหลักคุมหน้านี้อยู่แล้ว =====
  const S = window.MWStore;
  await S.ready;
  // สคริปต์ของแอพหลักที่หน้านี้ยืมใช้ — โหลดหลังข้อมูลพร้อม ถ้าโหลดไม่ได้ก็ใช้ต่อได้ (budget = เพดานค่า AI ตอนถอยไป OpenRouter · r2 + voicestore = เสียงที่เจนไว้)
  for (const src of ['../budget.js?v=5.4', '../r2.js?v=5.4', '../voicestore.js?v=5.4']) {
    await new Promise((ok) => { const el = document.createElement('script'); el.src = src; el.onload = el.onerror = ok; document.body.appendChild(el); });
  }
  const GROQ_KEY = 'mw_groq_key_v1', GEMINI_KEY = 'mw_gemini_key_v1', OR_KEY = 'mw_openrouter_key_v1', SUB_CFG = 'mw_sub_cfg_v1'; // key ตั้งที่แอพหลัก > ตั้งค่า
  // ย้าย key จากแอปซับตัวเก่าครั้งเดียว (ถ้าเคยเปิดบนโดเมนเดียวกัน) — ครั้งต่อไปอ่านจาก MWStore อย่างเดียว
  [[GROQ_KEY, 'groq_api_key'], [GEMINI_KEY, 'gemini_api_key']].forEach(([k, old]) => {
    if (S.get(k, '')) return;
    try { const v = (localStorage.getItem(old) || '').trim(); if (v) S.set(k, v); } catch (e) {}
  });
  const readKey = (k) => String(S.get(k, '') || '').trim();
  const subCfg = (k) => (S.get(SUB_CFG, {}) || {})[k];
  const setSubCfg = (k, v) => { const c = S.get(SUB_CFG, {}) || {}; c[k] = v; S.set(SUB_CFG, c); };

  // ---------- constants ----------
  let FONT_PX = 74;   // user-adjustable via the style card (was a fixed const)
  let STROKE_PX = 10; // user-adjustable via the style card (was a fixed const)
  let SYNC_OFFSET_MS = 0; // user-adjustable manual correction for sub-vs-audio timing drift

  // ---------- elements ----------
  const rawScriptInput = document.getElementById('rawScript');
  const autoSplitBtn = document.getElementById('autoSplitBtn');
  const autoSplitStatusRow = document.getElementById('autoSplitStatusRow');
  const autoSplitStatusText = document.getElementById('autoSplitStatusText');
  const autoSplitStatsEl = document.getElementById('autoSplitStats');
  const autoSplitErrorBox = document.getElementById('autoSplitErrorBox');
  const whisperHintTermsInput = document.getElementById('whisperHintTerms');
  const scriptModeHint = document.getElementById('scriptModeHint');
  const wordRangeCustomInput = document.getElementById('wordRangeCustom');
  const fileDrop = document.getElementById('fileDrop');
  const audioFileInput = document.getElementById('audioFile');
  const fileInfo = document.getElementById('fileInfo');
  const audioEl = document.getElementById('audioEl');
  const editedScript = document.getElementById('editedScript');
  const fontSizeVal = document.getElementById('fontSizeVal');
  const strokeWidthVal = document.getElementById('strokeWidthVal');
  const stylePreviewCanvas = document.getElementById('stylePreviewCanvas');
  const startBtn = document.getElementById('startBtn');
  const statusRow = document.getElementById('statusRow');
  const statusText = document.getElementById('statusText');
  const errorBox = document.getElementById('errorBox');
  const resultCard = document.getElementById('resultCard');
  const previewVideo = document.getElementById('previewVideo');
  const dlVideo = document.getElementById('dlVideo');
  const dlSrt = document.getElementById('dlSrt');
  const canvas = document.getElementById('renderCanvas');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
  const settingsSaveBtn = document.getElementById('settingsSaveBtn');
  const pasteBtn = document.getElementById('pasteBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const progressPct = document.getElementById('progressPct');
  const trimCard = document.getElementById('trimCard');
  const clearScriptBtn = document.getElementById('clearScriptBtn');
  const scriptErrorBox = document.getElementById('scriptErrorBox');
  const pasteRawBtn = document.getElementById('pasteRawBtn');
  const clearRawBtn = document.getElementById('clearRawBtn');
  const rawErrorBox = document.getElementById('rawErrorBox');
  const scriptLineCount = document.getElementById('scriptLineCount');

  // unified 1:1 stage (tab 3): style preview canvas <-> result video
  const stage = document.getElementById('stage');
  const stageSwitch = document.getElementById('stageSwitch');
  const stageSwitchBtns = Array.from(stageSwitch.querySelectorAll('button'));
  let hasResult = false;
  function setStageView(view){
    stage.dataset.view = view;
    stageSwitchBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view !== 'video') previewVideo.pause();
  }
  stageSwitchBtns.forEach(b => b.addEventListener('click', () => setStageView(b.dataset.view)));


  const trim = createTrimEditor({ audioEl, trimCard }); // กล่องตัดท่อนเสียง (waveform.js)
  let selectedFile = null;

  // ---------- word-range preset chips + custom input (target line length for
  // AI split — a guideline passed into the Gemini prompt, not a hard cap; the
  // prompt itself tells Gemini it may exceed either edge when context calls
  // for it) ----------
  let WORD_RANGE_MIN = 2, WORD_RANGE_MAX = 3; // default matches the tool's original fixed target
  const wordRangeChips = document.querySelectorAll('#wordRangeChips .chip-btn');
  function setWordRangeActive(min, max, persist){
    WORD_RANGE_MIN = min; WORD_RANGE_MAX = max;
    wordRangeChips.forEach(btn => {
      const isActive = Number(btn.dataset.min) === min && Number(btn.dataset.max) === max;
      btn.classList.toggle('active', isActive);
    });
    if (persist) setSubCfg('wordRange', `${min}-${max}`);
  }
  (function initWordRange(){
    const saved = subCfg('wordRange');
    const m = saved && saved.match(/^(\d+)-(\d+)$/);
    if (m){
      const mn = Number(m[1]), mx = Number(m[2]);
      const matchesPreset = Array.from(wordRangeChips).some(btn => Number(btn.dataset.min) === mn && Number(btn.dataset.max) === mx);
      if (matchesPreset){ setWordRangeActive(mn, mx, false); }
      else { WORD_RANGE_MIN = mn; WORD_RANGE_MAX = mx; wordRangeCustomInput.value = `${mn}-${mx}`; }
    } else {
      setWordRangeActive(2, 3, false);
    }
  })();
  wordRangeChips.forEach(btn => {
    btn.addEventListener('click', () => {
      wordRangeCustomInput.value = '';
      setWordRangeActive(Number(btn.dataset.min), Number(btn.dataset.max), true);
    });
  });
  wordRangeCustomInput.addEventListener('input', () => {
    const m = wordRangeCustomInput.value.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) return;
    const mn = Number(m[1]), mx = Number(m[2]);
    if (mn < 1 || mx < mn) return;
    WORD_RANGE_MIN = mn; WORD_RANGE_MAX = mx;
    wordRangeChips.forEach(btn => btn.classList.remove('active'));
    setSubCfg('wordRange', `${mn}-${mx}`);
  });

  // ---------- script-reference mode: strict (use only the user's own script
  // text, silently skip audio the script doesn't cover) vs fill (use Whisper's
  // transcript to cover gaps the script doesn't have text for, or the whole
  // clip if the raw script is empty) — default is strict, the safer option ----------
  let SCRIPT_FILL_MODE = false;
  const scriptModeChips = document.querySelectorAll('#scriptModeChips .chip-btn');
  const SCRIPT_MODE_STRICT_HINT = 'ใช้เฉพาะคำที่คุณเขียนมาเป๊ะๆ ช่วงเสียงที่สคริปต์ไม่ครอบคลุมจะถูกข้ามไปเงียบๆ ไม่แต่งเติมเอง (ปลอดภัยกว่า แนะนำถ้าเขียนสคริปต์มาครบแล้ว)';
  const SCRIPT_MODE_FILL_HINT = 'ช่วงที่สคริปต์ไม่ครอบคลุม จะดึงคำจาก Whisper มาเติมแทน และขึ้นต้นบรรทัดนั้นด้วย [AI] ให้สังเกตง่าย (ถ้าเว้นสคริปต์ว่างทั้งหมด ทุกบรรทัดจะขึ้น [AI]) Whisper อาจฟังผิดคำได้ — ตรวจทานก่อนใช้จริงเสมอ';
  function setScriptMode(mode, persist){
    SCRIPT_FILL_MODE = mode === 'fill';
    scriptModeChips.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    scriptModeHint.textContent = SCRIPT_FILL_MODE ? SCRIPT_MODE_FILL_HINT : SCRIPT_MODE_STRICT_HINT;
    if (persist) setSubCfg('scriptMode', mode);
  }
  (function initScriptMode(){
    const saved = subCfg('scriptMode');
    setScriptMode(saved === 'fill' ? 'fill' : 'strict', false);
  })();
  scriptModeChips.forEach(btn => btn.addEventListener('click', () => setScriptMode(btn.dataset.mode, true)));

  // ---------- Gemini model picker (in the API settings modal) ----------
  let GEMINI_MODEL_ID = DEFAULT_GEMINI_MODEL;
  const geminiModelChips = document.getElementById('geminiModelChips');
  GEMINI_MODELS.forEach(m => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-btn';
    btn.dataset.model = m.id;
    btn.innerHTML = `${m.label}<small>${m.name}</small>`;
    btn.addEventListener('click', () => setGeminiModel(m.id, true));
    geminiModelChips.appendChild(btn);
  });
  function setGeminiModel(id, persist){
    GEMINI_MODEL_ID = GEMINI_MODELS.some(m => m.id === id) ? id : DEFAULT_GEMINI_MODEL;
    geminiModelChips.querySelectorAll('.chip-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.model === GEMINI_MODEL_ID));
    if (persist) setSubCfg('geminiModel', GEMINI_MODEL_ID);
  }
  setGeminiModel(subCfg('geminiModel'), false);

  // ---------- settings modal (เลือกโมเดล Gemini · key อยู่ที่แอพหลัก) ----------
  function openSettingsModal(){
    settingsModalBackdrop.classList.add('show');
  }
  function closeSettingsModal(){
    settingsModalBackdrop.classList.remove('show');
  }
  settingsBtn.addEventListener('click', openSettingsModal);
  settingsSaveBtn.addEventListener('click', () => {
    closeSettingsModal();
  });
  settingsModalBackdrop.addEventListener('click', (e) => {
    if (e.target === settingsModalBackdrop) closeSettingsModal();
  });


  // ---------- text style controls (font size / stroke width) ----------
  const PREVIEW_SCALE = stylePreviewCanvas.width / CANVAS_W; // keep preview proportional to the real 1080px-wide render
  const PREVIEW_SAMPLE_TEXT = 'ตัวอย่างข้อความซับ';

  function drawStylePreview(){
    const pctx = stylePreviewCanvas.getContext('2d');
    const w = stylePreviewCanvas.width, h = stylePreviewCanvas.height;
    pctx.clearRect(0, 0, w, h);
    pctx.fillStyle = '#00FF00';
    pctx.fillRect(0, 0, w, h);
    const fpx = Math.max(6, FONT_PX * PREVIEW_SCALE);
    const spx = Math.max(0, STROKE_PX * PREVIEW_SCALE);
    pctx.font = `700 ${fpx}px "${FONT_FAMILY}"`;
    pctx.textAlign = 'center';
    pctx.textBaseline = 'alphabetic';
    pctx.lineJoin = 'round';
    pctx.miterLimit = 2;
    pctx.lineWidth = spx;
    pctx.strokeStyle = '#000000';
    pctx.fillStyle = '#FFFFFF';
    const py = h - h * BOTTOM_MARGIN_RATIO; // same baseline rule as drawFrame()
    if (spx > 0) pctx.strokeText(PREVIEW_SAMPLE_TEXT, w / 2, py);
    pctx.fillText(PREVIEW_SAMPLE_TEXT, w / 2, py);
  }

  const savedFontPxRaw = subCfg('fontPx');
  const initialFontPx = savedFontPxRaw != null && !Number.isNaN(Number(savedFontPxRaw)) ? Number(savedFontPxRaw) : FONT_PX;
  const savedStrokePxRaw = subCfg('strokePx');
  const initialStrokePx = savedStrokePxRaw != null && !Number.isNaN(Number(savedStrokePxRaw)) ? Number(savedStrokePxRaw) : STROKE_PX;

  setupFineSlider({
    trackWrapId: 'fontSizeTrackWrap', thumbId: 'fontSizeThumb', fillId: 'fontSizeFill',
    minusBtnId: 'fontSizeMinus', plusBtnId: 'fontSizePlus',
    min: 40, max: 130, step: 1, initial: initialFontPx, valueLabelEl: fontSizeVal,
    onChange: (v) => {
      FONT_PX = v;
      setSubCfg('fontPx', v);
      if (hasResult) setStageView('style');
      drawStylePreview();
    }
  });
  FONT_PX = initialFontPx;

  setupFineSlider({
    trackWrapId: 'strokeWidthTrackWrap', thumbId: 'strokeWidthThumb', fillId: 'strokeWidthFill',
    minusBtnId: 'strokeWidthMinus', plusBtnId: 'strokeWidthPlus',
    min: 0, max: 24, step: 1, initial: initialStrokePx, valueLabelEl: strokeWidthVal,
    onChange: (v) => {
      STROKE_PX = v;
      setSubCfg('strokePx', v);
      if (hasResult) setStageView('style');
      drawStylePreview();
    }
  });
  STROKE_PX = initialStrokePx;

  const savedSyncOffsetRaw = subCfg('syncOffsetMs');
  const initialSyncOffsetMs = savedSyncOffsetRaw != null && !Number.isNaN(Number(savedSyncOffsetRaw)) ? Number(savedSyncOffsetRaw) : 0;
  const syncOffsetValEl = document.getElementById('syncOffsetVal');
  setupFineSlider({
    trackWrapId: 'syncOffsetTrackWrap', thumbId: 'syncOffsetThumb', fillId: 'syncOffsetFill',
    minusBtnId: 'syncOffsetMinus', plusBtnId: 'syncOffsetPlus',
    min: -300, max: 300, step: 10, initial: initialSyncOffsetMs, valueLabelEl: syncOffsetValEl,
    onChange: (v) => {
      SYNC_OFFSET_MS = v;
      setSubCfg('syncOffsetMs', v);
    }
  });
  SYNC_OFFSET_MS = initialSyncOffsetMs;

  drawStylePreview();
  document.fonts.ready.then(drawStylePreview).catch(() => {});

  // the style controls live in a collapsed accordion — redraw the preview canvas whenever it opens
  // so it never shows up stale or blank
  document.getElementById('styleAccordion').addEventListener('toggle', (e) => {
    if (e.currentTarget.open){
      drawStylePreview();
      requestAnimationFrame(drawStylePreview);
    }
  });

  // ---------- paste / clear — one pair of buttons per box ----------
  function updateLineCount(){
    const n = editedScript.value.split('\n').filter(l => l.trim()).length;
    scriptLineCount.textContent = n ? `· ${n} บรรทัด` : '';
  }
  editedScript.addEventListener('input', updateLineCount);

  function bindPasteClear(pasteEl, clearEl, textarea, errBox, tidy = (t) => t){
    pasteEl.addEventListener('click', async () => {
      hideError(errBox);
      try {
        const text = await navigator.clipboard.readText();
        if (!text){ showError('คลิปบอร์ดว่างเปล่า — คัดลอกข้อความมาก่อนแล้วค่อยกดวาง', errBox); return; }
        textarea.value = tidy(text);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (err){
        showError('วางอัตโนมัติไม่ได้ (เบราว์เซอร์ไม่อนุญาต clipboard) — ลองกดค้างในช่องแล้วเลือก "วาง" เอง', errBox);
      }
    });
    clearEl.addEventListener('click', () => {
      textarea.value = '';
      hideError(errBox);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  bindPasteClear(pasteRawBtn, clearRawBtn, rawScriptInput, rawErrorBox);
  bindPasteClear(pasteBtn, clearScriptBtn, editedScript, scriptErrorBox, removeThaiSpaces);
  editedScript.addEventListener('change', () => { // พิมพ์/แก้เองในกล่อง 2 เสร็จ (ออกจากช่อง) → ตัดเว้นวรรคไทย-ไทยให้ด้วย
    const t = removeThaiSpaces(editedScript.value);
    if (t !== editedScript.value){ editedScript.value = t; updateLineCount(); }
  });
  clearScriptBtn.addEventListener('click', hideAutoSplitStats); // stats describe the box that was just emptied

  // ---------- 3-step tab wizard (top tabs + sticky footer back/next) ----------
  const tabBtns = Array.from(document.querySelectorAll('.tab'));
  const tabPanels = Array.from(document.querySelectorAll('.panel'));
  const backBtn = document.getElementById('backBtn');
  const nextBtn = document.getElementById('nextBtn');
  let currentTab = 0;
  function goTab(i){
    i = Math.max(0, Math.min(tabPanels.length - 1, i));
    if (i !== 0 && !audioEl.paused) audioEl.pause();
    currentTab = i;
    tabBtns.forEach((b, k) => {
      b.classList.toggle('active', k === i);
      b.setAttribute('aria-selected', String(k === i));
    });
    tabPanels.forEach((p, k) => p.classList.toggle('active', k === i));
    backBtn.disabled = i === 0;
    nextBtn.hidden = i === tabPanels.length - 1;
    window.scrollTo(0, 0);
    // the waveform can't be measured while its tab is display:none — redo layout when it's visible again
    if (i === 0) trim.relayout();
    if (i === 2) drawStylePreview();
  }
  tabBtns.forEach((b, k) => b.addEventListener('click', () => goTab(k)));
  backBtn.addEventListener('click', () => goTab(currentTab - 1));
  nextBtn.addEventListener('click', () => goTab(currentTab + 1));
  goTab(0);
  // ---------- file selection ----------
  fileDrop.addEventListener('click', () => audioFileInput.click());
  audioFileInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadAudioFile(f); });
  // fromApp = เลือกจากเสียงที่เจนไว้ในแอพ → ซ่อนกล่องตัดท่อนเสียงไว้ในแถบพับ (แนบไฟล์จากข้างนอกเปิดไว้เหมือนเดิม)
  async function loadAudioFile(f, { fromApp = false } = {}){

    // reset trim state for the newly selected file up front
    trim.reset();
    fileInfo.classList.remove('show');

    // If the selection is a video file, pull its audio track out first via
    // Mediabunny (the same library already used for muxing the final
    // render) and continue with a plain audio File from that point on —
    // everything downstream (Whisper, waveform, render) only ever sees an
    // audio file, exactly as before, so none of the existing pipeline
    // needs to know a video was ever involved.
    let fileForPipeline = f;
    let extractedBuffer = null;
    if (isVideoFile(f)){
      fileInfo.innerHTML = 'กำลังดึงเสียงออกจากไฟล์วิดีโอ...';
      fileInfo.classList.add('show');
      try {
        extractedBuffer = await extractAudioFromVideo(f);
        const wavBlob = audioBufferToWavBlob(extractedBuffer);
        const baseName = f.name.replace(/\.[^.]+$/, '') || 'video';
        fileForPipeline = new File([wavBlob], `${baseName}_audio.wav`, { type: 'audio/wav' });
      } catch (err){
        console.error(err);
        fileInfo.innerHTML = `ดึงเสียงจากวิดีโอไม่สำเร็จ: ${escapeHtml(err.message || String(err))}`;
        fileInfo.classList.add('show');
        return;
      }
    }

    selectedFile = fileForPipeline;
    audioEl.src = URL.createObjectURL(fileForPipeline);
    await new Promise(res => {
      audioEl.addEventListener('loadedmetadata', res, { once: true });
    });
    const durationSec = await getReliableDuration(audioEl);
    const mins = Math.floor(durationSec / 60);
    const secs = Math.round(durationSec % 60).toString().padStart(2, '0');
    fileInfo.innerHTML = `<b>${escapeHtml(f.name)}</b> · ${mins}:${secs}${extractedBuffer ? ' <span class="badge">ดึงเสียงจากวิดีโอแล้ว</span>' : ''}`;
    fileInfo.classList.add('show');

    // decode for the waveform. If decoding fails (unsupported format on this
    // browser), the app still works normally — trimming is just unavailable.
    // (video files already have their AudioBuffer from the extraction step above)
    try {
      trim.load(extractedBuffer || await decodeAudioFile(fileForPipeline), { open: !fromApp });
    } catch (err){
      console.warn('waveform decode failed, trimming UI unavailable for this file', err);
    }
  }


  setupVoicePicker({ loadAudioFile, rawScriptInput, fileInfo }); // voicepick.js

  // ---------- helpers ----------
  function stripWs(s){
    return s.replace(/\s+/g, '');
  }

  function setStep(el, state){ el.className = state; }
  function showStatus(msg, row = statusRow, textEl = statusText){ row.classList.add('show'); if (textEl) textEl.textContent = msg; }
  function hideStatus(row = statusRow){ row.classList.remove('show'); }
  function showProgress(){ progressWrap.classList.add('show'); setProgress(0); }
  function hideProgress(){ progressWrap.classList.remove('show'); }
  function setProgress(pct){
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    progressFill.style.width = clamped + '%';
    progressPct.textContent = clamped + '%';
  }
  function showError(msg, box = errorBox){ box.textContent = msg; box.classList.add('show'); }
  function hideError(box = errorBox){ box.classList.remove('show'); }



  const asBar = createStagedProgress({
    wrap: document.getElementById('autoSplitProgressWrap'),
    fill: document.getElementById('autoSplitProgressFill'),
    pctEl: document.getElementById('autoSplitProgressPct'),
    status: { show: (m) => showAutoSplitStatus(m), hide: () => hideAutoSplitStatus() }
  });

  function showAutoSplitStatus(msg){ autoSplitStatusRow.classList.add('show'); autoSplitStatusText.textContent = msg; }
  function hideAutoSplitStatus(){ autoSplitStatusRow.classList.remove('show'); }
  function showAutoSplitError(msg){ autoSplitErrorBox.textContent = msg; autoSplitErrorBox.classList.add('show'); }
  function hideAutoSplitError(){ autoSplitErrorBox.classList.remove('show'); }
  function hideAutoSplitStats(){ autoSplitStatsEl.style.display = 'none'; }
  function showAutoSplitStats(splitLines){
    const lines = splitLines.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0){ hideAutoSplitStats(); return; }
    // Thai is normally written with no spaces between words, so a space-split
    // "word count" on the AI's own output would be meaningless here — character
    // count (stripped of whitespace) is the only length measure that's actually
    // comparable to the ${WORD_RANGE_MIN}-${WORD_RANGE_MAX} guideline in a
    // consistent way, so that's what's reported back to the user.
    const lens = lines.map(l => stripWs(l).length);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const max = Math.max(...lens);
    const flagged = lines.filter(l => l.startsWith('[AI]')).length;
    let msg = `ได้ ${lines.length} บรรทัด · เฉลี่ย ${avg.toFixed(1)} ตัวอักษร/บรรทัด (ยาวสุด ${max})`;
    if (flagged > 0) msg += ` · ${flagged} บรรทัดมาจากเสียงล้วนๆ (ไม่มีในสคริปต์ต้นฉบับ) ควรตรวจก่อนใช้จริง`;
    autoSplitStatsEl.textContent = msg;
    autoSplitStatsEl.style.display = 'block';
  }

  autoSplitBtn.addEventListener('click', async () => {
    hideAutoSplitError();
    hideAutoSplitStats();
    const geminiKey = readKey(GEMINI_KEY);
    const groqKey = readKey(GROQ_KEY);
    const raw = rawScriptInput.value.trim();

    if (!groqKey){ showAutoSplitError('ใส่ Groq API key ก่อน ที่แอพหลัก > ตั้งค่า > API key'); return; }
    const orKey = readKey(OR_KEY);
    if (!geminiKey && !orKey){ showAutoSplitError('ใส่ Gemini API key (หรือ OpenRouter key) ก่อน ที่แอพหลัก > ตั้งค่า > API key'); return; }
    if (!selectedFile){ showAutoSplitError('เลือกไฟล์เสียงหรือวิดีโอก่อน (แท็บ "เสียง & ตัดต่อ")'); return; }
    if (!SCRIPT_FILL_MODE && !raw){ showAutoSplitError('วางสคริปต์ดิบในกล่อง 1 ก่อน (หรือเปิด "ตั้งค่า AI เพิ่มเติม" แล้วสลับเป็นโหมด "เติมจากเสียงด้วย" ถ้าไม่มีสคริปต์)'); return; }

    autoSplitBtn.disabled = true;
    asBar.begin(); // 15%
    try {
      if (!audioEl.paused) audioEl.pause();
      if (trim.hasCuts()) showAutoSplitStatus('กำลังตัดส่วนที่เลือกออกจากไฟล์เสียง...');
      const processedFile = trim.trimmedFile(selectedFile);

      asBar.to(45); // Whisper phase
      showAutoSplitStatus('กำลังจับเวลาเสียงจริง (Whisper)...');
      const whisperWords = await callGroqWhisper(groqKey, processedFile, whisperHintTermsInput.value);

      asBar.atLeast(45);
      asBar.to(85); // Gemini phase
      showAutoSplitStatus('กำลังแยกบรรทัดด้วย Gemini ตามจังหวะเสียงจริง...');
      const transcriptText = buildTranscriptForGemini(whisperWords);
      const splitLines = removeThaiSpaces(await callGeminiSplit(geminiKey, raw, transcriptText, SCRIPT_FILL_MODE, WORD_RANGE_MIN, WORD_RANGE_MAX, GEMINI_MODEL_ID, orKey ? {
        orKey,
        check: () => window.MWBudget && window.MWBudget.check(), // เพดานค่า AI ต่อวัน/เดือนของแอพหลัก
        add: (usd) => window.MWBudget && window.MWBudget.add(usd),
        onFallback: (why) => showAutoSplitStatus(`${why.replace(/ \(\d+\):.*$/s, '')} → ใช้ OpenRouter แทน (คิดเงิน)`)
      } : null));

      editedScript.value = splitLines;
      updateLineCount();
      showAutoSplitStats(splitLines);
      asBar.finish(); // 100% then fade out
      editedScript.scrollIntoView({ behavior: 'smooth', block: 'center' }); // bring the result into view
    } catch (err){
      console.error(err);
      asBar.fail();
      showAutoSplitError(err.message || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    } finally {
      autoSplitBtn.disabled = false;
    }
  });





  // ---------- STEP — confirm lines, run Whisper + matching + acoustic
  // refinement, then render straight away. No manual per-line review step:
  // Whisper's global alignment plus the energy-refinement pass above
  // handle the common cases automatically; if a specific clip still comes
  // out wrong, nudge the whole-clip offset slider above or edit the script
  // and re-run. ----------
  startBtn.addEventListener('click', async () => {
    // หยุดและรีเซ็ตคลิปตัวอย่างเก่าทันที กันเสียงคลิปเก่าแอบดังแทรกตอนเรนเดอร์คลิปใหม่
    previewVideo.pause(); previewVideo.currentTime = 0;
    hideError();
    resultCard.classList.remove('show');

    const groqKey = readKey(GROQ_KEY);
    // strip the "[AI]" auto-fill marker (added by the auto-split feature above to
    // flag lines it pulled from audio rather than the user's own script) —
    // it's a review aid for the textarea only and must never end up as
    // literal burned-in subtitle text.
    const lines = editedScript.value.split('\n').map(l => removeThaiSpaces(l.trim().replace(/^\[AI\]\s*/, ''))).filter(l => l.length > 0);

    if (!groqKey){ showError('ใส่ Groq API key ก่อน ที่แอพหลัก > ตั้งค่า > API key'); return; }
    if (!selectedFile){ showError('เลือกไฟล์เสียงพากย์ก่อน (แท็บ "เสียง & ตัดต่อ")'); return; }
    if (lines.length === 0){ showError('ใส่สคริปต์ก่อน (แท็บ "สคริปต์" อย่างน้อย 1 บรรทัด)'); return; }

    if (!audioEl.paused) audioEl.pause();

    // stage: show the progress overlay on top of the style preview while rendering
    hasResult = false;
    stageSwitch.classList.remove('show');
    setStageView('style');
    stage.classList.add('is-rendering');

    startBtn.disabled = true;
    setStep(step1, 'active'); setStep(step2, 'pending'); setStep(step3, 'pending');

    try {
      if (trim.hasCuts()){
        showStatus('กำลังตัดส่วนที่เลือกออกจากไฟล์เสียง...');
      }
      const processedFile = trim.trimmedFile(selectedFile);

      showStatus('กำลังถอดรหัสไฟล์เสียง...');
      const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
      const renderAudioBuffer = await decodeCtx.decodeAudioData(await processedFile.arrayBuffer());
      await decodeCtx.close();

      showStatus('กำลังจับเวลาเสียงจริง (Whisper)...');
      const whisperWords = await callGroqWhisper(groqKey, processedFile, whisperHintTermsInput.value);
      setStep(step1, 'done'); setStep(step2, 'active');
      showStatus('กำลังจับคู่บรรทัดกับเสียง...');

      let segments = alignLinesToWords(lines, whisperWords);
      // uniform correction, only for a whole-clip bias (see slider hint)
      if (SYNC_OFFSET_MS !== 0){
        const off = SYNC_OFFSET_MS / 1000;
        segments = segments.map(s => ({
          ...s,
          start: Math.max(0, s.start + off),
          end: Math.max(0.02, s.end + off)
        }));
        for (let i = 0; i < segments.length - 1; i++){
          if (segments[i].end > segments[i + 1].start) segments[i].end = segments[i + 1].start;
        }
      }

      showStatus('กำลังปรับจุดตัดให้ตรงคลื่นเสียงจริง...');
      segments = refineSegmentBoundariesWithEnergy(segments, renderAudioBuffer);
      setStep(step2, 'done'); setStep(step3, 'active');

      showStatus('กำลังเรนเดอร์คลิปจอเขียว...');
      showProgress();

      const { blob: videoBlob, durationSeconds } = await renderVideo({ canvas, segments, audioBuffer: renderAudioBuffer, onProgress: setProgress, fontPx: FONT_PX, strokePx: STROKE_PX, mediabunny: await loadMediabunny() });
      setStep(step3, 'done');
      hideProgress();

      const videoUrl = URL.createObjectURL(videoBlob);
      previewVideo.src = videoUrl;
      dlVideo.href = videoUrl;

      const srtBlob = new Blob([buildSrt(segments)], { type: 'text/plain' });
      dlSrt.href = URL.createObjectURL(srtBlob);

      resultCard.classList.add('show');
      hasResult = true;
      stageSwitch.classList.add('show');
      stage.classList.remove('is-rendering');
      setStageView('video');          // swap the stage to the finished clip
      previewVideo.currentTime = 0;
      previewVideo.play().catch(() => {}); // autoplay may be blocked on some browsers — controls are visible
      hideStatus();
    } catch (err){
      console.error(err);
      hideStatus();
      hideProgress();
      showError(err.message || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    } finally {
      stage.classList.remove('is-rendering');
      startBtn.disabled = false;
    }
  });
