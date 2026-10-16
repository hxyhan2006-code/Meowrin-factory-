// waveform.js — กล่องตัดท่อนเสียง: วาดคลื่นเสียง ซูม/บีบนิ้ว แบ่ง/ลบท่อน (ลบแล้วเสียงที่เหลือต่อกันแบบ CapCut) เลิกทำ/ทำซ้ำ
// แยกออกจาก app.js (v1.16) · state ทั้งหมดของคลื่นเสียงอยู่ในนี้ที่เดียว app.js คุยผ่านค่าที่ createTrimEditor คืนให้
// audioEl = <audio> ตัวเดียวกับที่ app.js ใช้ (เล่น/กรอ) · trimCard = <details> กล่องตัดท่อนเสียง
import { computePeaks, buildTrimmedAudioBuffer, audioBufferToWavBlob } from './media.js?v=5.4';

export function createTrimEditor({ audioEl, trimCard }){
  const waveformScroll = document.getElementById('waveformScroll');
  const waveformWrap = document.getElementById('waveformWrap');
  const waveformCanvas = document.getElementById('waveformCanvas');
  const wfPlayhead = document.getElementById('wfPlayhead');
  const wfPlayBtn = document.getElementById('wfPlayBtn');
  const wfTime = document.getElementById('wfTime');
  const wfSplitBtn = document.getElementById('wfSplitBtn');
  const wfPlaySelBtn = document.getElementById('wfPlaySelBtn');
  const wfCutSelBtn = document.getElementById('wfCutSelBtn');
  const wfZoomOutBtn = document.getElementById('wfZoomOut');
  const wfZoomInBtn = document.getElementById('wfZoomIn');
  const wfZoomFitBtn = document.getElementById('wfZoomFitBtn');
  const wfZoomLabel = document.getElementById('wfZoomLabel');
  const cutListEl = document.getElementById('cutList');
  const wfUndoBtn = document.getElementById('wfUndoBtn');
  const wfRedoBtn = document.getElementById('wfRedoBtn');

  let audioBuffer = null;      // decoded original audio, used to draw the waveform + build the trimmed version
  let waveformPeaks = null;    // Float32Array of [min,max] pairs per pixel-bucket
  let cutRegions = [];         // [{start,end}] in ORIGINAL-audio seconds — sorted, non-overlapping (committed deletions)
  let splitPoints = [];        // [seconds] in ORIGINAL-audio time — manual split markers inside surviving audio
  let selectedSeg = null;      // {start,end} in ORIGINAL-audio seconds — the currently tapped/highlighted piece, ready to delete
  let loopSelection = false;   // true while previewing the selected piece on a loop
  let wfRafId = null;
  let zoom = 1;                 // 1 = fit-to-width, up to ZOOM_MAX
  const ZOOM_MIN = 1, ZOOM_MAX = 60;
  let basePxPerSecond = 1;      // px/sec at zoom=1 (fills the visible width) — recomputed on load/resize
  function pxPerSecond(){ return basePxPerSecond * zoom; }

  // ---------- undo/redo for split/delete actions on the waveform ----------
  let undoStack = [];   // [{cutRegions, splitPoints}] — snapshot taken BEFORE each mutating action
  let redoStack = [];
  function snapshotTrimState(){
    return {
      cutRegions: cutRegions.map(r => ({ start: r.start, end: r.end })),
      splitPoints: [...splitPoints]
    };
  }
  function pushHistory(){
    undoStack.push(snapshotTrimState());
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }
  function applyTrimState(s){
    cutRegions = s.cutRegions.map(r => ({ start: r.start, end: r.end }));
    splitPoints = [...s.splitPoints];
    selectedSeg = null;
    recomputeBasePxPerSecond();
    layoutWaveform();
    drawWaveform();
    renderCutList();
    refreshSelUI();
    renderPlayheadOnly();
    updateHistoryButtons();
  }
  function updateHistoryButtons(){
    wfUndoBtn.disabled = undoStack.length === 0;
    wfRedoBtn.disabled = redoStack.length === 0;
  }
  wfUndoBtn.addEventListener('click', () => {
    if (undoStack.length === 0) return;
    redoStack.push(snapshotTrimState());
    applyTrimState(undoStack.pop());
  });
  wfRedoBtn.addEventListener('click', () => {
    if (redoStack.length === 0) return;
    undoStack.push(snapshotTrimState());
    applyTrimState(redoStack.pop());
  });

  // ---------- edge auto-scroll: dragging the playhead near either edge of
  // the visible (zoomed-in) waveform pans the view for you — no more
  // needing a second finger just to move forward/back while zoomed ----------
  const EDGE_ZONE_PX = 34;
  const EDGE_MAX_SPEED_PX = 14;
  let edgeScrollPointerX = null;
  let edgeScrollRafId = null;
  function edgeScrollLoop(){
    if (dragMode !== 'scrub' || edgeScrollPointerX == null){ edgeScrollRafId = null; return; }
    const scrollRect = waveformScroll.getBoundingClientRect();
    const maxScroll = Math.max(0, waveformWrap.offsetWidth - waveformScroll.clientWidth);
    let dx = 0;
    if (edgeScrollPointerX < scrollRect.left + EDGE_ZONE_PX){
      const depth = (scrollRect.left + EDGE_ZONE_PX - edgeScrollPointerX) / EDGE_ZONE_PX;
      dx = -EDGE_MAX_SPEED_PX * Math.min(1, depth);
    } else if (edgeScrollPointerX > scrollRect.right - EDGE_ZONE_PX){
      const depth = (edgeScrollPointerX - (scrollRect.right - EDGE_ZONE_PX)) / EDGE_ZONE_PX;
      dx = EDGE_MAX_SPEED_PX * Math.min(1, depth);
    }
    if (dx !== 0 && maxScroll > 0){
      waveformScroll.scrollLeft = Math.max(0, Math.min(maxScroll, waveformScroll.scrollLeft + dx));
      audioEl.currentTime = clientXToOrigTime(edgeScrollPointerX);
      renderPlayheadOnly();
    }
    edgeScrollRafId = requestAnimationFrame(edgeScrollLoop);
  }
  function startEdgeScroll(){
    if (edgeScrollRafId == null) edgeScrollRafId = requestAnimationFrame(edgeScrollLoop);
  }
  function stopEdgeScroll(){
    edgeScrollPointerX = null;
    if (edgeScrollRafId != null){ cancelAnimationFrame(edgeScrollRafId); edgeScrollRafId = null; }
  }

  function fmtTime(t){
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t/60);
    const s = Math.floor(t%60).toString().padStart(2,'0');
    return `${m}:${s}`;
  }

  // ---------- ripple model: cutRegions are physically gone from the timeline.
  // "virtual" time = position on the (collapsed) timeline the user sees/taps.
  // "orig" time = position in the actual decoded audioBuffer. ----------
  function keptSegments(){
    if (!audioBuffer) return [];
    const dur = audioBuffer.duration;
    const cuts = [...cutRegions].sort((a, b) => a.start - b.start);
    const kept = [];
    let cursor = 0;
    cuts.forEach(c => {
      if (c.start > cursor) kept.push({ start: cursor, end: c.start });
      cursor = Math.max(cursor, c.end);
    });
    if (cursor < dur) kept.push({ start: cursor, end: dur });
    return kept;
  }
  function virtualDuration(){
    return keptSegments().reduce((s, k) => s + (k.end - k.start), 0);
  }
  function isInCutRegion(t){
    return cutRegions.some(r => t >= r.start && t < r.end);
  }
  function origToVirtual(t){
    let acc = 0;
    for (const k of keptSegments()){
      if (t <= k.start) break;
      if (t <= k.end){ acc += (t - k.start); break; }
      acc += (k.end - k.start);
    }
    return acc;
  }
  function virtualToOrig(v){
    let acc = 0;
    const segs = keptSegments();
    for (const k of segs){
      const len = k.end - k.start;
      if (v <= acc + len) return k.start + (v - acc);
      acc += len;
    }
    return segs.length ? segs[segs.length - 1].end : 0;
  }
  // the pieces the user can tap-select: each surviving (kept) region, further
  // cut into pieces at any manual split points inside it
  function selectableSegments(){
    const result = [];
    keptSegments().forEach(k => {
      const pts = splitPoints.filter(p => p > k.start + 0.001 && p < k.end - 0.001).sort((a, b) => a - b);
      let prev = k.start;
      pts.forEach(p => { result.push({ start: prev, end: p }); prev = p; });
      result.push({ start: prev, end: k.end });
    });
    return result;
  }

  function totalWidthPx(){
    return Math.max(1, virtualDuration() * pxPerSecond());
  }
  function recomputeBasePxPerSecond(){
    if (!audioBuffer) return;
    const visibleW = waveformScroll.clientWidth || 300;
    basePxPerSecond = visibleW / Math.max(0.001, virtualDuration());
  }
  function maxZoomAllowed(){
    const visibleW = waveformScroll.clientWidth || 300;
    return Math.max(4, Math.min(ZOOM_MAX, 16000 / visibleW));
  }
  function clampZoom(z){
    return Math.max(ZOOM_MIN, Math.min(maxZoomAllowed(), z));
  }
  function updateZoomLabel(){
    if (zoom <= 1.02){ wfZoomLabel.textContent = 'พอดีจอ'; return; }
    const secs = virtualDuration() / zoom;
    wfZoomLabel.textContent = 'เห็น ' + (secs < 10 ? secs.toFixed(1) : Math.round(secs)) + ' วินาที';
  }
  function layoutWaveform(){
    if (!audioBuffer) return;
    waveformWrap.style.width = totalWidthPx() + 'px';
    updateZoomLabel();
  }
  function timeToX(t){ return t * pxPerSecond(); }
  function xToTime(x){ return audioBuffer ? Math.max(0, Math.min(virtualDuration(), x / pxPerSecond())) : 0; }
  function clientXToTime(clientX){
    const rect = waveformWrap.getBoundingClientRect();
    return xToTime(clientX - rect.left);
  }
  // client X on the (collapsed) waveform -> real position in the original file
  function clientXToOrigTime(clientX){
    return virtualToOrig(clientXToTime(clientX));
  }
  function clampToDuration(t){
    if (!audioBuffer) return 0;
    return Math.max(0, Math.min(audioBuffer.duration, t));
  }

  function drawWaveform(){
    if (!waveformPeaks || !audioBuffer) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = waveformCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(140 * dpr));
    if (waveformCanvas.width !== w || waveformCanvas.height !== h){
      waveformCanvas.width = w;
      waveformCanvas.height = h;
    }
    const wctx = waveformCanvas.getContext('2d');
    wctx.clearRect(0, 0, w, h);
    const midY = h / 2;

    wctx.strokeStyle = 'rgba(255,255,255,0.08)';
    wctx.beginPath(); wctx.moveTo(0, midY); wctx.lineTo(w, midY); wctx.stroke();

    const vDur = Math.max(0.001, virtualDuration());
    const totalDur = audioBuffer.duration;
    const numBuckets = waveformPeaks.length / 2;

    // ripple-drawn waveform: every pixel column maps back to a spot in the
    // ORIGINAL file, walking past whatever has already been cut out — so
    // deleted parts simply never appear, and the remaining audio reads as
    // one continuous clip (like CapCut after a delete).
    wctx.strokeStyle = '#39d98a';
    wctx.lineWidth = Math.max(1, dpr);
    wctx.beginPath();
    for (let x = 0; x < w; x++){
      const vTime = (x / w) * vDur;
      const origTime = virtualToOrig(vTime);
      let bi = Math.floor((origTime / totalDur) * numBuckets);
      if (bi < 0) bi = 0; if (bi >= numBuckets) bi = numBuckets - 1;
      const min = waveformPeaks[bi*2], max = waveformPeaks[bi*2+1];
      wctx.moveTo(x, midY - max * midY * 0.92);
      wctx.lineTo(x, midY - min * midY * 0.92);
    }
    wctx.stroke();

    // manual split markers — thin white divider at each split point still standing
    wctx.strokeStyle = 'rgba(255,255,255,0.55)';
    wctx.lineWidth = Math.max(1, dpr);
    splitPoints.forEach(p => {
      if (isInCutRegion(p)) return;
      const dx = (origToVirtual(p) / vDur) * w;
      wctx.beginPath(); wctx.moveTo(dx, 0); wctx.lineTo(dx, h); wctx.stroke();
    });

    // the currently selected piece — highlighted box, ready to delete
    if (selectedSeg){
      const dx1 = (origToVirtual(selectedSeg.start) / vDur) * w;
      const dx2 = (origToVirtual(selectedSeg.end) / vDur) * w;
      wctx.fillStyle = 'rgba(255,255,255,0.14)';
      wctx.fillRect(dx1, 0, Math.max(1, dx2 - dx1), h);
      wctx.strokeStyle = '#ffffff';
      wctx.lineWidth = Math.max(2, dpr * 2);
      wctx.strokeRect(dx1 + 1, 1, Math.max(1, dx2 - dx1 - 2), h - 2);
    }
  }
  window.addEventListener('resize', () => {
    if (!audioBuffer) return;
    recomputeBasePxPerSecond();
    layoutWaveform();
    drawWaveform();
    refreshSelUI();
  });

  // ---------- selection (tap-to-select a whole piece, CapCut style) ----------
  function selectSegmentAt(origTime){
    const segs = selectableSegments();
    let found = segs.find(s => origTime >= s.start - 0.001 && origTime <= s.end + 0.001);
    if (!found && segs.length){
      let best = null, bestD = Infinity;
      segs.forEach(s => {
        const d = Math.min(Math.abs(origTime - s.start), Math.abs(origTime - s.end));
        if (d < bestD){ bestD = d; best = s; }
      });
      found = best;
    }
    selectedSeg = found || null;
    refreshSelUI();
    drawWaveform();
  }

  function refreshSelUI(){
    const has = !!(selectedSeg && audioBuffer);
    wfPlaySelBtn.disabled = !has;
    wfCutSelBtn.disabled = !has;
  }

  function renderPlayheadOnly(){
    if (!audioBuffer) return;
    const vDur = virtualDuration() || 1;
    const vTime = origToVirtual(audioEl.currentTime);
    wfPlayhead.style.left = timeToX(vTime) + 'px';
    wfTime.textContent = `${fmtTime(vTime)} / ${fmtTime(vDur)}`;
  }

  function autoScrollToPlayhead(){
    if (zoom <= 1.02) return; // whole clip already fits — nothing to scroll
    const scrollRect = waveformScroll.getBoundingClientRect();
    const playheadX = timeToX(origToVirtual(audioEl.currentTime));
    const viewLeft = waveformScroll.scrollLeft;
    const viewRight = viewLeft + scrollRect.width;
    if (playheadX < viewLeft + 24 || playheadX > viewRight - 24){
      waveformScroll.scrollLeft = Math.max(0, playheadX - scrollRect.width / 2);
    }
  }

  // 1-finger tap or drag on the waveform moves the playhead (scrub) and, on
  // release, selects whichever piece it landed on — a single tap is all it
  // takes to pick a clip to delete, no painting/dragging a range required.
  // 2-finger gestures pinch-zoom and pan the timeline.
  const activePointers = new Map();
  let dragMode = null;          // 'scrub' | null
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchAnchorTime = 0;
  let scrubStartX = 0, scrubStartY = 0;   // to tell a tap (select) from a drag (just scan, no select)
  const TAP_MOVE_THRESHOLD = 8;           // px — below this, pointerup still counts as a tap

  function pointerDist(pts){ return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); }
  function pointerMid(pts){ return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }; }

  waveformWrap.addEventListener('pointerdown', (e) => {
    if (!audioBuffer) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { waveformWrap.setPointerCapture(e.pointerId); } catch (_){}
    e.preventDefault();

    if (activePointers.size >= 2){
      dragMode = null;
      const pts = Array.from(activePointers.values()).slice(0, 2);
      const scrollRect = waveformScroll.getBoundingClientRect();
      const mid = pointerMid(pts);
      pinchAnchorTime = xToTime(waveformScroll.scrollLeft + (mid.x - scrollRect.left));
      pinchStartDist = Math.max(1, pointerDist(pts));
      pinchStartZoom = zoom;
      return;
    }

    dragMode = 'scrub';
    scrubStartX = e.clientX;
    scrubStartY = e.clientY;
    loopSelection = false;
    audioEl.pause();
    audioEl.currentTime = clientXToOrigTime(e.clientX);
    renderPlayheadOnly();
  });

  waveformWrap.addEventListener('pointermove', (e) => {
    if (!audioBuffer || !activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size >= 2){
      stopEdgeScroll();
      selectedSeg = null; // clear any lingering selection box before re-scaling the view
      refreshSelUI();
      const pts = Array.from(activePointers.values()).slice(0, 2);
      const dist = Math.max(1, pointerDist(pts));
      const mid = pointerMid(pts);
      zoom = clampZoom(pinchStartZoom * (dist / pinchStartDist));
      layoutWaveform();
      const scrollRect = waveformScroll.getBoundingClientRect();
      waveformScroll.scrollLeft = Math.max(0, timeToX(pinchAnchorTime) - (mid.x - scrollRect.left));
      drawWaveform();
      renderPlayheadOnly();
      return;
    }

    if (dragMode === 'scrub'){
      audioEl.currentTime = clientXToOrigTime(e.clientX);
      renderPlayheadOnly();
      edgeScrollPointerX = e.clientX;
      startEdgeScroll();
    }
  });

  function endWfPointer(e){
    activePointers.delete(e.pointerId);
    try { waveformWrap.releasePointerCapture(e.pointerId); } catch (_){}
    if (activePointers.size === 0){
      if (dragMode === 'scrub'){
        // only a genuine tap (barely any movement) selects a piece to
        // delete — a drag used purely to scan the audio no longer leaves
        // a surprise white highlight box behind it
        const moved = Math.hypot(e.clientX - scrubStartX, e.clientY - scrubStartY);
        if (moved < TAP_MOVE_THRESHOLD){
          selectSegmentAt(audioEl.currentTime);
        }
      }
      dragMode = null;
      pinchStartDist = 0;
      stopEdgeScroll();
    }
  }
  waveformWrap.addEventListener('pointerup', endWfPointer);
  waveformWrap.addEventListener('pointercancel', endWfPointer);

  // ---------- zoom controls (buttons; pinch is handled above) ----------
  function zoomBy(factor){
    if (!audioBuffer) return;
    selectedSeg = null; // never carry a highlight box into a new zoom level
    refreshSelUI();
    const anchorVirtual = origToVirtual(audioEl.currentTime);
    const scrollRect = waveformScroll.getBoundingClientRect();
    zoom = clampZoom(zoom * factor);
    layoutWaveform();
    waveformScroll.scrollLeft = Math.max(0, timeToX(anchorVirtual) - scrollRect.width / 2);
    drawWaveform();
    renderPlayheadOnly();
  }
  wfZoomInBtn.addEventListener('click', () => zoomBy(1.6));
  wfZoomOutBtn.addEventListener('click', () => zoomBy(1 / 1.6));
  wfZoomFitBtn.addEventListener('click', () => {
    if (!audioBuffer) return;
    selectedSeg = null;
    refreshSelUI();
    zoom = ZOOM_MIN;
    layoutWaveform();
    waveformScroll.scrollLeft = 0;
    drawWaveform();
    renderPlayheadOnly();
  });

  // ---------- split: drop a divider at the playhead, splitting whichever piece it's in ----------
  const MIN_SEG = 0.12; // seconds — don't allow a split that leaves a sliver this thin
  wfSplitBtn.addEventListener('click', () => {
    if (!audioBuffer) return;
    const t = audioEl.currentTime;
    if (isInCutRegion(t)) return;
    const seg = selectableSegments().find(s => t > s.start + 0.001 && t < s.end - 0.001);
    if (!seg) return; // playhead is already sitting exactly on a boundary — nothing to split
    if (t - seg.start < MIN_SEG || seg.end - t < MIN_SEG) return;
    pushHistory();
    splitPoints.push(t);
    splitPoints.sort((a, b) => a - b);
    // auto-select the piece just carved out to the left of the playhead, CapCut-style
    selectedSeg = { start: seg.start, end: t };
    refreshSelUI();
    drawWaveform();
  });

  // ---------- listen to just the selected piece before deleting it ----------
  wfPlaySelBtn.addEventListener('click', () => {
    if (!selectedSeg || !audioBuffer) return;
    loopSelection = true;
    audioEl.currentTime = clampToDuration(selectedSeg.start);
    audioEl.play();
  });

  // ---------- delete the selected piece — it's gone, remaining audio ripples together ----------
  wfCutSelBtn.addEventListener('click', () => {
    if (!selectedSeg || !audioBuffer) return;
    const { start: a, end: b } = selectedSeg;
    audioEl.pause();
    loopSelection = false;
    pushHistory();
    addCutRegion(a, b);
    splitPoints = splitPoints.filter(p => !isInCutRegion(p));
    selectedSeg = null;
    refreshSelUI();
    recomputeBasePxPerSecond(); // ความยาวรวมเปลี่ยนแล้ว (ท่อนที่ลบหายไป) → ปรับสเกลให้คลื่นเต็มความกว้างเหมือนเดิม
    layoutWaveform();
    drawWaveform();
    renderCutList();
    renderPlayheadOnly();
  });

  function addCutRegion(start, end){
    let merged = { start, end };
    const remaining = [];
    cutRegions.forEach(r => {
      if (r.end < merged.start || r.start > merged.end){
        remaining.push(r);
      } else {
        merged = { start: Math.min(merged.start, r.start), end: Math.max(merged.end, r.end) };
      }
    });
    remaining.push(merged);
    remaining.sort((x, y) => x.start - y.start);
    cutRegions = remaining;
  }

  function removeCutRegion(idx){
    pushHistory();
    cutRegions.splice(idx, 1);
    recomputeBasePxPerSecond();
    layoutWaveform();
    drawWaveform();
    renderCutList();
    renderPlayheadOnly();
  }

  function renderCutList(){
    if (cutRegions.length === 0){
      cutListEl.innerHTML = '<p class="wf-hint" style="margin-top:0;">ยังไม่มีท่อนที่ลบ — ทั้งคลิปจะถูกส่งเข้า Whisper ตามปกติ</p>';
      return;
    }
    cutListEl.innerHTML = cutRegions.map((r, i) =>
      `<div class="cut-item"><span class="cut-range">${fmtTime(r.start)}–${fmtTime(r.end)} (ตัดออก ${fmtTime(r.end - r.start)})</span><button type="button" data-idx="${i}" aria-label="ลบช่วงตัดนี้">ยกเลิก</button></div>`
    ).join('');
    cutListEl.querySelectorAll('button[data-idx]').forEach(btn => {
      btn.addEventListener('click', () => removeCutRegion(Number(btn.dataset.idx)));
    });
  }

  const ICON_PLAY = '<svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>';
  const ICON_PAUSE = '<svg class="ic" aria-hidden="true"><use href="#i-pause"/></svg>';
  wfPlayBtn.addEventListener('click', () => {
    if (!audioBuffer) return;
    loopSelection = false; // the main ▶ button always plays the whole clip forward
    if (audioEl.paused) audioEl.play(); else audioEl.pause();
  });
  audioEl.addEventListener('play', () => { wfPlayBtn.innerHTML = ICON_PAUSE; startWfRaf(); });
  audioEl.addEventListener('pause', () => { wfPlayBtn.innerHTML = ICON_PLAY; stopWfRaf(); });
  audioEl.addEventListener('ended', () => { wfPlayBtn.innerHTML = ICON_PLAY; loopSelection = false; stopWfRaf(); updatePlayheadAndTime(); });

  function startWfRaf(){
    stopWfRaf();
    function loop(){
      updatePlayheadAndTime();
      wfRafId = requestAnimationFrame(loop);
    }
    wfRafId = requestAnimationFrame(loop);
  }
  function stopWfRaf(){
    if (wfRafId) cancelAnimationFrame(wfRafId);
    wfRafId = null;
  }
  // Used while actually playing: also loops the "listen to selection" preview
  // and keeps the playhead in view when zoomed in — pointer-drag scrubbing
  // uses the lighter renderPlayheadOnly() instead so it never fights the user's
  // finger by yanking the scroll position mid-drag.
  function updatePlayheadAndTime(){
    if (!audioBuffer) return;
    if (loopSelection && selectedSeg){
      if (audioEl.currentTime >= selectedSeg.end - 0.015){
        audioEl.currentTime = clampToDuration(selectedSeg.start);
      }
    } else if (!audioEl.paused){
      // normal forward playback ripples straight over any deleted piece,
      // exactly like CapCut's preview does
      for (const r of cutRegions){
        if (audioEl.currentTime >= r.start - 0.01 && audioEl.currentTime < r.end){
          audioEl.currentTime = r.end;
          break;
        }
      }
    }
    renderPlayheadOnly();
    autoScrollToPlayhead();
  }

  // เปิดแถบตัดท่อนเสียง (ที่พับไว้ตอนเลือกจากแอพ) → จัดคลื่นเสียงใหม่ เพราะตอนพับวัดความกว้างไม่ได้
  trimCard.addEventListener('toggle', () => {
    if (trimCard.open && audioBuffer) requestAnimationFrame(() => { recomputeBasePxPerSecond(); layoutWaveform(); drawWaveform(); updatePlayheadAndTime(); });
  });

  // ---------- ที่ app.js เรียกใช้ ----------
  // ล้างทุกอย่างก่อนเปิดไฟล์ใหม่
  function reset(){
    cutRegions = [];
    splitPoints = [];
    selectedSeg = null;
    audioBuffer = null;
    waveformPeaks = null;
    zoom = 1;
    undoStack = [];
    redoStack = [];
    updateHistoryButtons();
    wfSplitBtn.disabled = true;
    refreshSelUI();
    trimCard.style.display = 'none';
  }
  // ได้เสียงที่ถอดรหัสแล้ว → โชว์กล่องตัดท่อน (open = กางแถบพับไว้เลยไหม)
  function load(buffer, { open = true } = {}){
    audioBuffer = buffer;
    waveformPeaks = computePeaks(audioBuffer, 2000);
    trimCard.style.display = 'block';
    trimCard.open = open;
    wfSplitBtn.disabled = false;
    renderCutList();
    if (trimCard.open) requestAnimationFrame(() => { recomputeBasePxPerSecond(); layoutWaveform(); drawWaveform(); });
    updatePlayheadAndTime();
  }
  // แท็บของคลื่นเสียงถูกซ่อน (display:none) วัดขนาดไม่ได้ — กลับมาเห็นแล้วจัดใหม่
  function relayout(){
    if (!audioBuffer) return;
    requestAnimationFrame(() => {
      recomputeBasePxPerSecond(); layoutWaveform(); drawWaveform(); renderPlayheadOnly();
    });
  }
  // ไฟล์ที่ส่งเข้า Whisper/เรนเดอร์จริง: ไม่ได้ตัดอะไร = ไฟล์เดิม · ตัดแล้ว = WAV ใหม่ที่เอาท่อนที่ลบออกจริงๆ
  function trimmedFile(original){
    if (!audioBuffer || cutRegions.length === 0) return original;
    const trimmedBuffer = buildTrimmedAudioBuffer(audioBuffer, cutRegions);
    const wavBlob = audioBufferToWavBlob(trimmedBuffer);
    return new File([wavBlob], 'trimmed_audio.wav', { type: 'audio/wav' });
  }
  return { reset, load, relayout, trimmedFile, hasCuts: () => cutRegions.length > 0 };
}
