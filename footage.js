/* footage.js — หน้าจอของ "ดัชนีฟุตเทจ" (ทดสอบ): คิวทำดัชนี · ต้นทุน/เวลา · ค้นหา · ตั้งค่า/สำรอง/debug
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
  function day(ms){ return new Date(ms).toLocaleDateString("th-TH", { day:"numeric", month:"short", year:"2-digit" }); }

  var lib = [];          /* คลิปที่ทำดัชนีแล้วทั้งหมด (จาก IndexedDB) */
  var queue = [];        /* คิวรอบนี้ [{ file, id, album, status: wait|run|done|error|skip, err, p, info, raw }] */
  var running = false, paused = false, runCost = 0, runStart = 0, tick = 0;
  function mmss(ms){ var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + pad(s % 60); }
  function refreshLib(){ return FT.store.all().then(function(a){ lib = a || []; renderAll(); }); }
  function byId(id){ return lib.find(function(c){ return c.id === id; }); }

  /* ---------- แท็บ ---------- */
  document.querySelector(".tabs").addEventListener("click", function(e){
    var b = e.target.closest("button[data-p]"); if(!b) return;
    document.querySelectorAll(".tabs button").forEach(function(x){ x.classList.toggle("on", x === b); });
    document.querySelectorAll(".page").forEach(function(p){ p.classList.toggle("on", p.id === "p-" + b.dataset.p); });
    if(b.dataset.p === "find") search();
    window.scrollTo(0, 0);
  });

  /* ---------- เลือกไฟล์ → คิว ---------- */
  $("files").addEventListener("change", function(){
    var album = $("album").value.trim() || "ไม่ระบุ", picked = Date.now();
    var add = Array.prototype.map.call(this.files, function(f){
      var id = FT.clipId(f), done = byId(id);
      return { file:f, id:id, album:album, status: done && done.status === "done" ? "skip" : "wait", err:"", p:0,
               info:{ name:f.name, type:f.type, size:f.size, lastModified:f.lastModified, picked:picked } };
    });
    queue = queue.filter(function(q){ return q.status === "run"; }).concat(add.filter(function(a){ return !queue.some(function(q){ return q.id === a.id && q.status === "run"; }); }));
    this.value = "";
    renderQueue(); renderDebug();
  });
  $("album").addEventListener("input", function(){ /* เปลี่ยนชื่ออัลบั้มก่อนกดเริ่ม = ใช้กับคลิปที่ยังรออยู่ */
    var a = this.value.trim() || "ไม่ระบุ"; queue.forEach(function(q){ if(q.status === "wait") q.album = a; }); renderQueue();
  });

  function renderQueue(){
    if(!queue.length){ $("queue").innerHTML = '<li class="empty">ยังไม่ได้เลือกไฟล์</li>'; }
    else $("queue").innerHTML = queue.map(function(q){
      var c = byId(q.id), tag = { wait:["รอ",""], run:["กำลังทำ " + Math.round(q.p * 100) + "%","run"], done:["เสร็จ","ok"], error:["error","err"], skip:["ทำแล้ว (ข้าม)","ok"] }[q.status];
      var sub = q.status === "run" ? esc((q.stage || "เริ่ม...") + " · " + mmss(Date.now() - q.t0)) : c && c.status === "done" ? c.scenes.length + " ฉาก · " + money(c.cost || 0) + " · " + ((c.ms || 0) / 1000).toFixed(0) + " วิ · " + capDur(c.duration) : esc(q.album || "ไม่ระบุอัลบั้ม");
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
    var el = running ? Date.now() - runStart : 0, eta = running && fin ? el / fin * (work.length - fin) : 0;
    $("progTxt").textContent = work.length ? "เสร็จ " + fin + "/" + work.length + " คลิป" + (running ? " · ผ่านไป " + mmss(el) + (fin && fin < work.length ? " · เหลือประมาณ " + mmss(eta) : "") : "") + (runCost ? " · รอบนี้ใช้ไป " + money(runCost) + " จากงบ " + money(cfg.budget) : "") : "";
    renderEst();
  }

  /* ---------- ทำดัชนี ---------- */
  var wl = null;
  async function wake(on){
    try{
      if(on && !wl && "wakeLock" in navigator){ wl = await navigator.wakeLock.request("screen"); wl.addEventListener("release", function(){ wl = null; }); }
      if(!on && wl){ await wl.release(); wl = null; }
    }catch(e){ /* บางเครื่อง/โหมดประหยัดแบตไม่ให้ใช้ ไม่เป็นไร */ }
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
    running = true; paused = false; msg("runMsg", ""); await wake(true);
    runStart = Date.now(); clearInterval(tick); tick = setInterval(renderQueue, 1000); /* นาฬิกาเดินทุกวินาทีระหว่างทำ */
    renderQueue();
    for(var q; !paused && (q = queue.find(function(x){ return x.status === "wait"; })); ){
      if(runCost >= cfg.budget) break;
      await processClip(q);
    }
    running = false; clearInterval(tick); await wake(false);
    var left = queue.some(function(x){ return x.status === "wait"; });
    if(left && runCost >= cfg.budget) msg("runMsg", "ถึงเพดานงบรอบนี้ " + money(cfg.budget) + " แล้ว พักไว้ก่อน (ปรับงบได้ที่แท็บตั้งค่า แล้วกด ทำต่อ)", "err");
    else if(left && paused) msg("runMsg", document.hidden ? "พักไว้เพราะสลับแอพ กลับมาแล้วกด ทำต่อ" : "พักแล้ว กด ทำต่อ เมื่อพร้อม");
    else if(!queue.some(function(x){ return x.status === "wait"; })) msg("runMsg", "เสร็จรอบนี้แล้ว · ใช้ไป " + money(runCost), "ok");
    paused = false; renderQueue();
  }

  var CHUNK = 8; /* กี่ฉากต่อคำขอ AI */
  async function processClip(q){
    var t0 = Date.now(), cost = 0, tin = 0, tout = 0, raw = [];
    q.status = "run"; q.p = 0; q.err = ""; q.t0 = t0; renderQueue();
    try{
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
        raw:raw, cost:cost, tokens:{ in:tin, out:tout }, ms:Date.now() - t0, msScan:msScan, msAI:Date.now() - t0 - msScan, model:cfg.model, at:Date.now(), status:"done" };
      await FT.store.put(rec);
      lib = lib.filter(function(c){ return c.id !== rec.id; }).concat([rec]);
      q.status = "done"; q.p = 1;
    }catch(err){
      q.raw = raw;
      if(err.budget || document.hidden){ q.status = "wait"; q.p = 0; if(err.budget) paused = true; } /* ยังไม่ใช่ error จริง ทำใหม่ได้ */
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

  /* ---------- ค้นหา (ในเครื่อง ไม่เรียก AI ยกเว้นติ๊กแปลคำค้น) ---------- */
  var NAMES = [ /* ชื่อไทย/อังกฤษที่สะกดได้หลายแบบ — เจอในคำค้นจะใช้ทุกแบบค้น */
    ["luffy","ลูฟี่","ลูฟี","ลูฟฟี่"],["zoro","โซโร","โซโล"],["nami","นามิ"],["usopp","อุซป","อุซปป์","อุซบ"],["sanji","ซันจิ"],
    ["chopper","ช็อปเปอร์","ชอปเปอร์","ช๊อปเปอร์"],["robin","โรบิน"],["franky","แฟรงกี้","แฟรงค์กี้"],["brook","บรู๊ค","บรูค"],["jinbe","จินเบ","จินเบอิ"],
    ["ace","เอส"],["sabo","ซาโบ้","ซาโบ"],["shanks","แชงคูส","แชงค์"],["garp","การ์ป"],["buggy","บากี้"],["hancock","ฮันค็อก","แฮนค็อก"],
    ["law","ลอว์","ลอ"],["kid","คิด"],["yamato","ยามาโตะ"],["kaido","ไคโด"],["big mom","บิ๊กมัม"],["blackbeard","หนวดดำ","ทีช"],
    ["whitebeard","หนวดขาว"],["vivi","วีวี่"],["shirahoshi","ชิราโฮชิ"],["mihawk","มิฮอว์ค"],["dragon","ดราก้อน"],["koby","โคบี้"],["smoker","สโมกเกอร์"]
  ];
  var seg = null; try{ seg = new Intl.Segmenter("th", { granularity:"word" }); }catch(e){}
  function terms(q, extra){
    var out = [], rest = q.toLowerCase();
    NAMES.forEach(function(v){ if(v.some(function(n){ return rest.indexOf(n) >= 0; })){ out.push(v); v.forEach(function(n){ rest = rest.split(n).join(" "); }); } });
    rest.split(/[\s,]+/).filter(Boolean).forEach(function(p){
      if(/[฀-๿]/.test(p) && seg){
        var ws = Array.from(seg.segment(p)).filter(function(x){ return x.isWordLike && x.segment.length >= 2; }).map(function(x){ return x.segment; });
        (ws.length ? ws : [p]).forEach(function(w){ out.push([w]); });
      } else if(p.length >= 2) out.push([p]);
    });
    (extra || []).forEach(function(x){ x = String(x).toLowerCase().trim(); if(x && !out.some(function(v){ return v.indexOf(x) >= 0; })) out.push([x]); });
    return out;
  }
  function hay(c, sc){
    var a = sc.ai || {};
    return [ (a.characters || []).concat(a.characters_th || []).join(" ").toLowerCase(),
             (a.tags_en || []).concat(a.tags_th || [], [a.action, a.emotion]).join(" ").toLowerCase(),
             [a.summary_th, a.location, c.summary_th].join(" ").toLowerCase() ]; /* ไม่รวมชื่ออัลบั้ม (กรองด้วยตัวเลือกอัลบั้มแทน) */
  }
  var aiTerms = {}, sT = 0, shown = []; /* shown = รายการที่โชว์อยู่ (ให้ปุ่มดูรูปใหญ่อ้างถึง) */
  $("q").addEventListener("input", function(){ clearTimeout(sT); sT = setTimeout(search, 250); });
  $("albumFilter").addEventListener("change", search);
  $("aiQuery").addEventListener("change", search);
  async function search(){
    var q = $("q").value.trim(), al = $("albumFilter").value;
    var clips = lib.filter(function(c){ return c.status === "done" && (!al || c.album === al); });
    if(!q){ return browse(clips); }
    var extra = [];
    if($("aiQuery").checked){
      if(!aiTerms[q]){
        $("findInfo").textContent = "กำลังให้ AI แปลคำค้น...";
        try{ var r = await FT.expandQuery(q); aiTerms[q] = r.terms; runCost += r.cost; }catch(err){ aiTerms[q] = []; $("findInfo").textContent = "แปลคำค้นไม่ได้: " + err.message; }
      }
      extra = aiTerms[q];
      if(q !== $("q").value.trim()) return; /* พิมพ์ต่อระหว่างรอ */
    }
    var ts = terms(q, extra), hits = []; shown = [];
    clips.forEach(function(c){ c.scenes.forEach(function(sc){
      var h = hay(c, sc), hit = 0, score = 0;
      ts.forEach(function(v){
        var w = [4, 2, 1].find(function(_, k){ return v.some(function(n){ return h[k].indexOf(n) >= 0; }); });
        if(w){ hit++; score += w; }
      });
      if(hit) hits.push({ c:c, sc:sc, hit:hit, score:score });
    }); });
    hits.sort(function(a, b){ return b.hit - a.hit || b.score - a.score; });
    $("findInfo").textContent = "คำค้น: " + ts.map(function(v){ return v[0]; }).join(" + ") + " · เจอ " + hits.length + " ฉาก" + (hits.length > 60 ? " (โชว์ 60 อันดับแรก)" : "");
    $("results").innerHTML = hits.length ? hits.slice(0, 60).map(function(h){ return card(h.c, h.sc); }).join("") : '<p class="empty">ไม่เจอฉากที่ตรง ลองคำอื่น หรือติ๊กให้ AI แปลคำค้น</p>';
  }
  function browse(clips){ /* ไม่พิมพ์คำค้น = โชว์ทุกคลิปพร้อมสรุป (แก้ปัญหาเห็นแค่ปก) */
    shown = [];
    clips = clips.slice().sort(function(a, b){ return a.album.localeCompare(b.album) || b.lastModified - a.lastModified; });
    $("findInfo").textContent = clips.length + " คลิปในดัชนี · พิมพ์คำค้นเพื่อหาฉาก";
    $("results").innerHTML = clips.length ? clips.map(function(c){ return card(c, null); }).join("") : '<p class="empty">ยังไม่มีคลิปในดัชนี ไปที่แท็บ ทำดัชนี ก่อน</p>';
  }
  function card(c, sc){
    var a = sc && sc.ai || {}, who = (a.characters_th && a.characters_th.length ? a.characters_th : a.characters || []).join(", ");
    var k = shown.push({ c:c, sc:sc || c.scenes[0] }) - 1; /* แตะปก/ฉาก = ดูรูปใหญ่ */
    return '<div class="card"><div class="shots"><div class="cover" data-k="' + k + '"><img src="' + (c.cover || "") + '" alt="ปกคลิป"><em>' + capDur(c.duration) + "</em></div>"
      + (sc ? '<img class="scene" src="' + sc.thumb + '" alt="ฉาก" data-k="' + k + '">' : "") + '</div><div class="t">'
      + "<b>" + esc(c.album) + "</b>" + (sc ? ' · <span class="when">ฉาก ' + tm(sc.s) + "–" + tm(sc.e) + "</span>" : " · " + c.scenes.length + " ฉาก")
      + "<p>" + esc(sc ? (a.summary_th || "(AI ไม่ได้อธิบายฉากนี้)") : (c.summary_th || "")) + "</p>"
      + (who ? "<p>👤 " + esc(who) + "</p>" : "")
      + '<p>' + day(c.lastModified) + '</p><div class="fname">' + esc(c.name) + "</div></div></div>";
  }
  $("results").addEventListener("click", function(e){
    var el = e.target.closest("[data-k]"), h = el && shown[+el.dataset.k], c = h && h.c, sc = h && h.sc;
    if(!sc) return;
    $("bigImg").src = sc.img || sc.thumb; $("bigTxt").textContent = c.album + " · " + capDur(c.duration) + " · ฉาก " + tm(sc.s) + "–" + tm(sc.e) + (sc.ai && sc.ai.summary_th ? " · " + sc.ai.summary_th : "");
    $("big").hidden = false;
  });
  $("big").addEventListener("click", function(){ this.hidden = true; });

  /* ---------- ตั้งค่า ---------- */
  $("model").value = cfg.model; $("budget").value = cfg.budget; $("par").value = cfg.par; $("thr").value = cfg.thr; $("maxScenes").value = cfg.maxScenes;
  function setNum(id, k, min, max){
    $(id).addEventListener("change", function(){ var v = Number(this.value); if(!(v >= min)) v = min; if(v > max) v = max; cfg[k] = v; this.value = v; FT.saveCfg(); renderQueue(); });
  }
  setNum("budget", "budget", 0.05, 100); setNum("par", "par", 1, 4); setNum("maxScenes", "maxScenes", 1, 60);
  $("model").addEventListener("change", function(){ cfg.model = this.value.trim() || "google/gemini-3.8-flash"; this.value = cfg.model; FT.saveCfg(); });
  $("thr").addEventListener("input", function(){ cfg.thr = Number(this.value); $("thrVal").textContent = cfg.thr.toFixed(2); FT.saveCfg(); });
  $("thrVal").textContent = Number(cfg.thr).toFixed(2);
  $("keyInfo").textContent = FT.orKey() ? "✓ ใช้ OpenRouter key จากแอพหลักในเบราว์เซอร์นี้" : "⚠ ยังไม่เจอ OpenRouter key ในเบราว์เซอร์นี้ ใส่ที่แอพหลัก (ตั้งค่า) ก่อน";

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
    var cur = $("albumFilter").value;
    $("albumFilter").innerHTML = '<option value="">ทุกอัลบั้ม</option>' + as.map(function(a){ return '<option value="' + esc(a) + '">' + esc(a) + "</option>"; }).join("");
    $("albumFilter").value = as.indexOf(cur) >= 0 ? cur : "";
  }
  function renderAll(){ renderQueue(); renderStats(); renderDb(); renderAlbums(); renderDebug(); if($("p-find").classList.contains("on")) search(); }

  refreshLib().catch(function(err){ msg("runMsg", "เปิดฐานข้อมูลไม่ได้: " + err.message, "err"); });
})();
