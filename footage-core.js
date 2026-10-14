/* footage-core.js — ส่วนไม่มีหน้าจอของหน้า "ดัชนีฟุตเทจ" (ทดสอบ)
   ตั้งค่า (localStorage mw_footage_cfg_v1) · ฐานข้อมูล (IndexedDB mw_footage_v1) · อ่านเฟรม/ตัดฉากจาก <video> · เรียก AI ดูรูปผ่าน OpenRouter
   ใช้ OpenRouter key ตัวเดียวกับแอพหลัก (mw_openrouter_key_v1) · ส่งออก window.FT */
(function(){
  "use strict";
  function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
  function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

  /* ---------- ตั้งค่า ---------- */
  var CFG = "mw_footage_cfg_v1";
  var cfg = Object.assign({ model:"google/gemini-3.8-flash", thr:0.18, maxScenes:30, budget:1, par:2 }, load(CFG, {}));
  function saveCfg(){ return save(CFG, cfg); }
  function orKey(){ return load("mw_openrouter_key_v1", ""); }

  /* ---------- IndexedDB: store "clips" (1 รายการต่อคลิป เก็บฉากไว้ในตัว) ----------
     { id, name, album, size, type, lastModified, duration, w, h, cover, summary_th, scenes:[{s,e,thumb,img,ai}],
       raw:[คำตอบดิบ AI], cost, tokens:{in,out}, ms, model, at, status:"done"|"error", err } */
  var dbp = null;
  function db(){
    if(dbp) return dbp;
    dbp = new Promise(function(res, rej){
      var r = indexedDB.open("mw_footage_v1", 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore("clips", { keyPath:"id" }); };
      r.onsuccess = function(){ res(r.result); };
      r.onerror = function(){ rej(r.error || new Error("เปิดฐานข้อมูลไม่ได้")); };
    });
    return dbp;
  }
  function tx(mode, fn){
    return db().then(function(d){ return new Promise(function(res, rej){
      var t = d.transaction("clips", mode), st = t.objectStore("clips"), out = fn(st);
      t.oncomplete = function(){ res(out && "result" in out ? out.result : undefined); };
      t.onerror = t.onabort = function(){ rej(t.error || new Error("บันทึกไม่ได้ (พื้นที่เต็ม?)")); };
    }); });
  }
  var store = {
    all: function(){ return tx("readonly", function(s){ return s.getAll(); }); },
    put: function(c){ return tx("readwrite", function(s){ s.put(c); }); },
    putMany: function(arr){ return tx("readwrite", function(s){ arr.forEach(function(c){ s.put(c); }); }); },
    clear: function(){ return tx("readwrite", function(s){ s.clear(); }); }
  };
  function clipId(f){ return f.name + "|" + f.size + "|" + f.lastModified; }

  /* ---------- อ่านวิดีโอ ---------- */
  function once(v, ok, ms, what){
    return new Promise(function(res, rej){
      var to = setTimeout(function(){ clean(); rej(new Error(what + " ช้าเกินไป")); }, ms);
      function done(){ clean(); res(); }
      function fail(){ clean(); rej(new Error("เบราว์เซอร์เปิดวิดีโอนี้ไม่ได้ (รูปแบบไฟล์ไม่รองรับ?)")); }
      function clean(){ clearTimeout(to); v.removeEventListener(ok, done); v.removeEventListener("error", fail); }
      v.addEventListener(ok, done); v.addEventListener("error", fail);
    });
  }
  function seek(v, t){ var p = once(v, "seeked", 10000, "เลื่อนวิดีโอ"); v.currentTime = t; return p; }
  async function openVideo(v, file){
    if(v.src) URL.revokeObjectURL(v.src);
    var p = once(v, "loadeddata", 20000, "เปิดวิดีโอ");
    v.src = URL.createObjectURL(file); v.load(); await p;
    if(!isFinite(v.duration)){ await seek(v, 1e7); await seek(v, 0.05); } /* บางไฟล์ไม่บอกความยาว ต้องเลื่อนไปท้ายก่อน */
    if(!(v.duration > 0) || !v.videoWidth) throw new Error("อ่านความยาว/ขนาดวิดีโอไม่ได้");
  }
  var cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently:true });
  function grab(v, w){ /* วาดเฟรมปัจจุบันลง canvas กว้าง w (สูงตามสัดส่วน) */
    cv.width = w; cv.height = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth));
    cx.drawImage(v, 0, 0, cv.width, cv.height);
  }
  function jpeg(v, w, q){ grab(v, w); return cv.toDataURL("image/jpeg", q); }
  function gray(v){ grab(v, 64); var d = cx.getImageData(0, 0, cv.width, cv.height).data, g = new Uint8Array(d.length / 4);
    for(var i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 3 + d[i+1] * 6 + d[i+2]) / 10; return g; }
  function diff(a, b){ var s = 0; for(var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length / 255; }

  /* สุ่มเฟรมทุก 1 วิ → หาจุดตัดฉาก → รวมฉากสั้น/ฉากเกินเพดาน → จับเฟรมกลางฉาก
     คืน { duration, w, h, cover, scenes:[{s,e,thumb,img,ai512}] } (ai512 ใช้ส่ง AI ไม่เก็บลงฐานข้อมูล) */
  var STEP = 1, MIN_SCENE = 1;
  var IMG = { cover:240, thumb:240, big:480, v:2 }; /* ขนาดรูปที่เก็บ (px กว้าง) · v = รุ่นของรูป (รุ่น 1 เล็กกว่า เบลอบนจอมือถือ) */
  async function scan(v, file, onStep){
    await openVideo(v, file);
    var dur = v.duration, ts = [];
    for(var t = 0.05; t < dur - 0.05; t += STEP) ts.push(t);
    if(!ts.length) ts.push(Math.min(0.05, dur / 2));
    await seek(v, ts[0]);
    var cover = jpeg(v, IMG.cover, 0.75), gs = [gray(v)], scenes = [{ s:0, score:1, idx:0 }];
    for(var i = 1; i < ts.length; i++){
      await seek(v, ts[i]); gs[i] = gray(v);
      var d = diff(gs[i-1], gs[i]);
      if(d > cfg.thr) scenes.push({ s:(ts[i-1] + ts[i]) / 2, score:d, idx:i });
      if(onStep) onStep(i / ts.length * 0.6);
    }
    scenes.forEach(function(sc, k){ sc.e = k + 1 < scenes.length ? scenes[k+1].s : dur; });
    function mergeAt(k){ scenes[k-1].e = scenes[k].e; scenes.splice(k, 1); } /* รวมฉาก k เข้าฉากก่อนหน้า */
    for(var k = scenes.length - 1; k >= 0 && scenes.length > 1; k--){
      if(scenes[k].e - scenes[k].s < MIN_SCENE) mergeAt(k > 0 ? k : 1);
    }
    while(scenes.length > cfg.maxScenes){ /* เกินเพดาน → รวมจุดตัดที่ต่างกันน้อยที่สุด */
      var m = 1; for(k = 2; k < scenes.length; k++) if(scenes[k].score < scenes[m].score) m = k;
      mergeAt(m);
    }
    /* จุดตัดที่เหลือ: แบ่งครึ่งช่วง 1 วิ อีก 3 รอบ ให้แม่น ~0.06 วิ (ไว้ตัดใน CapCut ตรงจุด) */
    for(k = 1; k < scenes.length; k++){
      var j = scenes[k].idx, lo = ts[j-1], hi = ts[j], gl = gs[j-1], gh = gs[j];
      for(var n = 0; n < 3; n++){
        var md = (lo + hi) / 2; await seek(v, md); var gm = gray(v);
        if(diff(gl, gm) > diff(gm, gh)){ hi = md; gh = gm; } else { lo = md; gl = gm; }
      }
      scenes[k].s = scenes[k-1].e = (lo + hi) / 2;
      if(onStep) onStep(0.6 + k / scenes.length * 0.1);
    }
    for(k = 0; k < scenes.length; k++){
      var sc = scenes[k], mid = Math.min(dur - 0.05, (sc.s + sc.e) / 2);
      await seek(v, Math.max(0.05, mid));
      sc.ai512 = jpeg(v, 512, 0.75); sc.img = jpeg(v, IMG.big, 0.78); sc.thumb = jpeg(v, IMG.thumb, 0.75); delete sc.score; delete sc.idx;
      if(onStep) onStep(0.7 + (k + 1) / scenes.length * 0.3);
    }
    return { duration:dur, w:v.videoWidth, h:v.videoHeight, cover:cover, scenes:scenes };
  }

  /* วาดรูปใหม่ให้คมขึ้นตามช่วงฉากเดิมที่เก็บไว้ (ไม่เรียก AI ไม่เสียค่า) คืน { cover, imgs:[{img,thumb}] } */
  async function refreshImages(v, file, rec, onStep){
    await openVideo(v, file);
    await seek(v, Math.min(0.05, v.duration / 2));
    var cover = jpeg(v, IMG.cover, 0.75), imgs = [];
    for(var k = 0; k < rec.scenes.length; k++){
      var sc = rec.scenes[k]; await seek(v, Math.max(0.05, Math.min(v.duration - 0.05, (sc.s + sc.e) / 2)));
      imgs.push({ img:jpeg(v, IMG.big, 0.78), thumb:jpeg(v, IMG.thumb, 0.75) });
      if(onStep) onStep((k + 1) / rec.scenes.length);
    }
    return { cover:cover, imgs:imgs };
  }

  /* ---------- OpenRouter ---------- */
  var URL_OR = "https://openrouter.ai/api/v1/chat/completions";
  async function post(body){
    var key = orKey(); if(!key) throw new Error("ยังไม่ได้ใส่ OpenRouter key ในแอพหลัก (ตั้งค่า → OpenRouter API key) บนเบราว์เซอร์นี้");
    var res, j;
    for(var a = 0; ; a++){
      res = await fetch(URL_OR, { method:"POST", headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + key }, body: JSON.stringify(body) });
      j = await res.json().catch(function(){ return {}; });
      if((res.status === 502 || res.status === 503) && a < 1){ await sleep(2500); continue; }
      break;
    }
    var er = j.error || (j.choices && j.choices[0] && j.choices[0].error);
    if(!res.ok || er){
      var st = (er && typeof er.code === "number") ? er.code : res.status, m = (er && er.message) || "";
      if(st === 400 && body.reasoning && /reasoning|thinking/i.test(m)){ delete body.reasoning; return post(body); }
      if(st === 401) throw new Error("OpenRouter key ใช้ไม่ได้");
      if(st === 402) throw new Error("เครดิต OpenRouter ไม่พอ");
      if(st === 429) throw new Error("ส่งถี่เกิน/โควตาเต็ม ลองใหม่อีกสักพัก");
      throw new Error("OpenRouter error " + st + (m ? ": " + m.slice(0, 160) : ""));
    }
    var t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if(typeof t !== "string" || !t.trim()) throw new Error("AI ไม่ตอบ");
    var u = j.usage || {};
    return { text:t, cost: typeof u.cost === "number" ? u.cost : 0, tin:u.prompt_tokens || 0, tout:u.completion_tokens || 0 };
  }
  function parseJSON(t){
    var s = t.replace(/```(?:json)?/gi, ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    if(a < 0 || b <= a) throw new Error("AI ไม่ได้ตอบเป็น JSON");
    return JSON.parse(s.slice(a, b + 1));
  }
  var PROMPT = [
    "You are indexing anime footage clips (mostly One Piece, Thai dub) for a video editor's search tool.",
    "Album label set loosely by the user (often WRONG: a Luffy scene may sit in a Zoro album, and scenes mix many characters): \"{album}\". Identify characters ONLY from what you see in each frame; use the label just to break ties. Clip length: {dur}s.",
    "Below are {n} frames, one per scene, in order. Each image is preceded by its scene number.",
    "Return ONLY JSON, no markdown:",
    "{\"clip_summary_th\":\"one short Thai sentence about what happens in these scenes\",",
    " \"scenes\":[{\"i\":<scene number>,\"characters\":[\"English common names e.g. Luffy, Zoro, Nami, Usopp, Sanji, Chopper, Robin, Franky, Brook, Jinbe, Ace, Sabo, Shanks, Garp, Buggy, Hancock, Law\"],",
    " \"characters_th\":[\"same characters in Thai as Thai fans write, e.g. ลูฟี่, โซโร, นามิ, อุซป, ซันจิ, ช็อปเปอร์, โรบิน, แฟรงกี้, บรู๊ค, จินเบ, เอส, ซาโบ้, แชงคูส, การ์ป\"],",
    " \"action\":\"short English\",\"emotion\":\"short English\",\"location\":\"short English\",",
    " \"tags_en\":[\"3-8 lowercase tags\"],\"tags_th\":[\"3-8 Thai tags e.g. ตกใจ, หัวเราะ, ต่อสู้, ร้องไห้, กิน\"],\"summary_th\":\"one short Thai sentence saying WHO does or feels WHAT, starting with that character's Thai name, e.g. ลูฟี่ตกใจเมื่อเห็นศัตรู (do not bury the subject: if a marine is shocked by Luffy, say ทหารเรือตกใจ, not ลูฟี่ตกใจ)\"}]}",
    "Rules: name a character only when reasonably sure, otherwise describe them in tags (e.g. marine soldier).",
    "List every notable visible character. One entry per scene number."
  ].join("\n");
  /* ส่งหลายฉากในคำขอเดียว (ประหยัดกว่า และ AI เห็นบริบทต่อเนื่องของคลิป) */
  async function describe(chunk, album, dur){
    var content = [{ type:"text", text: PROMPT.replace("{album}", album || "-").replace("{dur}", dur.toFixed(1)).replace("{n}", chunk.length) }];
    chunk.forEach(function(sc){
      content.push({ type:"text", text:"Scene " + sc.n + " (" + sc.s.toFixed(1) + "-" + sc.e.toFixed(1) + "s):" });
      content.push({ type:"image_url", image_url:{ url: sc.ai512 } });
    });
    var body = { model:cfg.model, messages:[{ role:"user", content:content }], usage:{ include:true } };
    if(/^google\//.test(cfg.model)) body.reasoning = { effort:"low" }; /* งานติดป้ายไม่ต้องคิดนาน ประหยัดโทเคน */
    var r = await post(body), j;
    try{ j = parseJSON(r.text); }catch(err){ err.raw = r.text; err.cost = r.cost; throw err; }
    r.json = j; return r;
  }
  /* แปลคำค้นไทย → คำค้นอังกฤษ/ชื่อตัวละคร (ข้อความล้วน เล็กมาก) */
  async function expandQuery(q){
    var r = await post({ model:cfg.model, usage:{ include:true }, messages:[{ role:"user", content:
      "Search query from a Thai One Piece video editor: \"" + q + "\"\nReturn ONLY JSON {\"terms\":[...]} with English character names and 2-6 short lowercase English tags that match it." }] });
    var j = parseJSON(r.text); r.terms = Array.isArray(j.terms) ? j.terms.map(String) : []; return r;
  }

  window.FT = { cfg:cfg, saveCfg:saveCfg, orKey:orKey, store:store, clipId:clipId, scan:scan, refreshImages:refreshImages, IMG_V:IMG.v, describe:describe, expandQuery:expandQuery };
})();
