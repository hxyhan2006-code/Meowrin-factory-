/* footage-plan.js — แท็บ "วางแผน": บท → AI คิดฉากทีละบรรทัด (FT.plan) → หาคลิปจริงในดัชนี (ค้นในเครื่อง + FT.rank)
   → เลือก/สลับ → แชร์ไฟล์คลิปที่เลือกเรียงตามบทไป CapCut (Web Share) · โหลดหลัง footage.js (ใช้ FT.ui)
   แผนล่าสุดเก็บใน MWStore (store.js) key mw_footage_plan_v1 (อ้างคลิปด้วย id + ลำดับฉาก ไม่เก็บรูป) */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U) return;
  var $ = function(id){ return document.getElementById(id); };
  var KEY = "mw_footage_plan_v1", POOL = 40, PICKS = 3, PAR = 3, MAX_LINES = 40;
  function load(k, d){ return MWStore.get(k, d); } /* store.js: IndexedDB + แคช */
  function save(k, v){ return MWStore.set(k, v); }
  var plan = load(KEY, null); /* { at, cost, rows:[{ line, scene, backup, picks:[{id, si, why}], sel, use }] } */

  /* ---------- บทจากประวัติของแอพหลัก (mw_history_v1) ---------- */
  function part2(t){ var m = /^[^\n]*PART\s*2[^\n]*$/im.exec(t || ""); return (m ? t.slice(m.index + m[0].length) : (t || "")).trim(); }
  var srcs = [];
  function renderSrc(){
    var h = load("mw_history_v1", []); srcs = [];
    (Array.isArray(h) ? h : []).forEach(function(e){
      (e && Array.isArray(e.vers) ? e.vers : []).forEach(function(v){
        var t = part2(v.s2); if(t) srcs.push({ label:(e.clip && e.clip.title || "คลิป") + " · " + (v.pname || ""), text:t });
      });
    });
    $("plSrc").innerHTML = '<option value="">— เลือกบท (' + srcs.length + ') —</option>' + srcs.map(function(s, i){ return '<option value="' + i + '">' + U.esc(s.label) + "</option>"; }).join("");
  }
  $("plSrc").addEventListener("change", function(){ var s = srcs[+this.value]; if(this.value !== "" && s) $("plText").value = s.text; });
  document.querySelector(".tabs").addEventListener("click", function(e){ var b = e.target.closest("button[data-p]"); if(b && b.dataset.p === "plan"){ renderSrc(); render(); } });

  /* ---------- หาผู้สมัครในดัชนีจากฉากที่ AI อยากได้ (ค้นในเครื่อง ฟรี) ---------- */
  function candidates(it){
    var ts = U.terms([it.scene, it.backup, it.chars.join(" "), it.keys.join(" ")].join(" ")), want = it.chars.map(function(c){ return c.toLowerCase(); }), out = [];
    U.lib().forEach(function(c){ if(c.status !== "done") return; c.scenes.forEach(function(sc, si){
      var h = U.hay(c, sc), hit = 0, score = 0, a = sc.ai || {};
      ts.forEach(function(v){ var w = [4, 2, 1].find(function(_, k){ return v.some(function(n){ return h[k].indexOf(n) >= 0; }); }); if(w){ hit++; score += w; } });
      if((a.characters || []).some(function(n){ return want.indexOf(String(n).toLowerCase()) >= 0; })) score += 3;
      if(hit || score) out.push({ c:c, sc:sc, si:si, s:hit * 10 + score });
    }); });
    return out.sort(function(x, y){ return y.s - x.s; }).slice(0, POOL);
  }
  function clip(id){ return U.lib().find(function(c){ return c.id === id; }); }
  function sameScene(a, b){ return a && b && a.id === b.id && a.si === b.si; }

  /* ---------- วางแผน ---------- */
  var busy = false;
  $("plGo").addEventListener("click", async function(){
    if(busy) return;
    var lines = $("plText").value.split("\n").map(function(l){ return l.trim(); }).filter(Boolean).slice(0, MAX_LINES);
    if(!lines.length){ U.msg("plMsg", "ใส่บทก่อน (เลือกจากประวัติ หรือวางเอง)", "err"); return; }
    if(!U.lib().some(function(c){ return c.status === "done"; })){ U.msg("plMsg", "ดัชนียังว่าง ไปทำดัชนีคลิปก่อน", "err"); return; }
    if(!FT.orKey()){ U.msg("plMsg", "ยังไม่มี OpenRouter key ในเบราว์เซอร์นี้", "err"); return; }
    busy = true; this.disabled = true; var cost = 0, t0 = Date.now();
    try{
      U.msg("plMsg", "AI กำลังคิดฉากทีละบรรทัด (" + lines.length + " บรรทัด)...");
      var p = await FT.plan(lines); cost += p.cost;
      var rows = p.items.map(function(it){ return { line:it.line, scene:it.scene, backup:it.backup, picks:[], sel:0, use:true, it:it }; }), done = 0;
      U.msg("plMsg", "กำลังหาคลิปในดัชนี 0/" + rows.length + "...");
      for(var i = 0; i < rows.length; i += PAR){ /* ส่งพร้อมกันทีละ PAR บรรทัด */
        await Promise.all(rows.slice(i, i + PAR).map(async function(r){
          var pool = candidates(r.it);
          if(pool.length){
            try{
              var items = pool.map(function(x, k){ var a = x.sc.ai || {}; return { i:k + 1, who:(a.characters_th && a.characters_th.length ? a.characters_th : a.characters || []).join(","), sum:a.summary_th || "", tags:(a.tags_th || []).join(","), loc:a.location || "" }; });
              var rr = await FT.rank('บทพูด: "' + r.line + '"\nฉากที่อยากได้: ' + r.scene + "\nหรือ: " + r.backup, items); cost += rr.cost;
              r.picks = rr.picks.filter(function(pk){ return pk.i <= pool.length; }).slice(0, PICKS).map(function(pk){ var x = pool[pk.i - 1]; return { id:x.c.id, si:x.si, why:pk.why }; });
            }catch(err){ r.err = err.message; }
          }
          done++; U.msg("plMsg", "กำลังหาคลิปในดัชนี " + done + "/" + rows.length + "...");
        }));
      }
      rows.forEach(function(r, k){ /* ไม่ใช้ฉากเดียวกันติดกันสองบรรทัด */
        var prev = k && rows[k - 1].picks[rows[k - 1].sel];
        if(sameScene(r.picks[0], prev) && r.picks.length > 1) r.sel = 1;
        delete r.it;
      });
      plan = { at:Date.now(), cost:cost, ms:Date.now() - t0, rows:rows }; save(KEY, plan);
      U.msg("plMsg", ""); render();
    }catch(err){ U.msg("plMsg", "วางแผนไม่ได้: " + err.message, "err"); }
    U.addCost(cost); busy = false; this.disabled = false;
  });

  /* ---------- แสดงแผน ---------- */
  function chosen(r){ var pk = r.picks[r.sel]; return pk && clip(pk.id) ? { pk:pk, c:clip(pk.id) } : null; }
  function render(){
    if(!plan || !plan.rows || !plan.rows.length){ $("plOut").hidden = true; $("plRows").innerHTML = ""; return; }
    var found = plan.rows.filter(function(r){ return chosen(r); }).length;
    $("plOut").hidden = false;
    $("plInfo").textContent = "เจอคลิปให้ " + found + "/" + plan.rows.length + " บรรทัด · ใช้ไป " + U.money(plan.cost || 0) + " · " + ((plan.ms || 0) / 1000).toFixed(0) + " วิ · แตะรูปเล็กด้านล่างแต่ละบรรทัดเพื่อสลับฉาก";
    $("plRows").innerHTML = plan.rows.map(function(r, k){
      var ch = chosen(r), sc = ch && ch.c.scenes[ch.pk.si];
      return '<div class="pl' + (r.use ? "" : " off") + '"><div class="ln"><i>' + (k + 1) + "</i>" + U.esc(r.line) + "</div>"
        + '<div class="want">🎬 ' + U.esc(r.scene || "-") + (r.backup ? "<br>สำรอง: " + U.esc(r.backup) : "") + "</div>"
        + (sc ? U.card(ch.c, sc, false, ch.pk.why) : '<div class="none">' + (r.err ? "หาไม่ได้: " + U.esc(r.err) : "ไม่มีฉากที่ตรงในดัชนี (ลองหาเองตามคำอธิบายด้านบน)") + "</div>")
        + (r.picks.length > 1 ? '<div class="alts">' + r.picks.map(function(pk, j){ var c = clip(pk.id), s = c && c.scenes[pk.si];
            return s ? '<button class="alt' + (j === r.sel ? " on" : "") + '" data-alt="' + k + "|" + j + '" aria-label="ใช้ตัวเลือกนี้"><img src="' + s.thumb + '" alt=""></button>' : ""; }).join("") + "</div>" : "")
        + (sc ? '<label class="chk"><input type="checkbox" data-use="' + k + '"' + (r.use ? " checked" : "") + "> ใช้บรรทัดนี้ตอนแชร์</label>" : "")
        + "</div>";
    }).join("");
    renderShare();
  }
  $("plRows").addEventListener("click", function(e){
    var b = e.target.closest("[data-alt]"); if(!b) return;
    var p = b.dataset.alt.split("|"); plan.rows[+p[0]].sel = +p[1]; save(KEY, plan); render();
  });
  $("plRows").addEventListener("change", function(e){
    var c = e.target.closest("[data-use]"); if(!c) return;
    plan.rows[+c.dataset.use].use = c.checked; save(KEY, plan); render();
  });

  /* ---------- แชร์ไป CapCut / คัดลอกรายการ ---------- */
  /* ฉากที่ใช้ เรียงตามบท (บรรทัดติดกันใช้ฉากเดียวกัน = ไฟล์เดียว) */
  function picked(){
    var out = [];
    plan.rows.forEach(function(r, k){ var ch = r.use && chosen(r); if(!ch) return;
      var last = out[out.length - 1];
      if(last && last.c.id === ch.c.id && last.si === ch.pk.si) last.lines.push(k + 1); else out.push({ c:ch.c, si:ch.pk.si, sc:ch.c.scenes[ch.pk.si], lines:[k + 1] });
    });
    return out;
  }
  function sig(list){ return list.map(function(x){ return x.c.id + "#" + x.si; }).join(","); }

  /* ---------- ต่อฉากทั้งหมดเป็นวิดีโอไฟล์เดียวในเครื่อง ----------
     แชร์หลายไฟล์ไม่เวิร์ก: Brave/Chrome Android จำกัด ≤10 ไฟล์ ≤50 MB ต่อครั้ง และ CapCut รับแชร์เข้าโปรเจกต์เดิมซ้ำไม่ได้ ลำดับไฟล์ก็ไม่แน่นอน
     เลยเล่นทีละฉาก (เฉพาะช่วง) วาดลง canvas + ส่งเสียงผ่าน WebAudio แล้วอัดต่อกันด้วย MediaRecorder ตัวเดียว (pause ระหว่างเปลี่ยนฉาก)
     ได้ 1 ไฟล์เรียงตามบท + ตารางเวลาว่าแต่ละบรรทัดเริ่มวินาทีไหน · อัดเวลาจริง ต้องเปิดหน้าค้างไว้ */
  var MAX_BYTES = 45 * 1024 * 1024, MAX_RATE = 8e6, MIN_RATE = 2e6;
  var cuts = null, cutting = false; /* cuts = { sig, file, url, marks:[{lines, at, len}] } หายเมื่อปิดหน้า */
  function recMime(){
    var c = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    return window.MediaRecorder ? c.find(function(m){ return MediaRecorder.isTypeSupported(m); }) || "" : null;
  }
  function once(el, ev){ return new Promise(function(ok, no){ el.addEventListener(ev, ok, { once:true }); el.addEventListener("error", function(){ no(new Error("เปิดไฟล์วิดีโอไม่ได้")); }, { once:true }); }); }
  async function openVid(file){
    var v = document.createElement("video"); v.playsInline = true; v.preload = "auto";
    v.style.cssText = "position:fixed;left:-9999px;width:2px;height:2px"; document.body.appendChild(v);
    v.src = URL.createObjectURL(file); await once(v, "loadedmetadata"); return v;
  }
  function closeVid(v){ v.pause(); URL.revokeObjectURL(v.src); v.removeAttribute("src"); v.load(); v.remove(); }
  async function record(list, mime, ac, onStep){
    var secs = list.reduce(function(t, x){ return t + (x.sc.e - x.sc.s); }, 0);
    var rate = Math.max(MIN_RATE, Math.min(MAX_RATE, MAX_BYTES * 8 / Math.max(secs, 1) * 0.85)); /* ให้ไฟล์รวมไม่เกินเพดานแชร์ */
    var first = await openVid(U.fileFor(list[0].c)), W = first.videoWidth || 1080, H = first.videoHeight || 1080; closeVid(first);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H; var g = cv.getContext("2d");
    var dest = ac.createMediaStreamDestination();
    var stream = new MediaStream(cv.captureStream(30).getVideoTracks().concat(dest.stream.getAudioTracks()));
    var rec = new MediaRecorder(stream, { mimeType:mime, videoBitsPerSecond:rate, audioBitsPerSecond:128000 }), parts = [], marks = [], at = 0;
    rec.ondataavailable = function(ev){ if(ev.data && ev.data.size) parts.push(ev.data); };
    var stopped = new Promise(function(ok){ rec.onstop = ok; });
    try{
      for(var i = 0; i < list.length; i++){
        var x = list[i], v = await openVid(U.fileFor(x.c)), src = null;
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
  function renderBatches(){
    var list = picked(), ok = cuts && cuts.sig === sig(list);
    if(!ok){ $("plBatches").innerHTML = ""; return; }
    $("plBatches").innerHTML = '<video class="plvid" src="' + cuts.url + '" controls playsinline></video>'
      + '<button class="btn" id="plSend" style="width:100%;margin-top:10px">แชร์ไป CapCut (1 ไฟล์ · ' + (cuts.file.size / 1048576).toFixed(1) + " MB)</button>"
      + '<p class="hint">จุดเริ่มของแต่ละบรรทัดในไฟล์ (แยกคลิปใน CapCut ตรงเวลาเหล่านี้):</p><ol class="marks">'
      + cuts.marks.map(function(m){ return "<li><b>" + m.at.toFixed(1) + " วิ</b> · บรรทัด " + m.lines.join(",") + " · " + U.esc(m.c.album) + " " + U.tm(m.sc.s) + " (" + m.len.toFixed(1) + " วิ)</li>"; }).join("") + "</ol>";
  }
  function renderShare(){
    var list = picked(), miss = list.filter(function(x){ return !U.fileFor(x.c); }), alb = {};
    miss.forEach(function(x){ alb[x.c.album] = (alb[x.c.album] || 0) + 1; });
    var done = cuts && cuts.sig === sig(list);
    $("plShare").textContent = done ? "✂ ทำใหม่อีกรอบ" : "✂ ต่อ " + list.length + " ฉากเป็นวิดีโอเดียว";
    $("plShare").disabled = cutting || !list.length || miss.length > 0;
    $("plNeed").hidden = !miss.length;
    $("plNeedTxt").innerHTML = "ยังไม่ได้เปิดไฟล์ " + miss.length + "/" + list.length + " ฉาก จากอัลบั้ม: <b>" + Object.keys(alb).map(function(a){ return U.esc(a) + " (" + alb[a] + ")"; }).join(", ") + "</b>"
      + "<br>วิธีเร็ว: กดปุ่มด้านล่าง → เข้าโฟลเดอร์ชื่ออัลบั้ม (มักอยู่ใน Movies หรือ DCIM) → กดค้างคลิปแรก → ⋮ → เลือกทั้งหมด → เลือก · แอพคัดเอาเฉพาะคลิปที่ใช้ให้เอง ทำทีละอัลบั้มได้";
    if(!cutting) U.msg("plShareMsg", !list.length ? "" : miss.length ? lastPick
      : done ? "ต่อไว้แล้ว " + cuts.marks.length + " ฉาก ยาว " + cuts.marks.reduce(function(t, m){ return t + m.len; }, 0).toFixed(1) + " วิ · ดูตัวอย่างด้านล่างก่อนแชร์ได้"
      : "ไฟล์ครบแล้ว กด ✂ แอพจะเล่นเฉพาะช่วงฉากเรียงตามบทแล้วอัดต่อกันเป็นวิดีโอเดียว (ใช้เวลา ≈ " + Math.round(list.reduce(function(t, x){ return t + (x.sc.e - x.sc.s); }, 0)) + " วิ · เปิดหน้าค้างไว้)", done && !miss.length ? "ok" : "");
    renderBatches();
  }
  var lastPick = "";
  FT.onFiles = function(n){
    if(!plan) return;
    var list = picked(), got = list.filter(function(x){ return U.fileFor(x.c); }).length;
    lastPick = "เลือกมา " + n + " ไฟล์ → ตรงกับแผน " + got + "/" + list.length + " ฉาก" + (got < list.length ? " · เปิดอัลบั้มที่เหลือต่อได้เลย (ของเดิมไม่หาย)" : "");
    renderShare();
  };
  $("plDocs").addEventListener("click", function(){ U.openFiles(true); });
  $("plGal").addEventListener("click", function(){ U.openFiles(false); });
  $("plShare").addEventListener("click", async function(){
    var list = picked(), mime = recMime(), AC = window.AudioContext || window.webkitAudioContext;
    if(!mime || !AC || !HTMLCanvasElement.prototype.captureStream){ U.msg("plShareMsg", "เบราว์เซอร์นี้อัดวิดีโอไม่ได้ ใช้ปุ่ม คัดลอกรายการ แทน", "err"); return; }
    var ac = new AC(); ac.resume(); /* สร้างตอนกดปุ่ม (ต้องมีการแตะก่อนถึงจะเปิดเสียงได้) */
    if(cuts){ URL.revokeObjectURL(cuts.url); cuts = null; }
    cutting = true; renderShare(); $("plProg").hidden = false; $("plBar").style.width = "0"; await U.wake(true);
    try{
      var r = await record(list, mime, ac, function(i, x){
        U.msg("plShareMsg", "กำลังอัดฉาก " + (i + 1) + "/" + list.length + " (" + x.c.album + " " + U.tm(x.sc.s) + "–" + U.tm(x.sc.e) + ") · อย่าสลับแอพ");
        $("plBar").style.width = (i / list.length * 100) + "%";
      });
      if(!r.blob.size) throw new Error("อัดได้ไฟล์ว่าง");
      var d = new Date(), ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm", out = r.blob;
      if(ext === "mp4" && window.MP4Fix){ U.msg("plShareMsg", "กำลังจัดไฟล์ให้ CapCut อ่านได้..."); out = await MP4Fix.remux(r.blob); } /* MediaRecorder ให้ fragmented MP4 ซึ่ง CapCut ไม่รับ */
      var file = new File([out], "meowrin_" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + "." + ext, { type:out.type || r.blob.type });
      cuts = { sig:sig(list), file:file, url:URL.createObjectURL(file), marks:r.marks };
      cutting = false; renderShare();
      U.msg("plShareMsg", "เสร็จแล้ว " + r.marks.length + " ฉาก · " + (file.size / 1048576).toFixed(1) + " MB · " + (r.rate / 1e6).toFixed(1) + " Mbps (" + mime + ")" + (mime.indexOf("avc1") < 0 ? " · ไม่ใช่ H.264 ถ้า CapCut ไม่รับ บอกได้เลย" : "") + " · ดูตัวอย่างด้านล่างก่อนแชร์", "ok");
    }catch(err){ cutting = false; renderShare(); U.msg("plShareMsg", "อัดไม่ได้: " + err.message + (document.hidden ? " (สลับแอพระหว่างอัด?)" : ""), "err"); }
    ac.close(); $("plProg").hidden = true; await U.wake(false);
  });
  $("plBatches").addEventListener("click", async function(e){
    if(!e.target.closest("#plSend") || !cuts) return;
    var files = [cuts.file];
    if(!navigator.canShare || !navigator.canShare({ files:files })){ U.msg("plShareMsg", "เบราว์เซอร์นี้แชร์ไฟล์นี้ไม่ได้ ใช้ปุ่ม คัดลอกรายการ แทน", "err"); return; }
    try{ await navigator.share({ files:files, title:"ฟุตเทจตามบท" }); }
    catch(err){ if(err && err.name !== "AbortError") U.msg("plShareMsg", "แชร์ไม่ได้: " + err.message + (cuts.file.size > 50 * 1048576 ? " (ไฟล์เกิน 50 MB ลองติ๊กไม่ใช้บางบรรทัด)" : ""), "err"); }
  });
  $("plCopy").addEventListener("click", function(){
    var txt = plan.rows.map(function(r, k){ var ch = r.use && chosen(r), sc = ch && ch.c.scenes[ch.pk.si];
      return (k + 1) + ". " + r.line + "\n   → " + (sc ? ch.c.album + " · " + ch.c.name + " (" + U.capDur(ch.c.duration) + ") ฉาก " + U.tm(sc.s) + "–" + U.tm(sc.e) : "ไม่มีในคลัง: " + r.scene); }).join("\n");
    var b = this;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function(){ b.textContent = "คัดลอกแล้ว"; setTimeout(function(){ b.textContent = "คัดลอกรายการ"; }, 1500); })
      .catch(function(){ window.prompt("คัดลอกตรงนี้", txt); });
  });

  renderSrc();
  /* ดัชนีโหลดจาก IndexedDB หลังหน้าเปิด → วาดแผนเดิมเมื่อเข้าแท็บนี้ (render ตอนกดแท็บ) */
})();
