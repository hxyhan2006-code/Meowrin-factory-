/* footage-stitch.js — ต่อฉากเป็นวิดีโอยาวไฟล์เดียวในเบราว์เซอร์ (แท็บผู้กำกับ) · โหลดหลัง footage-find.js (ใช้ FT.ui)
   FT.stitch = { ok(), make(list, onStep, onMsg, opt) → { file, marks, rate, mime }, save(file, say) }
   list = [{ c, sc, from?, to? }] (from/to = ช่วงที่ตัด ถ้าไม่ใส่ใช้ทั้งฉาก) · opt.sep = วินาทีของจอเขียว + เสียงตื๊ด คั่นระหว่างช็อต (0 = ไม่คั่น)
   opt.voice = Blob เสียงพากย์ → โหมดตัดตามเสียง: list = [{ c|null, from, to, at }] (at = วินาทีที่ช็อตเริ่มในเสียง · c ว่าง = ค้างภาพก่อนหน้า) อัดต่อเนื่องไม่ pause เสียงพากย์เล่นเป็นเส้นเวลาหลัก ภาพของฉากปิดเสียง
   ไม่มีปุ่มแชร์: ทดสอบแล้ว CapCut ขึ้น "ไม่รองรับไฟล์" ทุกครั้งที่แชร์จาก Brave แต่เปิดไฟล์ที่บันทึกลงเครื่องได้ */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U) return;
  /* เล่นทีละช็อต (เฉพาะช่วง) วาดลง canvas + เสียงผ่าน WebAudio แล้วอัดต่อกันด้วย MediaRecorder ตัวเดียว (pause ระหว่างเปิดไฟล์ถัดไป)
     อัดเวลาจริง ต้องเปิดหน้าค้างไว้ · ไฟล์ไม่ต้องแชร์แล้ว จึงไม่บีบให้เล็ก */
  var RATE = 6e6, BEEP_HZ = 1000, GREEN = "#00ff00";
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
  async function record(list, mime, ac, onStep, sep){
    var first = await openVid(list[0].c), W = first.videoWidth || 1080, H = first.videoHeight || 1080; closeVid(first);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d");
    var dest = ac.createMediaStreamDestination();
    var stream = new MediaStream(cv.captureStream(30).getVideoTracks().concat(dest.stream.getAudioTracks()));
    var rec = new MediaRecorder(stream, { mimeType:mime, videoBitsPerSecond:RATE, audioBitsPerSecond:128000 }), parts = [], marks = [], at = 0;
    rec.ondataavailable = function(ev){ if(ev.data && ev.data.size) parts.push(ev.data); };
    var stopped = new Promise(function(ok){ rec.onstop = ok; });
    async function separator(){ /* จอเขียว + เสียงตื๊ดยาว = จุดเปลี่ยนช็อต ให้เห็นง่ายตอนตัดใน CapCut */
      var osc = ac.createOscillator(), gn = ac.createGain(); osc.type = "sine"; osc.frequency.value = BEEP_HZ; gn.gain.value = 0.25; osc.connect(gn); gn.connect(dest);
      g.fillStyle = GREEN; g.fillRect(0, 0, W, H); rec.resume(); osc.start();
      var t0 = performance.now();
      await new Promise(function(ok){ (function tick(){ g.fillStyle = GREEN; g.fillRect(0, 0, W, H); if(performance.now() - t0 >= sep * 1000) ok(); else requestAnimationFrame(tick); })(); });
      rec.pause(); osc.stop(); osc.disconnect(); gn.disconnect();
      at += (performance.now() - t0) / 1000;
    }
    try{
      for(var i = 0; i < list.length; i++){
        var x = list[i], v = await openVid(x.c), src = null;
        try{
          var s = x.from != null ? x.from : x.sc.s, e = Math.min(x.to != null ? x.to : x.sc.e, v.duration);
          v.currentTime = s; await once(v, "seeked");
          try{ src = ac.createMediaElementSource(v); src.connect(dest); }catch(err){ v.muted = true; } /* เสียงไปเข้าไฟล์อย่างเดียว ไม่ออกลำโพง */
          var draw = function(){ var r = Math.min(W / v.videoWidth, H / v.videoHeight), w = v.videoWidth * r, h = v.videoHeight * r;
            g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h); };
          draw();
          onStep(i, x);
          if(i && sep) await separator(); /* คั่นก่อนช็อตที่ 2 เป็นต้นไป (ไฟล์ถัดไปเปิดรอไว้แล้ว) */
          if(rec.state === "inactive") rec.start(); else rec.resume();
          try{ await v.play(); }catch(err){ v.muted = true; await v.play(); } /* เล่นมีเสียงไม่ได้ → อัดภาพอย่างเดียวช็อตนี้ */
          var t0 = performance.now();
          await new Promise(function(ok){
            function tick(){ draw(); if(v.currentTime >= e - 0.03 || v.ended){ ok(); return; } if(v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick); else requestAnimationFrame(tick); }
            tick(); v.onended = ok;
          });
          rec.pause(); v.pause();
          var len = (performance.now() - t0) / 1000;
          marks.push({ i:i, at:at, len:len, x:x }); at += len;
        }finally{ if(src) src.disconnect(); closeVid(v); }
      }
      rec.stop(); await stopped;
    }finally{ stream.getTracks().forEach(function(t){ t.stop(); }); if(rec.state !== "inactive") rec.stop(); }
    return { blob:new Blob(parts, { type:mime.split(";")[0] }), marks:marks, rate:RATE };
  }
  async function recordVoice(list, mime, ac, voiceBlob, onStep){ /* ตัดตามเสียง: เสียงพากย์เดินต่อเนื่อง ภาพเปลี่ยนตามเวลา at ของแต่ละช็อต (เตรียมคลิปถัดไปล่วงหน้า LOOK ช็อต) */
    var LOOK = 3, buf = await ac.decodeAudioData(await voiceBlob.arrayBuffer()), total = buf.duration;
    var f0 = list.find(function(x){ return x.c; }); if(!f0) throw new Error("ไม่มีช็อตที่มีฉากเลย");
    var first = await openVid(f0.c), W = first.videoWidth || 1080, H = first.videoHeight || 1080; closeVid(first);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    var dest = ac.createMediaStreamDestination();
    var stream = new MediaStream(cv.captureStream(30).getVideoTracks().concat(dest.stream.getAudioTracks()));
    var rec = new MediaRecorder(stream, { mimeType:mime, videoBitsPerSecond:RATE, audioBitsPerSecond:128000 }), parts = [], marks = [];
    rec.ondataavailable = function(ev){ if(ev.data && ev.data.size) parts.push(ev.data); };
    var stopped = new Promise(function(ok){ rec.onstop = ok; });
    var prepared = {};
    function prep(i){ if(i >= list.length || prepared[i] || !list[i].c) return;
      prepared[i] = (async function(){ var v = await openVid(list[i].c); v.muted = true; v.currentTime = list[i].from; await once(v, "seeked"); return v; })();
      prepared[i].catch(function(){}); }
    function draw(v){ var r = Math.min(W / v.videoWidth, H / v.videoHeight), w = v.videoWidth * r, h = v.videoHeight * r;
      g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h); }
    for(var k = 0; k <= LOOK; k++) prep(k);
    var firstIdx = list.indexOf(f0); if(prepared[firstIdx]) await prepared[firstIdx].catch(function(){});
    var src = ac.createBufferSource(); src.buffer = buf; src.connect(dest);
    var t0 = ac.currentTime + 0.2; rec.start(); src.start(t0);
    var now = function(){ return ac.currentTime - t0; };
    try{
      for(var i = 0; i < list.length; i++){
        var x = list[i], end = i + 1 < list.length ? list[i + 1].at : total, v = null;
        for(var q = 1; q <= LOOK; q++) prep(i + q);
        if(x.c){ try{ v = await prepared[i]; }catch(err){ v = null; } }
        onStep(i, x);
        if(v){ try{ await v.play(); }catch(err){} }
        var ts = now();
        await new Promise(function(ok){
          (function tick(){
            if(v && v.readyState >= 2){ draw(v); if(v.currentTime >= x.to - 0.03) v.pause(); } /* ฉากสั้นกว่าช็อต = ค้างภาพสุดท้าย */
            if(now() >= end){ ok(); return; } requestAnimationFrame(tick);
          })();
        });
        marks.push({ i:i, at:Math.max(0, ts), len:Math.max(0, now() - ts), x:x });
        if(v){ closeVid(v); delete prepared[i]; }
      }
      while(now() < total + 0.15) await new Promise(function(ok){ setTimeout(ok, 50); });
      rec.stop(); await stopped;
    }finally{
      Object.keys(prepared).forEach(function(i){ prepared[i].then(closeVid, function(){}); });
      try{ src.stop(); }catch(err){} stream.getTracks().forEach(function(t){ t.stop(); }); if(rec.state !== "inactive") rec.stop();
    }
    return { blob:new Blob(parts, { type:mime.split(";")[0] }), marks:marks, rate:RATE };
  }
  function ok(){ var AC = window.AudioContext || window.webkitAudioContext; return !!(recMime() && AC && HTMLCanvasElement.prototype.captureStream); }
  async function make(list, onStep, onMsg, opt){ /* เรียกตรงจากการแตะปุ่ม (ต้องสร้าง AudioContext ตอนมีการแตะ) */
    var mime = recMime(), AC = window.AudioContext || window.webkitAudioContext, ac = new AC(); ac.resume();
    await U.wake(true);
    try{
      var r = opt && opt.voice ? await recordVoice(list, mime, ac, opt.voice, onStep) : await record(list, mime, ac, onStep, (opt && opt.sep) || 0);
      if(!r.blob.size) throw new Error("อัดได้ไฟล์ว่าง");
      var d = new Date(), ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm", out = r.blob;
      if(ext === "mp4" && window.MP4Fix){ if(onMsg) onMsg("กำลังจัดไฟล์ให้ CapCut อ่านได้..."); out = await MP4Fix.remux(r.blob); } /* MediaRecorder ให้ fragmented MP4 ซึ่ง CapCut ไม่รับ */
      var file = new File([out], "meowrin_" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + "." + ext, { type:out.type || r.blob.type });
      return { file:file, marks:r.marks, rate:r.rate, mime:mime };
    }finally{ ac.close(); await U.wake(false); }
  }
  function save(file, say){ /* บันทึกลงโฟลเดอร์ Download แล้วเปิดจากแกลเลอรีใน CapCut */
    var url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    say("สั่งบันทึกแล้ว ดูในโฟลเดอร์ Download ของมือถือ (" + file.name + ") แล้วเปิด CapCut → โปรเจกต์ใหม่ → เลือกจากแกลเลอรี", "ok");
  }
  FT.stitch = { ok:ok, make:make, save:save };
})();
