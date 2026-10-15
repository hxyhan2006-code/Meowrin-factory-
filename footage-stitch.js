/* footage-stitch.js — ต่อฉากเป็นวิดีโอไฟล์เดียวในเบราว์เซอร์ (ใช้ร่วมกันระหว่างแท็บวางแผนกับถาดเลือกฉากในแท็บคลัง) · โหลดหลัง footage-find.js (ใช้ FT.ui)
   FT.stitch = { ok(), make(list, onStep, onMsg) → { file, marks, rate, mime }, send(file, say), save(file, say) }
   list = [{ c, sc, lines:[เลขบรรทัด/ลำดับ] }] */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U) return;
  /* ---------- ต่อฉากทั้งหมดเป็นวิดีโอไฟล์เดียวในเครื่อง ----------
     แชร์หลายไฟล์ไม่เวิร์ก: Brave/Chrome Android จำกัด ≤10 ไฟล์ ≤50 MB ต่อครั้ง และ CapCut รับแชร์เข้าโปรเจกต์เดิมซ้ำไม่ได้ ลำดับไฟล์ก็ไม่แน่นอน
     เลยเล่นทีละฉาก (เฉพาะช่วง) วาดลง canvas + ส่งเสียงผ่าน WebAudio แล้วอัดต่อกันด้วย MediaRecorder ตัวเดียว (pause ระหว่างเปลี่ยนฉาก)
     ได้ 1 ไฟล์เรียงตามบท + ตารางเวลาว่าแต่ละบรรทัดเริ่มวินาทีไหน · อัดเวลาจริง ต้องเปิดหน้าค้างไว้ */
  var MAX_BYTES = 45 * 1024 * 1024, MAX_RATE = 8e6, MIN_RATE = 2e6;
  function recMime(){
    var c = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    return window.MediaRecorder ? c.find(function(m){ return MediaRecorder.isTypeSupported(m); }) || "" : null;
  }
  function once(el, ev){ return new Promise(function(ok, no){ el.addEventListener(ev, ok, { once:true }); el.addEventListener("error", function(){ no(new Error("เปิดไฟล์วิดีโอไม่ได้")); }, { once:true }); }); }
  async function openVid(c){ /* ไฟล์ในเครื่อง หรือสตรีมจากคลัง (crossOrigin ให้วาดลง canvas/อัดเสียงได้ — คลังต้องตั้ง CORS) */
    var src = await U.srcUrl(c); if(!src) throw new Error("ไม่มีไฟล์ " + c.name);
    var v = document.createElement("video"); v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous"; v._done = src.done;
    v.style.cssText = "position:fixed;left:-9999px;width:2px;height:2px"; document.body.appendChild(v);
    v.src = src.url; await once(v, "loadedmetadata"); return v;
  }
  function closeVid(v){ v.pause(); if(v._done) v._done(); v.removeAttribute("src"); v.load(); v.remove(); }
  async function record(list, mime, ac, onStep){
    var secs = list.reduce(function(t, x){ return t + (x.sc.e - x.sc.s); }, 0);
    var rate = Math.max(MIN_RATE, Math.min(MAX_RATE, MAX_BYTES * 8 / Math.max(secs, 1) * 0.85)); /* ให้ไฟล์รวมไม่เกินเพดานแชร์ */
    var first = await openVid(list[0].c), W = first.videoWidth || 1080, H = first.videoHeight || 1080; closeVid(first);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d");
    var dest = ac.createMediaStreamDestination();
    var stream = new MediaStream(cv.captureStream(30).getVideoTracks().concat(dest.stream.getAudioTracks()));
    var rec = new MediaRecorder(stream, { mimeType:mime, videoBitsPerSecond:rate, audioBitsPerSecond:128000 }), parts = [], marks = [], at = 0;
    rec.ondataavailable = function(ev){ if(ev.data && ev.data.size) parts.push(ev.data); };
    var stopped = new Promise(function(ok){ rec.onstop = ok; });
    try{
      for(var i = 0; i < list.length; i++){
        var x = list[i], v = await openVid(x.c), src = null;
        try{
          var s = x.sc.s, e = Math.min(x.sc.e, v.duration);
          v.currentTime = s; await once(v, "seeked");
          try{ src = ac.createMediaElementSource(v); src.connect(dest); }catch(err){ v.muted = true; } /* เสียงไปเข้าไฟล์อย่างเดียว ไม่ออกลำโพง */
          var draw = function(){ var r = Math.min(W / v.videoWidth, H / v.videoHeight), w = v.videoWidth * r, h = v.videoHeight * r;
            g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h); };
          draw();
          onStep(i, x);
          if(rec.state === "inactive") rec.start(); else rec.resume();
          try{ await v.play(); }catch(err){ v.muted = true; await v.play(); } /* เล่นมีเสียงไม่ได้ → อัดภาพอย่างเดียวฉากนี้ */
          var t0 = performance.now();
          await new Promise(function(ok){
            function tick(){ draw(); if(v.currentTime >= e - 0.03 || v.ended){ ok(); return; } if(v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick); else requestAnimationFrame(tick); }
            tick(); v.onended = ok;
          });
          rec.pause(); v.pause();
          var len = (performance.now() - t0) / 1000;
          marks.push({ lines:x.lines, at:at, len:len, c:x.c, sc:x.sc }); at += len;
        }finally{ if(src) src.disconnect(); closeVid(v); }
      }
      rec.stop(); await stopped;
    }finally{ stream.getTracks().forEach(function(t){ t.stop(); }); if(rec.state !== "inactive") rec.stop(); }
    return { blob:new Blob(parts, { type:mime.split(";")[0] }), marks:marks, rate:rate };
  }
  function ok(){ var AC = window.AudioContext || window.webkitAudioContext; return !!(recMime() && AC && HTMLCanvasElement.prototype.captureStream); }
  async function make(list, onStep, onMsg){ /* เรียกตรงจากการแตะปุ่ม (ต้องสร้าง AudioContext ตอนมีการแตะ) */
    var mime = recMime(), AC = window.AudioContext || window.webkitAudioContext, ac = new AC(); ac.resume();
    await U.wake(true);
    try{
      var r = await record(list, mime, ac, onStep);
      if(!r.blob.size) throw new Error("อัดได้ไฟล์ว่าง");
      var d = new Date(), ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm", out = r.blob;
      if(ext === "mp4" && window.MP4Fix){ if(onMsg) onMsg("กำลังจัดไฟล์ให้ CapCut อ่านได้..."); out = await MP4Fix.remux(r.blob); } /* MediaRecorder ให้ fragmented MP4 ซึ่ง CapCut ไม่รับ */
      var file = new File([out], "meowrin_" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + "." + ext, { type:out.type || r.blob.type });
      return { file:file, marks:r.marks, rate:r.rate, mime:mime };
    }finally{ ac.close(); await U.wake(false); }
  }
  async function send(file, say){ /* แชร์ไฟล์ (หรือหลายไฟล์) ไป CapCut ด้วย Web Share · Brave/Chrome Android จำกัด ≤10 ไฟล์ รวม ≤50 MB */
    var fs = Array.isArray(file) ? file : [file], big = fs.reduce(function(t, f){ return t + f.size; }, 0) > 50 * 1048576 || fs.length > 10;
    if(!navigator.canShare || !navigator.canShare({ files:fs })){ say("เบราว์เซอร์นี้แชร์ไฟล์นี้ไม่ได้" + (big ? " (เกินลิมิตแชร์ ≤10 ไฟล์ รวม ≤50 MB)" : "") + " ลองปุ่ม 💾 บันทึกลงเครื่องแทน", "err"); return; }
    try{ await navigator.share({ files:fs, title:"ฟุตเทจ" }); }
    catch(err){ if(err && err.name !== "AbortError") say("แชร์ไม่ได้: " + err.message + (big ? " (เกินลิมิตแชร์ ใช้ปุ่ม 💾 บันทึกลงเครื่องแทน)" : ""), "err"); }
  }
  function save(file, say){ /* บันทึกลงโฟลเดอร์ Download (ไว้เปิดใน CapCut ตรงๆ ไม่ผ่านปุ่มแชร์) */
    var url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    say("สั่งบันทึกแล้ว ดูในโฟลเดอร์ Download ของมือถือ (" + file.name + ") แล้วเปิดจากแกลเลอรี/CapCut โดยตรง", "ok");
  }
  FT.stitch = { ok:ok, make:make, send:send, save:save };
})();
