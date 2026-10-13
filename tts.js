/* tts.js — สร้างเสียงพากย์จากบท (PART 2) ด้วย ElevenLabs แล้วฟัง / แชร์ไป CapCut / ดาวน์โหลด mp3
   โหลดหลัง ai.js (ใช้ MW.parts, MW.toast และ event "mw:script" ที่ ai.js ส่งเมื่อบทในจอเปลี่ยน)
   ไฟล์เสียงไม่เก็บถาวร (ใหญ่เกินที่เก็บของเบราว์เซอร์) เก็บในหน่วยความจำระหว่างเปิดแอพเท่านั้น */
(function(){
  "use strict";
  var MW = window.MW; if(!MW || !MW.parts) return;
  var $ = function(id){ return document.getElementById(id); };
  var KEY = "mw_eleven_key_v1", CFG = "mw_tts_cfg_v1";
  var API = "https://api.elevenlabs.io/v1/text-to-speech/";
  var MAX_CHARS = 5000; /* เพดานต่อคำขอของ ElevenLabs */
  function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
  function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  function monthKey(){ var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

  /* ค่าเริ่มต้นตรงกับที่ Han ใช้บนเว็บ: Eleven v3 · Stability Natural (0.5) · ภาษาอัตโนมัติ · MP3 44.1kHz 128kbps */
  var cfg = Object.assign({ voice:"", model:"eleven_v3", stability:0.5, fmt:"mp3_44100_128", usage:{ m:"", chars:0, n:0 } }, load(CFG, {}));
  function saveCfg(){ return save(CFG, cfg); }

  /* ---------- เรียก ElevenLabs ---------- */
  async function speak(text){
    var key = load(KEY, "");
    if(!key) throw new Error("ยังไม่ได้ใส่ ElevenLabs API key (แท็บตั้งค่า)");
    if(!cfg.voice) throw new Error("ยังไม่ได้ใส่ Voice ID (แท็บตั้งค่า)");
    var res;
    try{
      res = await fetch(API + encodeURIComponent(cfg.voice) + "?output_format=" + cfg.fmt, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
        body: JSON.stringify({ text: text, model_id: cfg.model, voice_settings: { stability: cfg.stability } })
      });
    }catch(err){ /* ไม่มี status เลย = เบราว์เซอร์ไม่ยอมส่ง (CORS) หรือเน็ตหลุด */
      throw new Error("ต่อ ElevenLabs ไม่ได้ เน็ตหลุด หรือเบราว์เซอร์บล็อกการเรียกตรง (CORS) ถ้าเน็ตปกติแต่ยังขึ้นแบบนี้ ส่งข้อความนี้ให้ Claude ดู [" + (err && err.message || "network") + "]");
    }
    if(!res.ok){
      var j = await res.json().catch(function(){ return {}; });
      var d = j.detail, st = (d && d.status) || (d && d.code) || "", m = (d && d.message) || (typeof d === "string" ? d : "");
      var raw = " [รหัส: " + res.status + (st ? " " + st : "") + "]";
      if(st === "missing_permissions" || /permission/i.test(m)) throw new Error("key นี้ไม่มีสิทธิ์ Text to Speech เปิดสิทธิ์ให้ key ใน ElevenLabs แล้วลองใหม่" + raw);
      if(st === "invalid_api_key" || res.status === 401 && !st) throw new Error("ElevenLabs API key ไม่ถูกต้อง เช็ก key ในตั้งค่า" + raw);
      if(st === "quota_exceeded" || /quota|credit/i.test(m)) throw new Error("เครดิต ElevenLabs ไม่พอสำหรับบทนี้" + raw);
      if(st === "voice_not_found" || /voice.*not found/i.test(m)) throw new Error("ไม่เจอ Voice ID นี้ในบัญชี เช็ก Voice ID ในตั้งค่า" + raw);
      if(res.status === 429) throw new Error("ElevenLabs คิวเต็ม/ส่งถี่เกินไป รอสักครู่แล้วลองใหม่" + raw);
      throw new Error("ElevenLabs error" + (m ? ": " + m : "") + raw);
    }
    var blob = await res.blob();
    if(!blob.size) throw new Error("ElevenLabs ส่งไฟล์เสียงว่างกลับมา ลองใหม่อีกครั้ง");
    if(cfg.usage.m !== monthKey()) cfg.usage = { m:monthKey(), chars:0, n:0 };
    cfg.usage.chars += text.length; cfg.usage.n++; saveCfg(); renderUsage();
    return blob;
  }

  /* ---------- เสียงที่สร้างแล้วในรอบนี้ (จับคู่กับข้อความบท) ---------- */
  var made = []; /* [{ text, blob, url, name }] ล่าสุดอยู่ท้าย เก็บแค่ 5 อัน */
  var busy = false;
  function scriptText(){ return MW.parts($("s2Out").value).script; }
  function found(text){ return made.find(function(x){ return x.text === text; }); }
  function fileName(){
    var c = MW.data.picked, t = c ? String(c.title).replace(/[^A-Za-z0-9ก-๙]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) : "";
    return "meowrin_" + (c ? c.id : Date.now()) + (t ? "_" + t : "") + ".mp3";
  }
  function canShareFile(f){ try{ return !!(navigator.canShare && navigator.canShare({ files:[f] })); }catch(e){ return false; } }

  function note(text, err){ $("ttsMsg").innerHTML = text ? '<div class="msg'+(err?' err':'')+'">'+MW.esc(text)+'</div>' : ""; }
  function sync(){ /* เรียกทุกครั้งที่บทในจอเปลี่ยน */
    var text = scriptText(), n = text.length, a = found(text);
    $("ttsBtn").disabled = busy || !n;
    $("ttsBtn").textContent = busy ? "กำลังสร้างเสียง..." : (a ? "สร้างเสียงใหม่" : "🔊 สร้างเสียง") + (n ? " · " + n.toLocaleString() + " ตัวอักษร" : "");
    $("ttsOut").hidden = !a;
    if(a && $("ttsAudio").dataset.url !== a.url){
      $("ttsAudio").src = a.url; $("ttsAudio").dataset.url = a.url;
      $("ttsDl").href = a.url; $("ttsDl").download = a.name;
      $("ttsShare").hidden = !canShareFile(new File([a.blob], a.name, { type:"audio/mpeg" }));
    }
  }
  document.addEventListener("mw:script", sync);

  $("ttsBtn").addEventListener("click", async function(){
    var text = scriptText(); if(busy || !text) return;
    if(text.length > MAX_CHARS){ note("บทยาว " + text.length.toLocaleString() + " ตัวอักษร เกินเพดาน " + MAX_CHARS.toLocaleString() + " ต่อครั้งของ ElevenLabs ตัดให้สั้นลงก่อน", true); return; }
    busy = true; note(""); sync();
    try{
      var blob = await speak(text), name = fileName();
      made = made.filter(function(x){ return x.text !== text; });
      made.push({ text:text, blob:blob, url:URL.createObjectURL(blob), name:name });
      while(made.length > 5) URL.revokeObjectURL(made.shift().url); /* คืนหน่วยความจำ */
      MW.toast("สร้างเสียงแล้ว");
    }catch(err){ note(err.message, true); }
    busy = false; sync();
  });

  $("ttsShare").addEventListener("click", async function(){
    var a = found(scriptText()); if(!a) return;
    try{ await navigator.share({ files:[new File([a.blob], a.name, { type:"audio/mpeg" })], title:a.name }); }
    catch(err){ if(err && err.name !== "AbortError") note("แชร์ไม่ได้ ใช้ปุ่มดาวน์โหลดแทน (" + err.message + ")", true); }
  });

  /* ---------- ตั้งค่า ---------- */
  function keyState(){ var on = !!load(KEY, ""); $("elState").textContent = on ? "✓ ตั้งแล้ว" : "ยังไม่ได้ตั้ง"; $("elState").classList.toggle("ok", on); }
  function renderUsage(){
    var u = cfg.usage.m === monthKey() ? cfg.usage : { chars:0, n:0 };
    $("ttsUsage").textContent = u.n ? "เดือนนี้ส่งไปสร้างเสียงแล้ว " + u.chars.toLocaleString() + " ตัวอักษร (" + u.n + " ครั้ง จากแอพนี้) ยอดเครดิตจริงดูในเว็บ ElevenLabs" : "เดือนนี้ยังไม่ได้สร้างเสียงจากแอพนี้";
  }
  $("elKey").value = load(KEY, ""); $("elVoice").value = cfg.voice;
  $("elModel").value = cfg.model; if($("elModel").value !== cfg.model){ cfg.model = "eleven_v3"; $("elModel").value = cfg.model; }
  $("elStab").value = String(cfg.stability); if($("elStab").value !== String(cfg.stability)){ cfg.stability = 0.5; $("elStab").value = "0.5"; }
  function saveAll(){
    var ok = save(KEY, $("elKey").value.trim());
    cfg.voice = $("elVoice").value.trim(); cfg.model = $("elModel").value; cfg.stability = Number($("elStab").value);
    ok = saveCfg() && ok;
    MW.toast(ok ? "บันทึกแล้ว" : "บันทึกไม่ได้", !ok); keyState();
  }
  ["elKey","elVoice","elModel","elStab"].forEach(function(id){ $(id).addEventListener("change", saveAll); }); /* บันทึกอัตโนมัติ (รวมตอนกด วาง/ลบ) */

  keyState(); renderUsage(); sync();
})();
