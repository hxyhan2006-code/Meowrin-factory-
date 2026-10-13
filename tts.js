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
  function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
  function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  function monthKey(){ var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

  /* ค่าเริ่มต้นตรงกับที่ Han ใช้บนเว็บ: Eleven v3 · Stability Natural (0.5) · ภาษาอัตโนมัติ · MP3 44.1kHz 128kbps
     warm = "hook" | "custom" | "off" · trim = ตัดช่วงวอร์มออกให้ · tsOff = เคยลองแล้วโมเดลนี้ไม่ส่งเวลาตัวอักษรมา */
  var cfg = Object.assign({ voice:"", voiceName:"", model:"eleven_v3", stability:0.5, fmt:"mp3_44100_128",
                            warm:"hook", warmText:"", trim:true, tsOff:false, usage:{ m:"", chars:0, n:0 } }, load(CFG, {}));
  function saveCfg(){ return save(CFG, cfg); }

  /* ---------- เรียก ElevenLabs ---------- */
  async function call(withTs, text){
    var key = load(KEY, "");
    if(!key) throw new Error("ยังไม่ได้ใส่ ElevenLabs API key (แท็บตั้งค่า)");
    if(!cfg.voice) throw new Error("ยังไม่ได้ใส่ Voice ID (แท็บตั้งค่า)");
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
    var warm = warmFor(script), sent = warm ? warm + "\n\n" + script : script;
    if(sent.length > MAX_CHARS) throw new Error("บท" + (warm ? "รวมช่วงวอร์ม" : "") + "ยาว " + sent.length.toLocaleString() + " ตัวอักษร เกินเพดาน " + MAX_CHARS.toLocaleString() + " ต่อครั้งของ ElevenLabs ตัดให้สั้นลงก่อน");
    var full = null, al = null, tsTried = !!warm && cfg.trim && !cfg.tsOff;
    if(tsTried){
      try{ var j = await (await call(true, sent)).json(); full = b64Blob(j.audio_base64 || ""); al = j.alignment || j.normalized_alignment; }
      catch(err){ if(!err.soft) throw err; }
    }
    if(!full || !full.size){
      full = await (await call(false, sent)).blob();
      if(tsTried && !cfg.tsOff){ cfg.tsOff = true; renderTsNote(); } /* แบบธรรมดาผ่าน แต่แบบมีเวลาไม่ผ่าน = โมเดลนี้ไม่รองรับ */
    }
    if(!full.size) throw new Error("ElevenLabs ส่งไฟล์เสียงว่างกลับมา ลองใหม่อีกครั้ง");
    if(cfg.usage.m !== monthKey()) cfg.usage = { m:monthKey(), chars:0, n:0 };
    cfg.usage.chars += sent.length; cfg.usage.n++; saveCfg(); renderUsage();

    var take = { raw:full, blob:full, cut:null, warm:!!warm };
    if(warm && cfg.trim && al){
      var c = cutTime(al, sent, script), bytes = c === null ? null : mp3Cut(new Uint8Array(await full.arrayBuffer()), c);
      if(bytes && bytes.length){ take.blob = new Blob([bytes], { type:"audio/mpeg" }); take.cut = c; }
    }
    return take;
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
    $("ttsBtn").textContent = busy ? "กำลังสร้างเสียง..." : "🔊 สร้างเสียง" + label;
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
      MW.toast(a.takes.length > 1 ? "ได้เทค " + a.takes.length + " แล้ว" : "สร้างเสียงแล้ว");
      setTimeout(function(){ $("ttsOut").scrollIntoView({ behavior:"smooth", block:"center" }); }, 50); /* เลื่อนไปที่ตัวเล่นให้เห็นเลย */
    }catch(err){ note(err.message, true); }
    busy = false; sync();
  }
  $("ttsBtn").addEventListener("click", generate);
  $("ttsMore").addEventListener("click", generate); /* อีกเทค = เสียเครดิตอีกรอบ */

  $("ttsShare").addEventListener("click", async function(){
    var a = found(scriptText()); if(!a) return;
    var k = a.takes[a.sel];
    try{ await navigator.share({ files:[new File([k.blob], k.name, { type:"audio/mpeg" })], title:k.name }); }
    catch(err){ if(err && err.name !== "AbortError") note("แชร์ไม่ได้ ใช้ปุ่มดาวน์โหลดแทน (" + err.message + ")", true); }
  });

  /* ---------- ตั้งค่า ---------- */
  function keyState(){ var on = !!load(KEY, ""); $("elState").textContent = on ? "✓ ตั้งแล้ว" : "ยังไม่ได้ตั้ง"; $("elState").classList.toggle("ok", on); }
  function renderUsage(){
    var u = cfg.usage.m === monthKey() ? cfg.usage : { chars:0, n:0 };
    $("ttsUsage").textContent = u.n ? "เดือนนี้ส่งไปสร้างเสียงแล้ว " + u.chars.toLocaleString() + " ตัวอักษร (" + u.n + " ครั้ง จากแอพนี้) ยอดเครดิตจริงดูในเว็บ ElevenLabs" : "เดือนนี้ยังไม่ได้สร้างเสียงจากแอพนี้";
  }
  function renderTsNote(){ $("elTsNote").hidden = !cfg.tsOff; }
  var MODEL_TH = { eleven_v3:"Eleven v3", eleven_multilingual_v2:"Multilingual v2" }, STAB_TH = { "0":"Creative", "0.5":"Natural", "1":"Robust" };
  function renderVoiceInfo(){
    $("vVoiceInfo").textContent = "🎙 " + (cfg.voiceName || (cfg.voice ? "Voice " + cfg.voice.slice(0, 6) + "…" : "ยังไม่ได้ตั้ง Voice ID")) + " · " + (MODEL_TH[cfg.model] || cfg.model)
      + " · " + (STAB_TH[String(cfg.stability)] || cfg.stability) + (cfg.warm === "off" ? "" : " · วอร์ม" + (cfg.trim ? "+ตัดให้" : ""));
  }
  $("vSetBtn").addEventListener("click", function(){ MW.showTab("settings"); $("elPanel").scrollIntoView({ behavior:"smooth", block:"start" }); });
  function renderWarm(){ $("elWarmBox").hidden = cfg.warm !== "custom"; $("elTrimRow").hidden = cfg.warm === "off"; }
  $("elKey").value = load(KEY, ""); $("elVoice").value = cfg.voice; $("elVoiceName").value = cfg.voiceName;
  $("elModel").value = cfg.model; if($("elModel").value !== cfg.model){ cfg.model = "eleven_v3"; $("elModel").value = cfg.model; }
  $("elStab").value = String(cfg.stability); if($("elStab").value !== String(cfg.stability)){ cfg.stability = 0.5; $("elStab").value = "0.5"; }
  $("elWarm").value = cfg.warm; if($("elWarm").value !== cfg.warm){ cfg.warm = "hook"; $("elWarm").value = "hook"; }
  $("elWarmText").value = cfg.warmText; $("elTrim").checked = cfg.trim;
  function saveAll(e){
    var ok = save(KEY, $("elKey").value.trim());
    if(e && (e.target.id === "elModel" || e.target.id === "elTrim")) cfg.tsOff = false; /* เปลี่ยนโมเดล/เปิดตัดใหม่ → ลองแบบมีเวลาตัวอักษรอีกครั้ง */
    cfg.voice = $("elVoice").value.trim(); cfg.voiceName = $("elVoiceName").value.trim(); cfg.model = $("elModel").value; cfg.stability = Number($("elStab").value);
    cfg.warm = $("elWarm").value; cfg.warmText = $("elWarmText").value; cfg.trim = $("elTrim").checked;
    ok = saveCfg() && ok;
    MW.toast(ok ? "บันทึกแล้ว" : "บันทึกไม่ได้", !ok); keyState(); renderWarm(); renderTsNote(); renderVoiceInfo();
  }
  ["elKey","elVoice","elVoiceName","elModel","elStab","elWarm","elWarmText","elTrim"].forEach(function(id){ $(id).addEventListener("change", saveAll); }); /* บันทึกอัตโนมัติ (รวมตอนกด วาง/ลบ) */

  keyState(); renderUsage(); renderWarm(); renderTsNote(); renderVoiceInfo(); sync();
})();
