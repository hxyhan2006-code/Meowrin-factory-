/* footage.js — หน้าจอของ "ดัชนีฟุตเทจ" (ทดสอบ): คิวทำดัชนี · ต้นทุน/เวลา · ตั้งค่า/สำรอง/debug (ค้นหาอยู่ใน footage-find.js)
   ใช้ window.FT จาก footage-core.js */
(function(){
  "use strict";
  var FT = window.FT, cfg = FT.cfg;
  var $ = function(id){ return document.getElementById(id); };
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
  function msg(id, text, kind){ $(id).innerHTML = text ? '<div class="msg ' + (kind || "") + '">' + esc(text) + "</div>" : ""; }
  function money(x){ return "$" + (x < 0.1 ? x.toFixed(4) : x.toFixed(2)); }
  function pad(n){ return String(n).padStart(2, "0"); }
  function capDur(sec){ sec = Math.round(sec); return pad(Math.floor(sec / 60)) + ":" + pad(sec % 60); } /* แบบที่ CapCut โชว์บนปก เช่น 00:24 */
  function tm(sec){ sec = Math.round(sec); return Math.floor(sec / 60) + ":" + pad(sec % 60); }

  var sv = document.querySelector('script[src^="footage.js"]'), vm = sv && /v=(\w+)/.exec(sv.getAttribute("src"));
  if(vm) $("ver").textContent = "ทดสอบ · รุ่น " + vm[1]; /* ไว้เช็กว่าเบราว์เซอร์โหลดไฟล์ใหม่แล้ว (มือถือแคชไฟล์เก่า) */
  var lib = [];          /* คลิปที่ทำดัชนีแล้วทั้งหมด (จาก IndexedDB) */
  var queue = [];        /* คิวรอบนี้ [{ file, id, album, status: wait|run|done|error|skip, err, p, info, raw }] */
  var running = false, paused = false, runCost = 0, runStart = 0, tick = 0;
  var capMsg = ""; /* ข้อความเมื่อชนเพดานค่าใช้จ่ายรวม (budget.js) */
  var etaBase = 0, etaAt = 0; /* เวลาที่เหลือ (ms) ประเมินใหม่ทุกครั้งที่คลิปเสร็จ แล้วนับถอยหลังเรียบๆ ระหว่างนั้น → ตัวเลขไม่เด้งขึ้นลง */
  function etaUpdate(){ /* ถ่วงด้วยขนาดไฟล์ (คลิปใหญ่ใช้เวลานานกว่า ทั้งอ่านเฟรม/AI/อัปโหลด) จากเวลาจริงของคลิปที่ทำเสร็จในรอบนี้ */
    var work = queue.filter(function(q){ return q.status !== "skip"; }), dn = work.filter(function(q){ return (q.status === "done" || q.status === "error") && q.tEnd && q.t0; });
    if(dn.length < 2) return; /* ยังน้อยไป ประเมินไม่นิ่ง */
    var sum = function(a, f){ return a.reduce(function(t, q){ return t + f(q); }, 0); };
    var ms = sum(dn, function(q){ return q.tEnd - q.t0; }), mbDone = sum(dn, function(q){ return (q.info.size || 0) / 1048576; });
    var rest = work.filter(function(q){ return q.status === "wait" || q.status === "run"; }), mbLeft = sum(rest, function(q){ return (q.info.size || 0) / 1048576; });
    etaBase = mbDone > 1 ? ms / mbDone * mbLeft : ms / dn.length * rest.length; etaAt = Date.now();
  }
  function mmss(ms){ var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + pad(s % 60); }
  function refreshLib(){ return FT.store.all().then(function(a){ lib = a || []; renderAll(); document.dispatchEvent(new Event("ft:lib")); }); } /* ft:lib = ดัชนีโหลด/เปลี่ยนแล้ว (ให้ footage-pick.js วาดแถบที่เลือกไว้ใหม่) */
  function byId(id){ return lib.find(function(c){ return c.id === id; }); }
  function findClip(f){ /* แกลเลอรีมือถือส่ง lastModified ไม่เหมือนเดิม และตัวเลือกรูป (Google Photos) ส่งชื่อเป็นเลข เช่น 21347.mp4 แต่แอพไฟล์ส่งชื่อจริง
                           → จับด้วยชื่อ+ขนาด แล้วถอยไปขนาดอย่างเดียว (ไบต์เท่ากันเป๊ะ = ไฟล์เดียวกันแทบแน่นอน) ถ้ามีคลิปขนาดนั้นตัวเดียว */
    var c = byId(FT.clipId(f)) || lib.find(function(c){ return c.name === f.name && c.size === f.size; }); if(c) return c;
    var same = lib.filter(function(c){ return c.size === f.size; }); return same.length === 1 ? same[0] : null;
  }

  /* ---------- แท็บ ---------- */
  document.querySelector(".tabs").addEventListener("click", function(e){
    var b = e.target.closest("button[data-p]"); if(!b) return;
    document.querySelectorAll(".tabs button").forEach(function(x){ x.classList.toggle("on", x === b); });
    document.querySelectorAll(".page").forEach(function(p){ p.classList.toggle("on", p.id === "p-" + b.dataset.p); });
    if(b.dataset.p === "find" && FT.ui.search) FT.ui.search(); /* footage-find.js */
    window.scrollTo(0, 0);
  });

  /* ---------- เลือกไฟล์ → คิว ---------- */
  var VIDEO = /\.(mp4|m4v|mov|webm|mkv|3gp)$/i;
  function addFiles(list){
    var typed = $("album").value.trim(), album = typed || "ไม่ระบุ", picked = Date.now(), up = FT.cloud && FT.cloud.ready(); /* ตั้งค่าคลังไว้ = อัปขึ้นคลังอัตโนมัติ */
    var files = Array.prototype.filter.call(list, function(f){ return /^video\//.test(f.type) || VIDEO.test(f.name); }), other = list.length - files.length; /* แอพไฟล์เลือกทั้งโฟลเดอร์ได้ → ตัดรูป/ไฟล์อื่นทิ้ง */
    var add = files.map(function(f){
      var done = findClip(f), id = done ? done.id : FT.clipId(f), fin = done && done.status === "done";
      var old = fin && (done.imgV || 1) < FT.IMG_V; /* รูปรุ่นเก่า (เล็ก/เบลอ) → วาดใหม่ฟรี */
      var relabel = fin && !!typed && done.album !== typed; /* เลือกคลิปเดิมซ้ำพร้อมพิมพ์อัลบั้มใหม่ → แก้ชื่ออัลบั้มให้ (ไม่เรียก AI) */
      var cloud = up && fin && !done.r2; /* ทำดัชนีแล้วแต่ยังไม่อยู่ในคลัง → อัปอย่างเดียว */
      var mode = old ? "up" : relabel ? "label" : cloud ? "cloud" : "";
      return { file:f, id:id, album:album, mode:mode, toCloud:up, status: fin && !mode ? "skip" : "wait", err:"", p:0,
               info:{ name:f.name, type:f.type, size:f.size, lastModified:f.lastModified, picked:picked } };
    });
    queue = queue.filter(function(q){ return q.status === "run"; }).concat(add.filter(function(a){ return !queue.some(function(q){ return q.id === a.id && q.status === "run"; }); }));
    /* สรุปให้รู้ก่อนกดเริ่ม: อะไรเสียค่า AI อะไรอัปอย่างเดียว อะไรข้าม (เลือกทั้งอัลบั้มซ้ำได้ ไม่ทำซ้ำ) */
    var n = function(fn){ return add.filter(fn).length; };
    var nNew = n(function(q){ return q.status === "wait" && !q.mode; }), nUp = n(function(q){ return q.mode === "cloud"; }), nFix = n(function(q){ return q.mode === "up" || q.mode === "label"; }), nSkip = n(function(q){ return q.status === "skip"; });
    msg("runMsg", "เลือกมา " + add.length + " คลิป" + (other ? " (ตัดไฟล์ที่ไม่ใช่วิดีโอ " + other + ")" : "") + " · ใหม่ทำดัชนี " + nNew + (nNew ? " (เสียค่า AI ≈ " + money(nNew * avgCost()) + ")" : "") + " · อัปขึ้นคลังอย่างเดียว " + nUp + " · แก้รูป/อัลบั้ม " + nFix + " · มีครบแล้ว ข้าม " + nSkip, nNew ? "" : "ok");
    renderQueue(); renderDebug();
  }
  function avgCost(){ var d = lib.filter(function(c){ return c.status === "done" && c.cost; }); return d.length ? d.reduce(function(t, c){ return t + c.cost; }, 0) / d.length : 0.014; }
  $("filesDocs").addEventListener("change", function(){ addFiles(this.files); this.value = ""; });
  $("filesDocsBtn").addEventListener("click", function(){ $("filesDocs").click(); });
  $("album").addEventListener("input", function(){ /* เปลี่ยนชื่ออัลบั้มก่อนกดเริ่ม = ใช้กับคลิปที่ยังรออยู่ */
    var a = this.value.trim() || "ไม่ระบุ"; queue.forEach(function(q){ if(q.status === "wait") q.album = a; }); renderQueue();
  });

  function renderQueue(){
    if(!queue.length){ $("queue").innerHTML = '<li class="empty">ยังไม่ได้เลือกไฟล์</li>'; }
    else $("queue").innerHTML = queue.map(function(q){
      var c = byId(q.id), tag = { wait:[q.mode === "up" ? "รออัปเกรดรูป" : q.mode === "label" ? "รอแก้อัลบั้ม" : q.mode === "cloud" ? "รออัปขึ้นคลัง" : q.key ? "รอ (จากคลัง)" : "รอ",""], run:["กำลังทำ " + Math.round(q.p * 100) + "%","run"], done:["เสร็จ","ok"], error:["error","err"], skip:["ทำแล้ว (ข้าม)","ok"] }[q.status];
      var sub = q.status === "run" ? esc((q.stage || "เริ่ม...") + " · " + mmss(Date.now() - q.t0)) : q.mode === "cloud" && q.status === "wait" ? "ทำดัชนีแล้ว · จะอัปไฟล์ขึ้นคลัง (ไม่เรียก AI)" : q.mode === "label" && q.status === "wait" ? "จะเปลี่ยนอัลบั้ม “" + esc(c.album) + "” → “" + esc(q.album) + "” (ไม่เรียก AI)" : q.mode === "up" && q.status === "wait" ? "รูปรุ่นเก่า (เบลอ) · จะวาดรูปใหม่ ไม่เรียก AI" + (q.album !== "ไม่ระบุ" && q.album !== c.album ? " + เปลี่ยนอัลบั้มเป็น “" + esc(q.album) + "”" : "") : c && c.status === "done" ? c.scenes.length + " ฉาก · " + money(c.cost || 0) + " · " + ((c.ms || 0) / 1000).toFixed(0) + " วิ · " + capDur(c.duration) : esc(q.album || "ไม่ระบุอัลบั้ม");
      return '<li><img ' + (c && c.cover ? 'src="' + c.cover + '" ' : "") + 'alt=""><div class="t"><b>' + esc(q.info.name) + "</b><span>" + sub + "</span>"
        + (q.err ? '<br><span style="color:var(--err)">' + esc(q.err) + "</span>" : "") + '</div><span class="tag ' + tag[1] + '">' + tag[0] + "</span></li>";
    }).join("");
    var wait = queue.filter(function(q){ return q.status === "wait"; }).length, errs = queue.filter(function(q){ return q.status === "error"; }).length;
    $("startBtn").disabled = running || !wait; /* อัลบั้มไม่บังคับ (ว่าง = "ไม่ระบุ") */
    $("startBtn").textContent = running ? "กำลังทำ..." : wait ? (queue.some(function(q){ return q.status === "done" || q.status === "error"; }) ? "ทำต่อ " : "เริ่มทำดัชนี ") + wait + " คลิป" : "เริ่มทำดัชนี";
    $("pauseBtn").hidden = !running; $("pauseBtn").textContent = paused ? "จะพักหลังคลิปนี้..." : "พัก";
    $("retryBtn").hidden = running || !errs; $("retryBtn").textContent = "ลองใหม่คลิปที่ error (" + errs + ")";
    var work = queue.filter(function(q){ return q.status !== "skip"; }), fin = work.filter(function(q){ return q.status === "done" || q.status === "error"; }).length;
    var cur = work.find(function(q){ return q.status === "run"; });
    var pct = work.length ? (fin + (cur ? cur.p : 0)) / work.length : 0;
    $("progBar").style.width = Math.round(pct * 100) + "%";
    var el = running ? Date.now() - runStart : 0, left = running && etaAt ? Math.max(0, etaBase - (Date.now() - etaAt)) : -1;
    $("progTxt").textContent = work.length ? "เสร็จ " + fin + "/" + work.length + " คลิป" + (running ? " · ผ่านไป " + mmss(el) + (fin < work.length ? (left < 0 ? " · กำลังประเมินเวลา..." : left < 8000 ? " · ใกล้เสร็จ" : " · เหลือประมาณ " + mmss(Math.round(left / 5000) * 5000)) : "") : "") + (runCost ? " · รอบนี้ใช้ไป " + money(runCost) + " จากงบ " + money(cfg.budget) : "") : "";
    renderEst();
  }

  /* ---------- ทำดัชนี ---------- */
  /* กันจอดับระหว่างทำ: Wake Lock ก่อน · ไม่ได้ (เครื่อง/โหมดประหยัดแบตไม่ยอม) → เล่นวิดีโอเปล่า 1 ตัววนไว้ (เบราว์เซอร์ไม่ดับจอตอนเล่นวิดีโอ) · ป้ายสถานะ #wakeInfo บอกว่าใช้วิธีไหนอยู่/กันไม่ได้ */
  var wl = null, nsVid = null, wakeMode = "";
  var NOSLEEP = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJAEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIq7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYiTV9gKWu43OJyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCBILqBIJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYiTV9gKWu43OGfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVAheeBAKOkgQAAgDACAJ0BKiAAIAAARwiFhYiFhIgCAgAHkPPJwP7/q1CAo5WBAMgAsQEAARAQABgAGFgv9AAIcACjlYEBkACxAQABEBAAGAAYWC/0AAhwAKOVgQJYALEBAAEQEAAYABhYL/QACHAAo5WBAyAAsQEAARAQABgAGFgv9AAIcAAcU7trkbuPs4EAt4r3gQHxggGf8IED";
  function nsStop(){ if(nsVid){ nsVid.pause(); nsVid.remove(); nsVid = null; } }
  async function wake(on){
    if(!on){ wakeMode = ""; nsStop(); try{ if(wl){ await wl.release(); wl = null; } }catch(e){} renderWake(); return; }
    if(wl || nsVid) return;
    try{
      if("wakeLock" in navigator){ wl = await navigator.wakeLock.request("screen"); wakeMode = "lock";
        wl.addEventListener("release", function(){ wl = null; if(running && !document.hidden) wake(true); }); /* ระบบปล่อยเอง (เช่นประหยัดแบต) → ขอใหม่ */
        renderWake(); return; }
    }catch(e){ /* ตกไปใช้วิดีโอ */ }
    try{
      nsVid = document.createElement("video"); nsVid.muted = true; nsVid.loop = true; nsVid.playsInline = true; nsVid.setAttribute("playsinline", "");
      nsVid.style.cssText = "position:fixed;left:-9999px;width:2px;height:2px"; nsVid.src = NOSLEEP; document.body.appendChild(nsVid);
      await nsVid.play(); wakeMode = "video";
    }catch(e){ nsStop(); wakeMode = "none"; }
    renderWake();
  }
  function renderWake(){
    var el = $("wakeInfo"); if(!el) return;
    el.hidden = !running && !wakeMode;
    el.className = "hint " + (wakeMode === "none" ? "bad" : "");
    el.textContent = wakeMode === "lock" ? "🔆 จอไม่ดับระหว่างทำ ✓ (ต่อให้ตั้งเวลาปิดจอของเครื่องไว้สั้นก็ไม่ดับ)"
      : wakeMode === "video" ? "🔆 จอไม่ดับระหว่างทำ ✓ (ใช้วิธีเล่นวิดีโอเปล่าแทน เพราะเครื่องไม่ให้ใช้ Wake Lock)"
      : wakeMode === "none" ? "⚠ กันจอดับไม่ได้ ตั้งเวลาปิดจอของมือถือให้นานสุด และอย่าให้จอล็อก ไม่งั้นจะพักเอง" : "";
  }
  document.addEventListener("visibilitychange", function(){
    if(!running) return;
    if(document.hidden){ paused = true; renderQueue(); } /* สลับแอพ = เบราว์เซอร์หยุดอ่านวิดีโอ → พักหลังคลิปนี้ */
    else wake(true);
  });
  $("pauseBtn").addEventListener("click", function(){ paused = true; renderQueue(); });
  $("startBtn").addEventListener("click", function(){ run(); });
  $("retryBtn").addEventListener("click", function(){ queue.forEach(function(q){ if(q.status === "error"){ q.status = "wait"; q.err = ""; } }); run(); });

  async function run(){
    if(running) return;
    if(!FT.orKey()){ msg("runMsg", "ยังไม่มี OpenRouter key ในเบราว์เซอร์นี้ ไปใส่ในแอพหลัก (ตั้งค่า → OpenRouter API key) ก่อน", "err"); return; }
    running = true; paused = false; capMsg = ""; msg("runMsg", ""); await wake(true);
    runStart = Date.now(); etaBase = etaAt = 0; clearInterval(tick); renderWake(); tick = setInterval(renderQueue, 1000); /* นาฬิกาเดินทุกวินาทีระหว่างทำ */
    renderQueue();
    for(var q; !paused && (q = queue.find(function(x){ return x.status === "wait"; })); ){
      if(runCost >= cfg.budget && q.mode !== "up") break;
      await processClip(q); q.tEnd = Date.now(); etaUpdate();
    }
    running = false; clearInterval(tick); await wake(false);
    var left = queue.some(function(x){ return x.status === "wait"; });
    if(left && capMsg) msg("runMsg", capMsg, "err");
    else if(left && runCost >= cfg.budget) msg("runMsg", "ถึงเพดานงบรอบนี้ " + money(cfg.budget) + " แล้ว พักไว้ก่อน (ปรับงบได้ที่แท็บตั้งค่า แล้วกด ทำต่อ)", "err");
    else if(left && paused) msg("runMsg", document.hidden ? "พักไว้เพราะสลับแอพ กลับมาแล้วกด ทำต่อ" : "พักแล้ว กด ทำต่อ เมื่อพร้อม");
    else if(!queue.some(function(x){ return x.status === "wait"; })) msg("runMsg", "เสร็จรอบนี้แล้ว · ใช้ไป " + money(runCost), "ok");
    paused = false; renderQueue();
    if(window.MWDrive) MWDrive.autoFootage(); /* เชื่อม Drive อยู่ → อัปคลิปที่เพิ่งทำขึ้นไปเลย */
  }

  var CHUNK = 8; /* กี่ฉากต่อคำขอ AI */
  async function upgradeClip(q){ /* วาดรูปใหม่ตามช่วงฉากเดิม ไม่ยุ่งผลของ AI */
    var c = byId(q.id); q.status = "run"; q.p = 0; q.err = ""; q.t0 = Date.now(); q.stage = "วาดรูปใหม่ให้คมขึ้น..."; renderQueue();
    try{
      var r = await FT.refreshImages($("vid"), q.file, c, function(p){ q.p = p; renderQueue(); });
      if(q.album && q.album !== "ไม่ระบุ") c.album = q.album;
      c.cover = r.cover; c.scenes.forEach(function(sc, i){ sc.img = r.imgs[i].img; sc.thumb = r.imgs[i].thumb; }); c.imgV = FT.IMG_V;
      await FT.store.put(c); q.status = "done"; q.p = 1; q.mode = "";
    }catch(err){ if(document.hidden){ q.status = "wait"; q.p = 0; } else { q.status = "error"; q.err = err.message || String(err); } }
    renderAll();
  }
  async function cloudClip(q){
    var c = byId(q.id); q.status = "run"; q.p = 0; q.err = ""; q.t0 = Date.now(); q.stage = "อัปขึ้นคลัง..."; renderQueue();
    try{ await FT.cloud.upload(c, q.file, function(p){ q.p = p; q.stage = "อัปขึ้นคลัง " + Math.round(p * 100) + "%"; renderQueue(); }); q.status = "done"; q.p = 1; q.mode = ""; }
    catch(err){ if(document.hidden || err.budget){ q.status = "wait"; q.p = 0; if(err.budget){ paused = true; capMsg = err.message; } } else { q.status = "error"; q.err = err.message || String(err); } }
    renderAll();
  }
  async function labelClip(q){
    var c = byId(q.id); c.album = q.album; q.status = "run"; renderQueue();
    try{ await FT.store.put(c); q.status = "done"; q.p = 1; q.mode = ""; }catch(err){ q.status = "error"; q.err = err.message || String(err); }
    renderAll();
  }
  async function alsoUpload(q){ /* แก้อัลบั้ม/อัปเกรดรูปเสร็จแล้ว ถ้าติ๊กอัปขึ้นคลังไว้และยังไม่อยู่ในคลัง → อัปต่อในรอบเดียวกัน */
    var c = byId(q.id); if(q.status !== "done" || !q.toCloud || !q.file || !c || c.r2) return;
    q.status = "run"; q.stage = "อัปขึ้นคลัง..."; renderQueue();
    try{ await FT.cloud.upload(c, q.file, function(p){ q.stage = "อัปขึ้นคลัง " + Math.round(p * 100) + "%"; renderQueue(); }); }
    catch(err){ q.err = "อัปขึ้นคลังไม่ได้: " + (err.message || err); }
    q.status = "done"; renderAll();
  }
  async function processClip(q){
    if(q.mode === "label") return labelClip(q).then(function(){ return alsoUpload(q); });
    if(q.mode === "up") return upgradeClip(q).then(function(){ return alsoUpload(q); });
    if(q.mode === "cloud") return cloudClip(q);
    var t0 = Date.now(), cost = 0, tin = 0, tout = 0, raw = [];
    q.status = "run"; q.p = 0; q.err = ""; q.t0 = t0; renderQueue();
    try{
      if(!q.file && q.key){ /* คลิปจากคลัง → โหลดทั้งไฟล์มาก่อน (อ่านเฟรมจากในเครื่องเร็วกว่ากรอผ่านเน็ตมาก) */
        q.stage = "โหลดจากคลัง...";
        q.file = await FT.cloud.fetch(q, function(p){ q.stage = "โหลดจากคลัง " + Math.round(p * 100) + "%"; renderQueue(); });
      }
      q.stage = "กำลังเปิดวิดีโอ...";
      var m = await FT.scan($("vid"), q.file, function(p){ q.p = p * 0.5; q.stage = p < 0.7 ? "อ่านเฟรมหาจุดตัดฉาก..." : "จับภาพตัวแทนแต่ละฉาก..."; renderQueue(); });
      var msScan = Date.now() - t0; /* เวลาอ่านเฟรม+ตัดฉาก (ยังไม่นับ AI) */
      q.stage = "ฉากทั้งหมด " + m.scenes.length + " · ส่งให้ AI ดู...";
      q.info.duration = m.duration; q.info.w = m.w; q.info.h = m.h; renderDebug();
      m.scenes.forEach(function(sc, i){ sc.n = i + 1; });
      var chunks = []; for(var i = 0; i < m.scenes.length; i += CHUNK) chunks.push(m.scenes.slice(i, i + CHUNK));
      var sums = [], doneChunks = 0;
      for(i = 0; i < chunks.length; i += cfg.par){
        if(runCost >= cfg.budget) throw Object.assign(new Error("ถึงเพดานงบ"), { budget:true });
        await Promise.all(chunks.slice(i, i + cfg.par).map(async function(ch, k){
          try{
            var r = await FT.describe(ch, q.album, m.duration);
            cost += r.cost; tin += r.tin; tout += r.tout; runCost += r.cost;
            raw.push({ chunk:i + k + 1, text:r.text });
            if(r.json.clip_summary_th) sums[i + k] = String(r.json.clip_summary_th);
            (Array.isArray(r.json.scenes) ? r.json.scenes : []).forEach(function(a){
              var sc = ch.find(function(x){ return x.n === Number(a.i); }); if(sc) sc.ai = cleanAi(a);
            });
          }catch(err){ if(err.raw) raw.push({ chunk:i + k + 1, text:err.raw }); if(err.cost){ cost += err.cost; runCost += err.cost; } throw err; }
          finally{ doneChunks++; q.p = 0.5 + doneChunks / chunks.length * 0.5; q.stage = "AI ตอบแล้ว " + doneChunks + "/" + chunks.length + " ชุด"; renderQueue(); }
        }));
      }
      var rec = { id:q.id, name:q.info.name, album:q.album, size:q.info.size, type:q.info.type, lastModified:q.info.lastModified,
        duration:m.duration, w:m.w, h:m.h, cover:m.cover, summary_th: sums.filter(Boolean).join(" / "),
        scenes: m.scenes.map(function(sc){ return { s:sc.s, e:sc.e, thumb:sc.thumb, img:sc.img, ai:sc.ai || null }; }),
        raw:raw, cost:cost, tokens:{ in:tin, out:tout }, ms:Date.now() - t0, imgV:FT.IMG_V, msScan:msScan, msAI:Date.now() - t0 - msScan, model:cfg.model, at:Date.now(), status:"done" };
      if(q.key) rec.r2 = q.key;
      await FT.store.put(rec);
      lib = lib.filter(function(c){ return c.id !== rec.id; }).concat([rec]);
      if(q.toCloud && !rec.r2){ /* ติ๊กอัปขึ้นคลัง: อัปต่อเลย (อัปไม่ผ่านไม่ถือว่าดัชนีพัง) */
        try{ q.stage = "อัปขึ้นคลัง..."; renderQueue(); await FT.cloud.upload(rec, q.file, function(p){ q.stage = "อัปขึ้นคลัง " + Math.round(p * 100) + "%"; renderQueue(); }); }
        catch(err){ q.err = "ทำดัชนีเสร็จ แต่อัปขึ้นคลังไม่ได้: " + (err.message || err); if(err.budget){ paused = true; capMsg = err.message; } } /* ชนเพดานคลัง → พักคิว ไม่ทำดัชนีต่อทั้งที่อัปไม่ได้ */
      }
      if(q.key) q.file = null; /* ไฟล์ที่โหลดจากคลังกินแรม ปล่อยทิ้ง */
      q.status = "done"; q.p = 1;
    }catch(err){
      q.raw = raw;
      if(err.budget || document.hidden){ q.status = "wait"; q.p = 0; if(err.budget){ paused = true; capMsg = err.message === "ถึงเพดานงบ" ? "" : err.message; } } /* ยังไม่ใช่ error จริง ทำใหม่ได้ · capMsg = ชนเพดานรวมใน budget.js */
      else { q.status = "error"; q.err = err.message || String(err); }
    }
    renderAll();
  }
  function arr(x){ return Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 12) : []; }
  function cleanAi(a){
    return { characters:arr(a.characters), characters_th:arr(a.characters_th), action:String(a.action || ""), emotion:String(a.emotion || ""),
             location:String(a.location || ""), tags_en:arr(a.tags_en), tags_th:arr(a.tags_th), summary_th:String(a.summary_th || "") };
  }

  /* ---------- ต้นทุน/เวลา ---------- */
  function totals(){
    var d = lib.filter(function(c){ return c.status === "done"; }), t = { clips:d.length, scenes:0, cost:0, ms:0, tin:0, tout:0, scan:0, ai:0, dur:0 };
    d.forEach(function(c){ t.scan += c.msScan || 0; t.ai += c.msAI || 0; t.dur += c.duration || 0; t.scenes += c.scenes.length; t.cost += c.cost || 0; t.ms += c.ms || 0; t.tin += (c.tokens || {}).in || 0; t.tout += (c.tokens || {}).out || 0; });
    return t;
  }
  function renderStats(){
    var t = totals(), n = t.clips || 1, s = t.scenes || 1;
    var rows = [["คลิปในดัชนี", t.clips], ["ฉากทั้งหมด", t.scenes], ["ต้นทุนรวม", money(t.cost)], ["รอบนี้", money(runCost)],
      ["ต้นทุน/คลิป", t.clips ? money(t.cost / n) : "-"], ["ต้นทุน/ฉาก", t.scenes ? money(t.cost / s) : "-"],
      ["เวลา/คลิป", t.clips ? (t.ms / n / 1000).toFixed(1) + " วิ" : "-"], ["โทเคน เข้า/ออก", t.tin.toLocaleString() + " / " + t.tout.toLocaleString()],
      ["ส่วนอ่านเฟรม/คลิป", t.scan ? (t.scan / n / 1000).toFixed(1) + " วิ" : "-"], ["ส่วน AI/คลิป", t.ai ? (t.ai / n / 1000).toFixed(1) + " วิ" : "-"],
      ["เวลา ต่อวิดีโอ 1 นาที", t.dur ? (t.ms / t.dur * 60 / 1000).toFixed(0) + " วิ" : "-"], ["ต้นทุน ต่อวิดีโอ 1 นาที", t.dur ? money(t.cost / t.dur * 60) : "-"]];
    $("stats").innerHTML = rows.map(function(r){ return '<div class="stat"><b>' + esc(r[1]) + "</b><span>" + r[0] + "</span></div>"; }).join("");
  }
  function renderEst(){
    var t = totals(), wait = queue.filter(function(q){ return q.status === "wait"; }).length;
    $("estTxt").textContent = !wait ? "" : t.clips ? "ประมาณการคิวที่เหลือ " + wait + " คลิป ≈ " + money(t.cost / t.clips * wait) + " · " + Math.ceil(t.ms / t.clips * wait / 60000) + " นาที (จากค่าเฉลี่ยที่ทำไปแล้ว)"
      : "ยังประมาณไม่ได้ ทำคลิปแรกเสร็จแล้วจะคำนวณให้";
  }


  /* ---------- ตั้งค่า ---------- */
  $("model").value = cfg.model; $("budget").value = cfg.budget; $("par").value = cfg.par; $("thr").value = cfg.thr; $("maxScenes").value = cfg.maxScenes;
  function setNum(id, k, min, max){
    $(id).addEventListener("change", function(){ var v = Number(this.value); if(!(v >= min)) v = min; if(v > max) v = max; cfg[k] = v; this.value = v; FT.saveCfg(); renderQueue(); });
  }
  setNum("budget", "budget", 0.05, 100); setNum("par", "par", 1, 4); setNum("maxScenes", "maxScenes", 1, 60);
  $("model").addEventListener("change", function(){ cfg.model = this.value.trim() || "google/gemini-3.8-flash"; this.value = cfg.model; FT.saveCfg(); });
  $("thr").addEventListener("input", function(){ cfg.thr = Number(this.value); $("thrVal").textContent = cfg.thr.toFixed(2); FT.saveCfg(); });
  $("thrVal").textContent = Number(cfg.thr).toFixed(2);
  function setTag(id, kind, text){ var el = $(id); el.className = "state " + kind; el.textContent = text; } /* ป้ายสีบนหัวข้อที่พับอยู่ในตั้งค่า */
  function tagsSet(){
    setTag("tagAi", FT.orKey() ? "ok" : "warn", FT.orKey() ? String(cfg.model).replace(/^.*\//, "") : "ไม่มี key");
    setTag("tagCut", "idle", "ไว " + Number(cfg.thr).toFixed(2) + " · ≤" + cfg.maxScenes + " ฉาก");
  }
  ["model", "thr", "maxScenes"].forEach(function(id){ $(id).addEventListener("input", tagsSet); }); tagsSet();
  $("keyInfo").textContent = FT.orKey() ? "✓ ใช้ OpenRouter key จากแอพหลักในเบราว์เซอร์นี้" : "⚠ ยังไม่เจอ OpenRouter key ในเบราว์เซอร์นี้ ใส่ที่แอพหลัก (ตั้งค่า) ก่อน";

  /* ---------- ลบคลิปซ้ำ: ชื่อไฟล์+ขนาดเดียวกัน เก็บตัวที่ทำล่าสุด ---------- */
  function findDupes(){ /* คืน { del:[id ที่จะลบ], fix:[รายการที่ต้องแก้อัลบั้ม] } */
    var g = {}, del = [], fix = [];
    /* ซ้ำ = ขนาดไบต์เท่ากัน + ความยาวเท่ากัน (ไม่ดูชื่อ เพราะไฟล์เดียวกันได้ชื่อต่างกันตามตัวเลือกไฟล์ เช่น 21347.mp4 กับ Screenrecorder-....mp4) */
    lib.forEach(function(c){ var k = c.size + "|" + Math.round((c.duration || 0) * 10); (g[k] = g[k] || []).push(c); });
    Object.keys(g).forEach(function(k){
      var a = g[k]; if(a.length < 2) return;
      a.sort(function(x, y){ return (y.r2 ? 1 : 0) - (x.r2 ? 1 : 0) || (y.at || 0) - (x.at || 0); }); /* ตัวแรก = อยู่ในคลังแล้ว (เล่นได้) ถ้าเท่ากันเอาที่ทำล่าสุด → เก็บไว้ */
      var real = a.find(function(c){ return c.album && c.album !== "ไม่ระบุ"; }); /* อัลบั้มจริงของตัวไหนก็ได้ ดีกว่า "ไม่ระบุ" */
      if(real && a[0].album !== real.album){ a[0].album = real.album; fix.push(a[0]); }
      a.slice(1).forEach(function(c){ del.push(c.id); });
    });
    return { del:del, fix:fix };
  }
  function mergeDupes(d){ return FT.store.putMany(d.fix).then(function(){ return FT.store.del(d.del); }).then(refreshLib); }
  $("dupBtn").addEventListener("click", function(){
    var d = findDupes();
    if(!d.del.length){ msg("dupMsg", "ไม่เจอคลิปซ้ำ (" + lib.length + " คลิป ขนาดไฟล์+ความยาวไม่ซ้ำกันเลย)", "ok"); return; }
    if(!window.confirm("เจอคลิปซ้ำ " + d.del.length + " รายการ จะลบตัวที่ซ้ำและเก็บตัวที่ทำล่าสุดไว้ ตกลงไหม?")) return;
    mergeDupes(d).then(function(){ msg("dupMsg", "ลบคลิปซ้ำแล้ว " + d.del.length + " รายการ เหลือ " + lib.length + " คลิป", "ok"); })
      .catch(function(err){ msg("dupMsg", "ลบไม่ได้: " + err.message, "err"); });
  });

  /* ---------- สำรอง/กู้คืน ---------- */
  $("exportBtn").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify({ v:1, at:Date.now(), clips:lib })], { type:"application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "meowrin-footage-index.json"; a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
  });
  $("importBtn").addEventListener("click", function(){ $("importFile").click(); });
  $("importFile").addEventListener("change", function(){
    var f = this.files[0]; this.value = ""; if(!f) return;
    f.text().then(function(t){
      var j = JSON.parse(t), arr = j && Array.isArray(j.clips) ? j.clips.filter(function(c){ return c && c.id && Array.isArray(c.scenes); }) : null;
      if(!arr) throw new Error("ไฟล์ไม่ใช่ไฟล์สำรองดัชนีฟุตเทจ");
      return FT.store.putMany(arr).then(function(){ msg("setMsg", "กู้คืนแล้ว " + arr.length + " คลิป (คลิปเดิมที่ id ซ้ำถูกแทนที่)", "ok"); return refreshLib(); });
    }).catch(function(err){ msg("setMsg", "กู้คืนไม่ได้: " + err.message, "err"); });
  });
  $("wipeBtn").addEventListener("click", function(){
    if(!window.confirm("ลบดัชนีฟุตเทจทั้งหมดในเครื่องนี้? (โหลดไฟล์สำรองไว้ก่อนถ้ายังต้องใช้)")) return;
    FT.store.clear().then(function(){ msg("setMsg", "ลบแล้ว", "ok"); return refreshLib(); });
  });
  function renderDb(){
    var n = lib.length, s = lib.reduce(function(x, c){ return x + c.scenes.length; }, 0), mb = new Blob([JSON.stringify(lib)]).size / 1048576;
    $("dbInfo").textContent = n + " คลิป · " + s + " ฉาก · ขนาดราว " + mb.toFixed(1) + " MB (รวมรูป)";
  }

  /* ---------- debug ---------- */
  function renderDebug(){
    var items = queue.slice(-20);
    if(!items.length){ $("debug").innerHTML = '<p class="empty">ยังไม่มีข้อมูล (เลือกไฟล์ในแท็บ ทำดัชนี)</p>'; return; }
    $("debug").innerHTML = items.map(function(q){
      var i = q.info, c = byId(q.id), raw = (c && c.raw) || q.raw || [];
      var near = Math.abs(i.picked - i.lastModified) < 10 * 60e3, generic = /^(\d{6,}|video|vid|image|msf:|document)/i.test(i.name);
      return '<details class="dbg"><summary>' + esc(i.name) + "</summary><pre>"
        + esc(["file.name: " + i.name + (generic ? "  ⚠ ชื่อดูเป็นเลขที่ระบบตั้งให้ ไม่ใช่ชื่อจริง" : "  ✓ ดูเป็นชื่อจริง"),
               "lastModified: " + new Date(i.lastModified).toLocaleString("th-TH") + (near ? "  ⚠ ใกล้เวลาที่เลือกไฟล์ น่าจะไม่ใช่วันที่จริง" : "  ✓"),
               "type: " + (i.type || "(ว่าง)") + " · size: " + (i.size / 1048576).toFixed(1) + " MB",
               "duration: " + (i.duration || c ? (i.duration || c.duration).toFixed(2) + " วิ · " + (i.w || c.w) + "×" + (i.h || c.h) : "(ยังไม่ได้อ่าน)"),
               "id: " + q.id].join("\n"))
        + "</pre>" + raw.map(function(r){ return "<pre>— คำตอบดิบ AI ชุดที่ " + r.chunk + " —\n" + esc(r.text) + "</pre>"; }).join("") + "</details>";
    }).join("");
  }

  function renderAlbums(){
    var as = lib.map(function(c){ return c.album; }).filter(function(a, i, s){ return a && s.indexOf(a) === i; }).sort();
    $("albumList").innerHTML = as.map(function(a){ return '<option value="' + esc(a) + '">'; }).join("");
    var ro = $("renOld").value;
    $("renOld").innerHTML = as.length ? as.map(function(a){ return '<option value="' + esc(a) + '">' + esc(a) + " (" + lib.filter(function(c){ return c.album === a; }).length + " คลิป)</option>"; }).join("") : '<option value="">ยังไม่มีอัลบั้ม</option>';
    if(as.indexOf(ro) >= 0) $("renOld").value = ro;
  }
  async function rename(clips, name){ /* เปลี่ยนอัลบั้มของคลิปที่ส่งมา แล้วบันทึกลงฐานข้อมูล */
    clips.forEach(function(c){ c.album = name; });
    await FT.store.putMany(clips); renderAll();
  }
  $("renBtn").addEventListener("click", function(){
    var from = $("renOld").value, to = $("renNew").value.trim();
    if(!from || !to){ msg("renMsg", "เลือกอัลบั้มเดิมและพิมพ์ชื่อใหม่ก่อน", "err"); return; }
    var hit = lib.filter(function(c){ return c.album === from; });
    rename(hit, to).then(function(){ $("renNew").value = ""; msg("renMsg", "เปลี่ยน “" + from + "” → “" + to + "” แล้ว " + hit.length + " คลิป", "ok"); })
      .catch(function(err){ msg("renMsg", "เปลี่ยนไม่ได้: " + err.message, "err"); });
  });
  /* ให้ไฟล์อื่นใช้ร่วม · footage-find.js เติม terms/hay/card/hasSrc/srcUrl/openFiles/search */
  FT.ui = { lib:function(){ return lib; }, esc:esc, msg:msg, money:money, tm:tm, capDur:capDur, refresh:refreshLib, rename:rename,
            addQueue:function(items){ queue = queue.filter(function(q){ return q.status !== "skip"; }).concat(items.filter(function(a){ return !queue.some(function(q){ return q.id === a.id; }); })); renderQueue(); },
            addCost:function(x){ runCost += x; renderStats(); }, wake:wake };
  function renderAll(){ renderQueue(); renderStats(); renderDb(); renderAlbums(); renderDebug(); if($("p-find").classList.contains("on") && FT.ui.search) FT.ui.search(); }

  refreshLib().then(function(){ /* เปิดหน้าครั้งไหน ถ้ามีรายการซ้ำเก่าค้าง รวมให้เองเลย (ลบแค่รายการดัชนีที่ซ้ำ ไม่แตะไฟล์วิดีโอ) */
    var d = findDupes(); if(!d.del.length) return;
    return mergeDupes(d).then(function(){ msg("runMsg", "รวมคลิปซ้ำให้อัตโนมัติแล้ว " + d.del.length + " รายการ (เก็บตัวที่ทำล่าสุด) เหลือ " + lib.length + " คลิป", "ok"); });
  }).catch(function(err){ msg("runMsg", "เปิดฐานข้อมูลไม่ได้: " + err.message, "err"); });
})();
