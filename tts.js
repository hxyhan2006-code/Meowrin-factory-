/* tts.js — สร้างเสียงพากย์จากบท (PART 2) ด้วย ElevenLabs แล้วฟัง / แชร์ไป CapCut / ดาวน์โหลด mp3
   ช่วงวอร์ม: ElevenLabs มักเพี้ยน 2-4 วิแรก → ใส่ hook (หรือประโยคที่ตั้งไว้) ข้างหน้าก่อนส่ง
   แล้วขอเวลาของแต่ละตัวอักษรกลับมา เพื่อตัดช่วงวอร์มทิ้งจากไฟล์ mp3 ให้เลย (ตัดทีละเฟรม ไม่ต้องเข้ารหัสใหม่)
   อยู่ในแท็บ เสียง: อ่านบทจากช่อง #vText (ai.js ใส่บท PART 2 ของเวอร์ชันที่เลือกไว้ให้ และส่ง event "mw:script" เมื่อบทเปลี่ยน)
   ไฟล์เสียงไม่เก็บถาวร (ใหญ่เกินที่เก็บของเบราว์เซอร์) เก็บในหน่วยความจำระหว่างเปิดแอพเท่านั้น */
(function(){
  "use strict";
  var MW = window.MW; if(!MW) return;
  var $ = function(id){ return document.getElementById(id); };
  var KEY = "mw_eleven_key_v1", CFG = "mw_tts_cfg_v1";
  var API = "https://api.elevenlabs.io/v1/text-to-speech/";
  var MAX_CHARS = 5000; /* เพดานต่อคำขอของ ElevenLabs */
  var WARM_MIN = 40;    /* hook ที่ใช้วอร์มยาวอย่างน้อยกี่ตัวอักษร (ราว 3 วิ) */
  var ONSET_TH = 0.012, ONSET_SPAN = 2.5, ONSET_LEAD = 0.08; /* หาเสียงพูดเริ่มจริง: ระดับเสียงขั้นต่ำ (~-38 dB) · มองหาไม่เกินกี่วินาทีหลังจุดตัด · เหลือเงียบนำหน้ากี่วินาที */
  function load(k, d){ return MWStore.get(k, d); } /* store.js: IndexedDB + แคช */
  function save(k, v){ return MWStore.set(k, v); }
  function monthKey(){ var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

  /* ค่าเริ่มต้นตรงกับที่ Han ใช้บนเว็บ: Eleven v3 · Stability Natural (0.5) · ภาษาอัตโนมัติ · MP3 44.1kHz 128kbps
     warm = "hook" | "custom" | "off" · trim = ตัดช่วงวอร์มออกให้ · tsOff = เคยลองแล้วโมเดลนี้ไม่ส่งเวลาตัวอักษรมา */
  var cfg = Object.assign({ voice:"", voiceName:"", voices:[], model:"eleven_v3", stability:0.5, fmt:"mp3_44100_128",
                            warm:"hook", warmText:"", trim:true, tsOff:false, usage:{ m:"", chars:0, n:0 } }, load(CFG, {}));
  /* voices = รายการเสียงของฉัน [{id: รหัสในแอพ, name, vid: Voice ID}] · voice = Voice ID ที่เลือกใช้อยู่ (คงชื่อ key เดิมไว้) */
  function newId(){ return "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  if(!Array.isArray(cfg.voices)) cfg.voices = [];
  if(!cfg.voices.length && cfg.voice) cfg.voices.push({ id:newId(), name:cfg.voiceName || "เสียงของฉัน", vid:cfg.voice }); /* ย้ายจาก Voice ID ช่องเดียวแบบเดิม */
  if(cfg.voice && !cfg.voices.some(function(v){ return v.vid === cfg.voice; })) cfg.voice = "";
  if(!cfg.voice && cfg.voices.length) cfg.voice = cfg.voices[0].vid;
  function curVoice(){ return cfg.voices.find(function(v){ return v.vid === cfg.voice; }); }
  function saveCfg(){ var v = curVoice(); cfg.voiceName = v ? v.name : ""; return save(CFG, cfg); }

  /* ---------- เรียก ElevenLabs ---------- */
  async function call(withTs, text){
    var key = load(KEY, "");
    if(!key) throw new Error("ยังไม่ได้ใส่ ElevenLabs API key (แท็บตั้งค่า)");
    if(!cfg.voice) throw new Error("ยังไม่ได้เลือกเสียง (ตั้งค่า → เสียงพากย์ → เพิ่มเสียง แล้วเลือกที่ปุ่มตั้งค่าเสียงในแท็บ เสียง)");
    var res;
    try{
      res = await fetch(API + encodeURIComponent(cfg.voice) + (withTs ? "/with-timestamps" : "") + "?output_format=" + cfg.fmt, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": withTs ? "application/json" : "audio/mpeg" },
        body: JSON.stringify({ text: text, model_id: cfg.model, voice_settings: { stability: cfg.stability } })
      });
    }catch(err){ /* ไม่มี status เลย = เบราว์เซอร์ไม่ยอมส่ง (CORS) หรือเน็ตหลุด */
      throw new Error("ต่อ ElevenLabs ไม่ได้ เน็ตหลุด หรือเบราว์เซอร์บล็อกการเรียกตรง (CORS) ถ้าเน็ตปกติแต่ยังขึ้นแบบนี้ ส่งข้อความนี้ให้ Claude ดู [" + (err && err.message || "network") + "]");
    }
    if(res.ok) return res;
    var j = await res.json().catch(function(){ return {}; });
    var d = j.detail, st = (d && d.status) || (d && d.code) || "", m = (d && d.message) || (typeof d === "string" ? d : "");
    var raw = " [รหัส: " + res.status + (st ? " " + st : "") + "]", e;
    if(st === "missing_permissions" || /permission/i.test(m)) throw new Error("key นี้ไม่มีสิทธิ์ Text to Speech เปิดสิทธิ์ให้ key ใน ElevenLabs แล้วลองใหม่" + raw);
    if(st === "invalid_api_key" || res.status === 401 && !st) throw new Error("ElevenLabs API key ไม่ถูกต้อง เช็ก key ในตั้งค่า" + raw);
    if(st === "quota_exceeded" || /quota|credit/i.test(m)) throw new Error("เครดิต ElevenLabs ไม่พอสำหรับบทนี้" + raw);
    if(st === "voice_not_found" || /voice.*not found/i.test(m)) throw new Error("ไม่เจอ Voice ID นี้ในบัญชี เช็ก Voice ID ในตั้งค่า" + raw);
    if(res.status === 429) throw new Error("ElevenLabs คิวเต็ม/ส่งถี่เกินไป รอสักครู่แล้วลองใหม่" + raw);
    e = new Error("ElevenLabs error" + (m ? ": " + m : "") + raw);
    e.soft = withTs && [400, 404, 405, 422].indexOf(res.status) >= 0; /* แบบมีเวลาตัวอักษรอาจไม่รองรับโมเดลนี้ → ลองแบบธรรมดา */
    throw e;
  }
  function b64Blob(b64){
    var s = atob(b64), u = new Uint8Array(s.length);
    for(var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return new Blob([u], { type:"audio/mpeg" });
  }

  /* ---------- ช่วงวอร์ม ---------- */
  function warmFor(script){
    if(cfg.warm === "off") return "";
    if(cfg.warm === "custom") return cfg.warmText.trim();
    var w = []; /* hook = บรรทัดแรกๆ ของบท จนยาวพอ (หยุดที่บรรทัดว่าง) */
    script.split("\n").some(function(l){
      l = l.trim();
      if(!l) return w.length > 0;
      w.push(l); return w.join(" ").length >= WARM_MIN;
    });
    return w.join("\n");
  }
  /* วินาทีที่บทจริงเริ่ม (จาก alignment ที่ ElevenLabs ส่งมา) */
  function cutTime(al, sent, script){
    if(!al || !Array.isArray(al.characters) || !Array.isArray(al.character_start_times_seconds)) return null;
    var chars = al.characters, st = al.character_start_times_seconds, en = al.character_end_times_seconds || st;
    var joined = chars.join(""), head = script.trim().slice(0, 12);
    var at = joined === sent ? sent.length - script.length : joined.indexOf(head, Math.max(1, sent.length - script.length - 4));
    if(at < 0) return null;
    while(at < chars.length && /\s/.test(chars[at])) at++;
    var p = at - 1; while(p >= 0 && /\s/.test(chars[p])) p--;
    var tB = st[at], tA = p >= 0 ? en[p] : 0;
    if(!(tB > 0.3)) return null;
    return Math.max(tA, tB - 0.12); /* ตัดในช่วงเงียบก่อนบทจริงเริ่มนิดเดียว */
  }
  /* หาวินาทีที่เสียงพูดเริ่มจริงหลัง from (ถอดรหัส mp3 ด้วย Web Audio ของเบราว์เซอร์ ไม่ใช้ไลบรารี)
     เวลาตัวอักษรจาก ElevenLabs เร็วกว่าเสียงจริงเล็กน้อย → ตัดตามนั้นเฉยๆ จะเหลือเงียบต้นไฟล์ ~0.5 วิ · คืน null ถ้าถอดรหัสไม่ได้/ไม่เจอ */
  async function onsetTime(blob, from){
    var AC = window.AudioContext || window.webkitAudioContext; if(!AC) return null;
    var ctx = new AC();
    try{
      var buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      var d = buf.getChannelData(0), sr = buf.sampleRate, win = Math.round(sr * 0.01), run = 0, end = Math.min(d.length, (from + ONSET_SPAN) * sr);
      for(var i = Math.floor(from * sr); i + win <= end; i += win){
        var e = 0; for(var k = 0; k < win; k++) e += d[i + k] * d[i + k];
        if(Math.sqrt(e / win) > ONSET_TH){ if(++run === 2) return (i - win) / sr; } else run = 0; /* ดังต่อเนื่อง 2 หน้าต่าง (20 มิลลิวินาที) = เริ่มพูดแล้ว */
      }
      return null;
    }catch(err){ return null; }
    finally{ if(ctx.close) ctx.close(); }
  }
  /* ตัด mp3 (MPEG-1 Layer III) ทิ้งทุกเฟรมก่อน sec วินาที — คืน null ถ้าอ่านไฟล์ไม่ได้ */
  function mp3Cut(u, sec){
    var BR = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320], SR = [44100,48000,32000];
    var i = 0, t = 0, start = -1, frames = 0;
    if(u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) i = 10 + (((u[6]&127)<<21)|((u[7]&127)<<14)|((u[8]&127)<<7)|(u[9]&127)); /* ข้าม ID3 */
    while(i + 4 <= u.length){
      if(u[i] !== 0xFF || (u[i+1] & 0xE0) !== 0xE0){ i++; continue; }
      var ver = (u[i+1]>>3)&3, layer = (u[i+1]>>1)&3, bri = (u[i+2]>>4)&15, sri = (u[i+2]>>2)&3, pad = (u[i+2]>>1)&1;
      if(ver !== 3 || layer !== 1 || !bri || bri === 15 || sri === 3){ i++; continue; }
      var sr = SR[sri], len = Math.floor(144 * BR[bri] * 1000 / sr) + pad;
      if(i + len > u.length) break;
      var mono = ((u[i+3]>>6)&3) === 3, o = i + (mono ? 21 : 36), tag = String.fromCharCode(u[o], u[o+1], u[o+2], u[o+3]);
      if(!frames && (tag === "Xing" || tag === "Info")){ i += len; frames++; continue; } /* เฟรมหัวไฟล์ ไม่มีเสียง */
      if(start < 0 && t >= sec) start = i;
      t += 1152 / sr; i += len; frames++;
    }
    return start < 0 ? null : u.slice(start, i);
  }

  async function speak(script){
    /* บรรทัดว่างคั่นท่อนในจอ ElevenLabs (v3) อ่านเป็นเว้นเงียบ ~0.7-0.8 วิ ทุกครั้ง (วัดจากไฟล์จริง) → ส่งไปเป็นขึ้นบรรทัดเดียว ในจอยังเห็นบรรทัดว่างเหมือนเดิม */
    var body = script.replace(/[ \t]*\n(?:[ \t]*\n)+/g, "\n");
    var warm = warmFor(script), sent = warm ? warm + "\n\n" + body : body;
    if(sent.length > MAX_CHARS) throw new Error("บท" + (warm ? "รวมช่วงวอร์ม" : "") + "ยาว " + sent.length.toLocaleString() + " ตัวอักษร เกินเพดาน " + MAX_CHARS.toLocaleString() + " ต่อครั้งของ ElevenLabs ตัดให้สั้นลงก่อน");
    var full = null, al = null, tsTried = !cfg.tsOff; /* ขอเวลาตัวอักษรเสมอ (ถ้าโมเดลรองรับ): ใช้ตัดช่วงวอร์ม + ให้แท็บผู้กำกับตัดภาพตามเสียง */
    if(tsTried){
      try{ var j = await (await call(true, sent)).json(); full = b64Blob(j.audio_base64 || ""); al = j.alignment || j.normalized_alignment; }
      catch(err){ if(!err.soft) throw err; }
    }
    if(!full || !full.size){
      full = await (await call(false, sent)).blob();
      if(tsTried && !cfg.tsOff){ cfg.tsOff = true; saveCfg(); } /* แบบธรรมดาผ่าน แต่แบบมีเวลาไม่ผ่าน = โมเดลนี้ไม่รองรับ */
    }
    if(!full.size) throw new Error("ElevenLabs ส่งไฟล์เสียงว่างกลับมา ลองใหม่อีกครั้ง");
    if(cfg.usage.m !== monthKey()) cfg.usage = { m:monthKey(), chars:0, n:0 };
    cfg.usage.chars += sent.length; cfg.usage.n++; saveCfg(); renderUsage();

    var take = { raw:full, blob:full, cut:null, warm:!!warm };
    if(warm && cfg.trim && al){
      var c = cutTime(al, sent, body), on = c === null ? null : await onsetTime(full, c);
      if(on !== null) c = Math.max(c, on - ONSET_LEAD); /* ตัดชิดเสียงพูดจริง เหลือเงียบนำหน้าแค่นิดเดียว */
      var bytes = c === null ? null : mp3Cut(new Uint8Array(await full.arrayBuffer()), c);
      if(bytes && bytes.length){ take.blob = new Blob([bytes], { type:"audio/mpeg" }); take.cut = c; }
    }
    take.align = al ? bodyAlign(al, sent, body, !!warm, take.cut || 0) : null;
    return take;
  }
  /* เวลาตัวอักษรของ "บท" (ไม่รวมวอร์ม/ช่องว่าง) เทียบกับต้นไฟล์ที่เก็บ → เก็บใน MWVoice ให้แท็บผู้กำกับ */
  function bodyAlign(al, sent, body, warm, offset){
    if(!al || !Array.isArray(al.characters) || !Array.isArray(al.character_start_times_seconds)) return null;
    var ch = al.characters, st = al.character_start_times_seconds, en = al.character_end_times_seconds || st, joined = ch.join("");
    var at = !warm ? 0 : joined === sent ? sent.length - body.length : joined.indexOf(body.trim().slice(0, 12), Math.max(1, sent.length - body.length - 4));
    if(at < 0) return null;
    var c = [], s = [], e = [];
    for(var i = at; i < ch.length; i++){ if(/\s/.test(ch[i])) continue; c.push(ch[i]); s.push(+(st[i] - offset).toFixed(2)); e.push(+(en[i] - offset).toFixed(2)); }
    return c.length ? { chars:c.join(""), st:s, en:e } : null;
  }

  /* ---------- เทคที่สร้างแล้วในรอบนี้ (จับคู่กับข้อความบท) ---------- */
  var made = []; /* [{ text, takes:[{ raw, blob, cut, warm, url, rawUrl, name }], sel }] ล่าสุดอยู่ท้าย เก็บแค่ 5 บท */
  var busy = false;
  function scriptText(){ return $("vText").value.trim(); }
  function found(text){ return made.find(function(x){ return x.text === text; }); }
  function fileName(n){
    var c = MW.data.picked, t = c ? String(c.title).replace(/[^A-Za-z0-9ก-๙]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) : "";
    return "meowrin_" + (c ? c.id : Date.now()) + (t ? "_" + t : "") + (n > 1 ? "_take" + n : "") + ".mp3";
  }
  function canShareFile(f){ try{ return !!(navigator.canShare && navigator.canShare({ files:[f] })); }catch(e){ return false; } }
  function dropEntry(x){ x.takes.forEach(function(k){ URL.revokeObjectURL(k.url); if(k.rawUrl) URL.revokeObjectURL(k.rawUrl); }); }

  function note(text, err){ $("ttsMsg").innerHTML = text ? '<div class="msg'+(err?' err':'')+'">'+MW.esc(text)+'</div>' : ""; }
  function sync(){ /* เรียกทุกครั้งที่บทในจอเปลี่ยน */
    var text = scriptText(), n = text.length, a = found(text), label = n ? " · " + n.toLocaleString() + " ตัวอักษร" : "";
    $("ttsBtn").hidden = !!a; $("ttsBtn").disabled = busy || !n; $("ttsMore").hidden = !a; /* ปุ่มล่างจอ: ยังไม่มีเสียง = สร้างเสียง · มีแล้ว = อีกเทค */
    $("ttsBtn").innerHTML = busy ? "กำลังสร้างเสียง..." : MWIcon("speaker") + "สร้างเสียง" + label;
    $("ttsMore").disabled = busy; $("ttsMore").textContent = busy ? "กำลังสร้างเสียง..." : "+ สร้างอีกเทค" + label;
    $("ttsOut").hidden = !a;
    if(!a) return;
    $("ttsTakes").innerHTML = a.takes.length < 2 ? "" : a.takes.map(function(k, i){
      return '<button class="fchip'+(i === a.sel ? ' on' : '')+'" data-take="'+i+'">เทค '+(i + 1)+'</button>';
    }).join("");
    var k = a.takes[a.sel];
    if($("ttsAudio").dataset.url !== k.url){ $("ttsAudio").src = k.url; $("ttsAudio").dataset.url = k.url; }
    $("ttsDl").href = k.url; $("ttsDl").download = k.name;
    $("ttsRaw").hidden = !k.rawUrl; if(k.rawUrl){ $("ttsRaw").href = k.rawUrl; $("ttsRaw").download = k.name.replace(/\.mp3$/, "_full.mp3"); }
    $("ttsInfo").textContent = k.cut !== null ? "ตัดช่วงวอร์ม " + k.cut.toFixed(1) + " วิแรกออกให้แล้ว ถ้าตัดผิด ใช้ไฟล์เต็มด้านล่างแทน"
      : k.warm ? "ไฟล์นี้ยังมีช่วงวอร์มอยู่ข้างหน้า ตัดเองใน CapCut ตามเดิม" + (cfg.tsOff ? " (โมเดลนี้ไม่ส่งเวลาตัวอักษรมา เลยตัดให้ไม่ได้)" : "") : "";
    $("ttsSub").hidden = !k.vid; if(k.vid) $("ttsSub").href = "sub/?voice=" + k.vid;
    $("ttsDirect").hidden = !k.vid; if(k.vid) $("ttsDirect").href = "footage.html?voice=" + k.vid;
    $("ttsShare").hidden = !canShareFile(new File([k.blob], k.name, { type:"audio/mpeg" }));
  }
  document.addEventListener("mw:script", sync);
  $("ttsTakes").addEventListener("click", function(e){
    var b = e.target.closest("button[data-take]"), a = found(scriptText()); if(!b || !a) return;
    a.sel = +b.dataset.take; sync();
  });

  async function generate(){
    var text = scriptText(); if(busy || !text) return;
    busy = true; note(""); sync();
    try{
      var take = await speak(text), a = found(text);
      if(!a){ a = { text:text, takes:[], sel:0 }; made.push(a); while(made.length > 5) dropEntry(made.shift()); } /* คืนหน่วยความจำ */
      take.name = fileName(a.takes.length + 1);
      take.url = URL.createObjectURL(take.blob);
      take.rawUrl = take.blob !== take.raw ? URL.createObjectURL(take.raw) : "";
      a.takes.push(take); a.sel = a.takes.length - 1;
      if(window.MWVoice){ /* เก็บในเครื่อง 10 เทค + สำรองขึ้นคลัง R2 (ถ้าตั้งค่าไว้) ให้หน้าฟุตเทจใช้ต่อ */
        var vrec = { id:Date.now(), text:text, name:take.name, blob:take.blob, align:take.align }; take.vid = vrec.id; /* vid = รหัสในที่เก็บเสียง ใช้เปิดหน้าซับด้วยเทคนี้ */
        MWVoice.put(vrec).then(function(){ return MWVoice.cloudPut(vrec).catch(function(err){ MW.toast("สำรองเสียงขึ้นคลังไม่ได้: " + err.message); }); })
          .then(function(){ if(!$("vSavedSheet").hidden) renderSaved(); else countSaved(); }).catch(function(){});
      }
      MW.toast(a.takes.length > 1 ? "ได้เทค " + a.takes.length + " แล้ว" : "สร้างเสียงแล้ว");
      setTimeout(function(){ $("ttsOut").scrollIntoView({ behavior:"smooth", block:"center" }); }, 50); /* เลื่อนไปที่ตัวเล่นให้เห็นเลย */
    }catch(err){ note(err.message, true); }
    busy = false; sync();
  }
  /* ---------- เสียงที่เก็บไว้ (MWVoice: 50 เทคล่าสุดในเครื่อง + สำรองบนคลัง R2 ถ้าตั้งค่าไว้ · หน้าฟุตเทจใช้ต่อได้) ---------- */
  function setSavedN(n){ $("vSavedN").textContent = n; $("vSavedN").hidden = !n; } /* เลขบนปุ่มสามขีด */
  function countSaved(){ if(window.MWVoice) MWVoice.list().then(function(l){ setSavedN(l.length); }).catch(function(){}); }
  var savedUrls = {}, rsTok = 0, dateOf = function(id){ return new Date(id).toLocaleString("th-TH", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }); };
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ip" d="M8 5v14l11-7z"/><path class="ipa" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  var pAudio = null, pId = 0; /* ตัวเล่นเดียวใช้ร่วมทุกการ์ด (เล่นได้ทีละเทค) · ปิดชีต = หยุดทันที */
  function mmss(t){ t = Math.max(0, Math.round(t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
  (function(){ /* ตัวเล่นของเทคที่เพิ่งเจน: หน้าตาเดียวกับการ์ดเสียงที่เก็บไว้ ไม่ใช้ตัวเล่นของเบราว์เซอร์ */
    var au = $("ttsAudio"), btn = $("ttsPlay"), bar = $("ttsBar"), tm = $("ttsTime"), dur = function(){ return isFinite(au.duration) ? au.duration : 0; };
    btn.innerHTML = PLAY;
    function paint(){ btn.classList.toggle("on", !au.paused); bar.firstChild.style.width = dur() ? (au.currentTime / dur() * 100) + "%" : "0"; tm.textContent = mmss(au.currentTime) + " / " + mmss(dur()); }
    ["timeupdate", "play", "pause", "ended", "loadedmetadata", "durationchange", "emptied"].forEach(function(ev){ au.addEventListener(ev, paint); });
    btn.addEventListener("click", function(){ if(au.paused) au.play().catch(function(err){ MW.toast("เล่นไม่ได้: " + err.message, true); }); else au.pause(); });
    function seek(e){ var r = bar.getBoundingClientRect(); if(dur()) au.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur(); }
    bar.addEventListener("pointerdown", function(e){ bar.setPointerCapture(e.pointerId); seek(e); });
    bar.addEventListener("pointermove", function(e){ if(bar.hasPointerCapture(e.pointerId)) seek(e); });
    paint();
  })();
  function card(id){ return $("vSavedList").querySelector('.vcard[data-id="' + id + '"]'); }
  function paintPlay(){
    $("vSavedList").querySelectorAll(".vplay").forEach(function(x){ x.classList.toggle("on", !!pAudio && !pAudio.paused && +x.dataset.vplay === pId); });
  }
  function stopSaved(){ if(!pAudio) return; pAudio.pause(); pAudio.removeAttribute("src"); pAudio.load(); pId = 0; paintPlay(); $("vSavedList").querySelectorAll(".vbar i").forEach(function(i){ i.style.width = "0"; }); }
  function playSaved(id){
    if(!pAudio){
      pAudio = new Audio();
      pAudio.addEventListener("timeupdate", function(){
        var c = card(pId); if(!c || !pAudio.duration) return;
        c.querySelector(".vbar i").style.width = (pAudio.currentTime / pAudio.duration * 100) + "%";
        c.querySelector(".vtime").textContent = mmss(pAudio.currentTime) + " / " + mmss(pAudio.duration);
      });
      pAudio.addEventListener("pause", paintPlay); pAudio.addEventListener("play", paintPlay);
      pAudio.addEventListener("ended", function(){ paintPlay(); var c = card(pId); if(c) c.querySelector(".vbar i").style.width = "0"; });
    }
    if(pId === id && !pAudio.paused){ pAudio.pause(); return; }
    if(pId !== id){ stopSaved(); pId = id; pAudio.src = savedUrls[id]; }
    pAudio.play().catch(function(err){ MW.toast("เล่นไม่ได้: " + err.message, true); });
  }
  function durOf(url){ /* ความยาวเสียงจากเมตาดาต้าอย่างเดียว (ไม่ต้องโหลดทั้งไฟล์) · อ่านไม่ได้ใน 4 วิ = 0 */
    return new Promise(function(ok){
      var a = new Audio(), t = setTimeout(function(){ done(0); }, 4000);
      function done(d){ clearTimeout(t); a.onloadedmetadata = a.ontimeupdate = a.onerror = null; a.removeAttribute("src"); ok(isFinite(d) && d > 0 ? d : 0); }
      a.preload = "metadata"; a.onerror = function(){ done(0); };
      a.onloadedmetadata = function(){ if(isFinite(a.duration)) done(a.duration); else { a.ontimeupdate = function(){ done(a.duration); }; a.currentTime = 1e9; } }; /* mp3 บางไฟล์ไม่บอกความยาวจนกรอสุด */
      a.src = url;
    });
  }
  function fillDurations(list, tok){ /* ทีละเทค หลังวาดรายการเสร็จ (ไม่ขวางการเปิดชีต) */
    list.reduce(function(p, r){
      return p.then(function(){
        if(tok !== rsTok) return;
        return durOf(savedUrls[r.id]).then(function(d){ var c = tok === rsTok && d && card(r.id); if(c && !(pAudio && pId === r.id)) c.querySelector(".vtime").textContent = "0:00 / " + mmss(d); });
      });
    }, Promise.resolve());
  }
  var openCard = ""; /* การ์ดที่กางปุ่มอยู่ (ทีละใบ) (ทำซับ/ตัดต่อ/ดาวน์โหลด/ลบ ซ่อนไว้จนกว่าจะแตะ) */
  function localCard(r, on){
    var st = r.cloud ? MWIcon("cloud") + "อยู่ในคลัง" : on ? "ยังไม่อยู่ในคลัง" : "เฉพาะเครื่องนี้";
    return '<div class="vcard' + (String(r.id) === openCard ? " open" : "") + '" data-id="' + r.id + '"><div class="vtop"><button class="vplay" data-vplay="' + r.id + '" aria-label="เล่น/หยุด">' + PLAY + '</button>'
      + '<div class="vmeta"><b>' + MW.esc(dateOf(r.id)) + '</b><small>' + (r.blob.size / 1048576).toFixed(1) + ' MB · ' + (r.text || "").length.toLocaleString() + ' ตัวอักษร · ' + st + '</small></div><button class="vmore" data-vmore="' + r.id + '" aria-label="เมนูเทคนี้">' + MWIcon("more") + '</button></div>'
      + '<p class="vstxt">' + MW.esc((r.text || "").replace(/\s+/g, " ").slice(0, 140)) + '</p>'
      + '<div class="vprog"><div class="vbar" data-vbar="' + r.id + '"><i></i></div><span class="vtime">0:00</span></div>'
      + '<div class="vact"><a class="btn small" href="sub/?voice=' + r.id + '">ทำซับ</a><a class="btn small ghost" href="footage.html?voice=' + r.id + '">' + MWIcon("film") + 'ตัดต่อภาพ</a>'
      + '<a class="btn ghost small" href="' + savedUrls[r.id] + '" download="' + MW.esc(r.name || "meowrin.mp3") + '">ดาวน์โหลด</a>'
      + (on && !r.cloud ? '<button class="btn ghost small" data-vup="' + r.id + '">' + MWIcon("cloud") + 'อัปขึ้นคลัง</button>' : "")
      + '<button class="btn ghost small" data-vdel="' + r.id + '">ลบ</button></div></div>';
  }
  function cloudCard(c){
    return '<div class="vcard"><div class="vtop"><div class="vmeta"><b>' + MW.esc(dateOf(c.id)) + '</b><small>' + (c.size / 1048576).toFixed(1) + ' MB · ' + MWIcon("cloud") + 'อยู่ในคลัง</small></div></div>'
      + '<div class="vact"><button class="btn small" data-vpull="' + c.id + '">' + MWIcon("down") + 'ดึงมาเครื่องนี้</button><button class="btn ghost small" data-vdelc="' + c.id + '">ลบจากคลัง</button></div></div>';
  }
  async function renderSaved(){ /* วาดเสียงในเครื่องก่อน (resolve เมื่อเสร็จ) · เสียงที่อยู่แค่ในคลังเติมทีหลังเฉพาะส่วนของมัน ไม่วาดการ์ดในเครื่องซ้ำ (กันกะพริบ/เสียงสะดุด) */
    if(!window.MWVoice) return;
    var tok = ++rsTok, box = $("vSavedList"), list = [], on = MWVoice.cloudOn();
    try{ list = await MWVoice.list(); }catch(err){ box.innerHTML = '<p class="empty">เปิดที่เก็บเสียงไม่ได้</p>'; return; }
    stopSaved(); Object.keys(savedUrls).forEach(function(k){ URL.revokeObjectURL(savedUrls[k]); }); savedUrls = {};
    list.forEach(function(r){ savedUrls[r.id] = URL.createObjectURL(r.blob); });
    var empty = '<p class="empty">ยังไม่มีเสียงที่เก็บไว้ · สร้างเสียงแล้วจะเก็บให้อัตโนมัติ (50 เทคล่าสุด' + (on ? " + สำรองบนคลัง" : "") + ')</p>';
    box.innerHTML = '<div id="vSavedLocal">' + (list.map(function(r){ return localCard(r, on); }).join("") || (on ? '<p class="empty">กำลังโหลด...</p>' : empty)) + '</div><div id="vSavedCloud"></div>';
    setSavedN(list.length);
    fillDurations(list, tok);
    if(!on) return;
    try{
      var cloud = await MWVoice.cloudList();
      if(tok !== rsTok) return; /* มีการวาดรอบใหม่แล้ว ผลเก่าทิ้ง */
      var only = cloud.filter(function(c){ return !list.some(function(r){ return r.id === c.id; }); });
      setSavedN(list.length + only.length);
      if(!list.length) $("vSavedLocal").innerHTML = only.length ? "" : empty;
      $("vSavedCloud").innerHTML = only.length ? '<p class="hint" style="margin:12px 0 4px">' + MWIcon("cloud") + 'อยู่ในคลังแต่ยังไม่ได้ดึงมาเครื่องนี้</p>' + only.map(cloudCard).join("") : "";
    }catch(err){ if(tok === rsTok && !list.length) $("vSavedLocal").innerHTML = empty; /* คลังไม่ตอบ = แสดงเฉพาะในเครื่อง */ }
  }
  function closeSaved(){ stopSaved(); MW.closeModal("vSavedSheet"); }
  $("vSavedBtn").addEventListener("click", async function(){ await renderSaved(); MW.openModal("vSavedSheet"); }); /* เปิดชีตหลังข้อมูลในเครื่องพร้อมแล้ว ไม่โชว์ของว่าง/ของเก่าแว้บ */
  $("vSavedClose").addEventListener("click", closeSaved);
  $("vSavedSheet").addEventListener("click", function(e){ if(e.target === this) closeSaved(); });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape" && !$("vSavedSheet").hidden) closeSaved(); });
  document.addEventListener("mw:tab", function(e){ $("vSavedBtn").hidden = e.detail !== "voice"; }); /* ปุ่มโชว์เฉพาะแท็บเสียง (แบบเดียวกับปุ่มประวัติในแท็บบท) */
  countSaved();
  $("vSavedList").addEventListener("click", async function(e){
    var bar = e.target.closest(".vbar");
    if(bar){ if(pAudio && pId === +bar.dataset.vbar && pAudio.duration){ var r0 = bar.getBoundingClientRect(); pAudio.currentTime = Math.min(1, Math.max(0, (e.clientX - r0.left) / r0.width)) * pAudio.duration; } return; } /* แตะแถบเวลา = กรอ */
    var mt = e.target.closest(".vmeta, [data-vmore]"), mc = mt && mt.closest(".vcard[data-id]");
    if(mc){ openCard = openCard === mc.dataset.id ? "" : mc.dataset.id; /* แตะที่เดิมซ้ำ = ปิด · แตะอันอื่น = ปิดอันเก่าแล้วเปิดอันใหม่ */
      $("vSavedList").querySelectorAll(".vcard[data-id]").forEach(function(c){ c.classList.toggle("open", c.dataset.id === openCard); }); return; }
    var b = e.target.closest("button"); if(!b) return; var d = b.dataset;
    if(d.vplay){ playSaved(+d.vplay); return; }
    if(d.vdel || d.vdelc){ /* ลบ: แตะครั้งแรกปุ่มเปลี่ยนเป็น "แน่ใจนะ?" แตะซ้ำภายใน 3 วิถึงลบ (ไม่ใช้กล่องของเบราว์เซอร์) */
      MW.confirmTap(b, b.textContent, async function(){
        try{
          if(d.vdel){ var rec = await MWVoice.get(+d.vdel), withCloud = rec && rec.cloud; await MWVoice.del(+d.vdel); if(withCloud) await MWVoice.cloudDel(+d.vdel); }
          else await MWVoice.cloudDel(+d.vdelc);
          MW.toast("ลบแล้ว");
        }catch(err){ MW.toast("ทำไม่ได้: " + err.message); }
        renderSaved();
      });
      return;
    }
    try{
      if(d.vup){ b.disabled = true; b.textContent = "กำลังอัป..."; var r = await MWVoice.get(+d.vup); await MWVoice.cloudPut(r); }
      else if(d.vpull){ b.disabled = true; b.textContent = "กำลังดึง..."; await MWVoice.pull(+d.vpull); }
      else return;
    }catch(err){ MW.toast("ทำไม่ได้: " + err.message); }
    renderSaved();
  });

  $("ttsBtn").addEventListener("click", generate);
  $("ttsMore").addEventListener("click", generate); /* อีกเทค = เสียเครดิตอีกรอบ */

  $("ttsShare").addEventListener("click", async function(){
    var a = found(scriptText()); if(!a) return;
    var k = a.takes[a.sel];
    try{ await navigator.share({ files:[new File([k.blob], k.name, { type:"audio/mpeg" })], title:k.name }); }
    catch(err){ if(err && err.name !== "AbortError") note("แชร์ไม่ได้ ใช้ปุ่มดาวน์โหลดแทน (" + err.message + ")", true); }
  });

  /* ---------- ตั้งค่าเสียง (ชีตในแท็บเสียง: เสียง/โมเดล/Stability/วอร์ม) ---------- */
  var MODELS = [{ v:"eleven_v3", t:"Eleven v3" }, { v:"eleven_multilingual_v2", t:"Multilingual v2" }];
  var STABS = [{ v:0, t:"Creative" }, { v:0.5, t:"Natural" }, { v:1, t:"Robust" }];
  var WARMS = [{ v:"hook", t:"ซ้ำ hook" }, { v:"custom", t:"ประโยคของฉัน" }, { v:"off", t:"ไม่ใส่" }];
  function seg(el, items, cur, attr){
    el.innerHTML = items.map(function(x){ return '<button type="button" class="'+(x.v === cur ? 'on' : '')+'" data-'+attr+'="'+x.v+'">'+MW.esc(x.t)+'</button>'; }).join("");
  }
  function renderSheet(){
    $("vsVoices").innerHTML = cfg.voices.length ? cfg.voices.map(function(v){
      return '<button class="opt'+(v.vid === cfg.voice ? ' on' : '')+'" data-voice="'+MW.esc(v.vid)+'"><span class="on-t"><b>'+MW.esc(v.name || "ไม่มีชื่อ")+'</b><small class="id">'+MW.esc(v.vid.slice(0, 10))+'…</small></span></button>';
    }).join("") : '<div class="hint" style="margin:0">ยังไม่มีเสียง ไปเพิ่มชื่อกับ Voice ID ที่ ตั้งค่า → เสียงพากย์ ก่อน</div><button class="btn ghost" id="vsToSettings" style="margin-top:8px">ไปหน้าตั้งค่า</button>';
    seg($("vsModel"), MODELS, cfg.model, "model"); seg($("vsStab"), STABS, cfg.stability, "stab"); seg($("vsWarm"), WARMS, cfg.warm, "warm");
    $("vsWarmText").hidden = cfg.warm !== "custom"; $("vsWarmText").value = cfg.warmText;
    $("vsTrimRow").hidden = cfg.warm === "off"; $("vsTrim").checked = cfg.trim; $("vsTsNote").hidden = !cfg.tsOff;
  }
  function renderVoiceRow(){
    var v = curVoice(), m = MODELS.find(function(x){ return x.v === cfg.model; }), s = STABS.find(function(x){ return x.v === cfg.stability; });
    $("vVoiceName").textContent = v ? (v.name || "ไม่มีชื่อ") : "ยังไม่ได้เลือกเสียง";
    $("vVoiceInfo").textContent = (v ? "" : "แตะเพื่อตั้งค่า · ") + (m ? m.t : cfg.model) + " · " + (s ? s.t : cfg.stability) + (cfg.warm === "off" ? "" : " · วอร์ม" + (cfg.trim ? "+ตัดให้" : ""));
  }
  function changed(){ saveCfg(); renderSheet(); renderVoiceRow(); }
  function openSheet(){ renderSheet(); MW.openModal("vSheet"); }
  $("vSetBtn").addEventListener("click", openSheet);
  $("vsClose").addEventListener("click", function(){ MW.closeModal("vSheet"); });
  $("vSheet").addEventListener("click", function(e){ if(e.target === this) MW.closeModal("vSheet"); });
  $("vSheet").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    if(b.id === "vsToSettings"){ MW.closeModal("vSheet"); MW.showTab("settings"); return; }
    if(b.dataset.voice){ cfg.voice = b.dataset.voice; changed(); return; }
    if(b.dataset.model){ cfg.model = b.dataset.model; cfg.tsOff = false; changed(); return; } /* เปลี่ยนโมเดล → ลองแบบมีเวลาตัวอักษรอีกครั้ง */
    if(b.dataset.stab){ cfg.stability = Number(b.dataset.stab); changed(); return; }
    if(b.dataset.warm){ cfg.warm = b.dataset.warm; changed(); }
  });
  $("vsWarmText").addEventListener("change", function(){ cfg.warmText = this.value; saveCfg(); });
  $("vsTrim").addEventListener("change", function(){ cfg.trim = this.checked; cfg.tsOff = false; changed(); });

  /* ---------- สำรอง/นำเข้า (ให้ app.js เรียก) ไม่รวม key และยอดใช้งาน ---------- */
  function ttsBackup(){ return { voices:cfg.voices, voice:cfg.voice, model:cfg.model, stability:cfg.stability, warm:cfg.warm, warmText:cfg.warmText, trim:cfg.trim }; }
  MW.ttsCfg = {
    get: ttsBackup,
    differs: function(o){ return cfg.voices.length > 0 && JSON.stringify(cfg.voices) !== JSON.stringify(o && o.voices); },
    set: function(o){
      if(!o || typeof o !== "object") return;
      if(Array.isArray(o.voices)){
        var seen = {}, vs = o.voices.filter(function(v){ return v && typeof v.vid === "string" && v.vid && !seen[v.vid] && (seen[v.vid] = 1); })
          .map(function(v){ return { id:typeof v.id === "string" && v.id ? v.id : newId(), name:String(v.name || ""), vid:v.vid }; });
        if(vs.length) cfg.voices = vs;
      }
      if(typeof o.voice === "string" && cfg.voices.some(function(v){ return v.vid === o.voice; })) cfg.voice = o.voice;
      if(!curVoice()) cfg.voice = cfg.voices.length ? cfg.voices[0].vid : "";
      if(MODELS.some(function(m){ return m.v === o.model; })) cfg.model = o.model;
      if(STABS.some(function(s){ return s.v === o.stability; })) cfg.stability = o.stability;
      if(WARMS.some(function(w){ return w.v === o.warm; })) cfg.warm = o.warm;
      if(typeof o.warmText === "string") cfg.warmText = o.warmText;
      if(typeof o.trim === "boolean") cfg.trim = o.trim;
      cfg.tsOff = false; saveCfg(); renderVoiceList(); renderVoiceRow(); sync();
    }
  };

  /* ---------- ตั้งค่า (แท็บตั้งค่า: key + รายการเสียงของฉัน) ---------- */
  function keyState(){ var on = !!load(KEY, ""); $("elState").innerHTML = on ? MWIcon("check") + "ตั้งแล้ว" : "ยังไม่ได้ตั้ง"; $("elState").classList.toggle("ok", on); }
  function renderUsage(){
    var u = cfg.usage.m === monthKey() ? cfg.usage : { chars:0, n:0 };
    $("ttsUsage").textContent = u.n ? "เดือนนี้ส่งไปสร้างเสียงแล้ว " + u.chars.toLocaleString() + " ตัวอักษร (" + u.n + " ครั้ง จากแอพนี้) ยอดเครดิตจริงดูในเว็บ ElevenLabs" : "เดือนนี้ยังไม่ได้สร้างเสียงจากแอพนี้";
  }
  function renderVoiceList(focusId){
    $("voiceList").innerHTML = cfg.voices.map(function(v){
      var id = MW.esc(v.id);
      return '<div class="vrow"><input data-vname="'+id+'" value="'+MW.esc(v.name)+'" placeholder="ชื่อเสียง เช่น Test7" autocomplete="off" aria-label="ชื่อเสียง">'
        + '<input id="vid_'+id+'" data-vid="'+id+'" value="'+MW.esc(v.vid)+'" placeholder="Voice ID" autocomplete="off" autocapitalize="none" aria-label="Voice ID">'
        + '<button type="button" class="btn small ghost" data-paste="vid_'+id+'" data-trim>วาง</button>'
        + '<button type="button" class="rowmore" data-rowmore aria-label="เมนูเสียงนี้">'+MWIcon("more")+'</button>'
        + '<button type="button" class="btn small ghost vdel" data-vdel="'+id+'">ลบเสียงนี้</button></div>';
    }).join("") || '<p class="hint" style="margin:0">ยังไม่มีเสียง กด "+ เพิ่มเสียง"</p>';
    if(focusId){ var el = document.querySelector('[data-vname="'+focusId+'"]'); if(el){ el.focus(); el.select(); } }
  }
  $("voiceList").addEventListener("change", function(e){
    var t = e.target, v;
    if(t.dataset.vname && (v = cfg.voices.find(function(x){ return x.id === t.dataset.vname; }))) v.name = t.value.trim();
    else if(t.dataset.vid && (v = cfg.voices.find(function(x){ return x.id === t.dataset.vid; }))){
      var was = v.vid; v.vid = t.value.trim(); if(cfg.voice === was) cfg.voice = v.vid; /* แก้ Voice ID ของเสียงที่ใช้อยู่ → ตามไปด้วย */
    }else return;
    if(!cfg.voice && cfg.voices.length) cfg.voice = cfg.voices[0].vid;
    var ok = saveCfg(); MW.toast(ok ? "บันทึกแล้ว" : "บันทึกไม่ได้", !ok); renderVoiceRow();
  });
  $("voiceList").addEventListener("click", function(e){
    var mo = e.target.closest("[data-rowmore]"); if(mo){ mo.closest(".vrow").classList.toggle("open"); return; } /* ปุ่มลบซ่อนไว้ แตะสามจุดถึงโผล่ */
    var b = e.target.closest("button[data-vdel]"); if(!b) return;
    MW.confirmTap(b, "ลบเสียงนี้", function(){
      cfg.voices = cfg.voices.filter(function(v){ return v.id !== b.dataset.vdel; });
      if(!curVoice()) cfg.voice = cfg.voices.length ? cfg.voices[0].vid : "";
      saveCfg(); renderVoiceList(); renderVoiceRow(); MW.toast("ลบเสียงแล้ว");
    });
  });
  $("addVoice").addEventListener("click", function(){
    var v = { id:newId(), name:"", vid:"" }; cfg.voices.push(v); renderVoiceList(v.id);
  });
  $("elKey").value = load(KEY, "");
  $("elKey").addEventListener("change", function(){ var ok = save(KEY, this.value.trim()); MW.toast(ok ? "บันทึกแล้ว" : "บันทึกไม่ได้", !ok); keyState(); }); /* บันทึกอัตโนมัติ (รวมตอนกด วาง/ลบ) */

  if(!MODELS.some(function(m){ return m.v === cfg.model; })) cfg.model = "eleven_v3";
  if(!STABS.some(function(s){ return s.v === cfg.stability; })) cfg.stability = 0.5;
  if(!WARMS.some(function(w){ return w.v === cfg.warm; })) cfg.warm = "hook";
  saveCfg(); keyState(); renderUsage(); renderVoiceList(); renderVoiceRow(); sync();
})();
