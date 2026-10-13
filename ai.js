/* ai.js — ทำบทด้วย OpenRouter (ค่าเริ่มต้น google/gemini-3.8-flash เลือกโมเดลจาก dropdown): แนะนำ prompt A/B → State 1 → รัน → แก้บท
   ต้องโหลดหลัง app.js (ใช้ window.MW) ElevenLabs ยังไม่ทำ จะเติมในเฟสถัดไป */
(function(){
  "use strict";
  var MW = window.MW; if(!MW) return;
  var $ = function(id){ return document.getElementById(id); };
  var CFG = "mw_ai_cfg_v1", OR_KEY = "mw_openrouter_key_v1"; /* ใช้ชื่อ storage ใหม่ จะได้ไม่เอา Google key เก่าไปส่งให้ OpenRouter */
  var ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
  var DEFAULT_MODEL = "google/gemini-3.8-flash";
  function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
  function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  var cfg = Object.assign({ model:DEFAULT_MODEL, think:"medium", A:"", B:"" }, load(CFG, {}));
  if(cfg.model.indexOf("/") < 0) cfg.model = DEFAULT_MODEL; /* ชื่อโมเดลเก่าแบบ Gemini ตรง (ไม่มี "ค่าย/") OpenRouter ไม่รู้จัก */
  var chat = [], s1Len = 0, chatClip = null; /* chat เก็บเป็นรูปแบบ OpenAI: { role: "user"|"assistant", content } */

  function note(el, text, err){ $(el).innerHTML = text ? '<div class="msg'+(err?' err':'')+'">'+MW.esc(text)+'</div>' : ""; }
  function busy(ids, on){ ids.forEach(function(i){ $(i).disabled = on; }); }
  function sel(){ return document.querySelector('input[name="pSel"]:checked').value; }

  /* ---------- OpenRouter ---------- */
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function isGoogle(m){ return /^google\//.test(m || ""); }
  function supportsReasoning(m){
    return /^google\/gemini-(2\.5|[3-9])/.test(m)          /* Gemini 2.5 ขึ้นไป */
        || /^anthropic\/claude-/.test(m)                     /* Claude ชุดที่ใช้ในรายการ รองรับ reasoning */
        || /^openai\/(o\d|gpt-([5-9]|\d{2,}))/.test(m);      /* o-series / GPT-5+ (gpt-4o-mini ไม่รองรับ) */
  }
  async function callAI(messages, system, json, think){
    var key = load(OR_KEY, "");
    if(!key) throw new Error("ยังไม่ได้ใส่ OpenRouter API key (แท็บตั้งค่า)");
    var body = { model: cfg.model, messages: system ? [{ role:"system", content: system }].concat(messages) : messages };
    if(json) body.response_format = { type: "json_object" };
    if(supportsReasoning(cfg.model)) body.reasoning = { effort: think || cfg.think || "medium" }; /* ส่งเฉพาะโมเดลที่รองรับ */
    var res, j, delays = [2000, 5000];
    for(var attempt = 0; ; attempt++){
      res = await fetch(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify(body)
      });
      j = await res.json().catch(function(){ return {}; });
      if((res.status === 502 || res.status === 503) && attempt < delays.length){ await sleep(delays[attempt]); continue; } /* ผู้ให้บริการล่ม/คนใช้เยอะชั่วคราว ลองซ้ำ */
      break;
    }
    var er = j.error || (j.choices && j.choices[0] && j.choices[0].error); /* OpenRouter อาจส่ง error มาใน body ทั้งที่ status 200 */
    if(!res.ok || er){
      var st = (er && typeof er.code === "number") ? er.code : res.status;
      var m = (er && er.message) || "", md = (er && er.metadata) || {};
      if(Array.isArray(md.reasons) && md.reasons.length) m += " (เหตุผล: " + md.reasons.join(", ") + ")";
      if(typeof md.raw === "string" && md.raw) m += " — " + (md.provider_name ? md.provider_name + ": " : "") + md.raw.slice(0, 200);
      if(st === 401) throw new Error("OpenRouter key ใช้ไม่ได้ เช็ก key ในตั้งค่า: " + m);
      if(st === 402) throw new Error("เครดิต OpenRouter ไม่พอ เติมเครดิตแล้วลองใหม่: " + m);
      if(st === 403) throw new Error("OpenRouter บล็อกคำขอนี้ (moderation): " + m);
      if(st === 408) throw new Error("โมเดล " + cfg.model + " ตอบช้าเกินเวลา ลองใหม่อีกครั้ง");
      if(st === 429) throw new Error("ชนลิมิต/โควต้า OpenRouter ลองใหม่อีกสักพัก" + (m ? ": " + m : ""));
      if(st === 502 || st === 503) throw new Error("โมเดล " + cfg.model + " ใช้ไม่ได้ชั่วคราว (ผู้ให้บริการล่ม/คนใช้เยอะ) ลองใหม่อีกครั้ง หรือเปลี่ยนโมเดลในตั้งค่า" + (m ? ": " + m : ""));
      if(st === 404 || (st === 400 && /valid model|model id/i.test(m))) throw new Error("ไม่พบโมเดล/ผู้ให้บริการที่รองรับ \"" + cfg.model + "\" เช็กชื่อโมเดลในตั้งค่า" + (m ? ": " + m : ""));
      if(st === 400 && /reasoning|thinking/i.test(m)) throw new Error("โมเดลนี้ไม่รับระดับการคิดที่ตั้งไว้ ลองเปลี่ยนระดับในตั้งค่า: " + m);
      var e = new Error("OpenRouter error " + st + (m ? ": " + m : "")); e.status = st; throw e;
    }
    var c = j.choices && j.choices[0], t = c && c.message && c.message.content;
    if(typeof t !== "string" || !t.trim()) throw new Error("โมเดลไม่ตอบ" + (c && c.finish_reason ? " (finish_reason: " + c.finish_reason + ")" : ""));
    return t.trim();
  }
  function needPrompt(p){
    if(!cfg[p] || !cfg[p].trim()) throw new Error("ยังไม่ได้วาง prompt "+p+" (แท็บตั้งค่า)");
    return cfg[p];
  }
  function sourceContent(){
    var c = MW.data.picked, t = $("sTrans").value.trim();
    if(t) return t;
    if(isGoogle(cfg.model)) return [{ type:"video_url", video_url:{ url: "https://www.youtube.com/watch?v=" + c.id } }, { type:"text", text: "https://www.youtube.com/shorts/" + c.id }];
    /* โมเดลค่ายอื่นรับ YouTube video_url ตรงๆ ไม่ได้ ส่งลิงก์เป็นข้อความธรรมดากัน API error */
    return "ลิงก์วิดีโอ YouTube: https://www.youtube.com/watch?v=" + c.id + "\n(โมเดลนี้เปิดดูวิดีโอจากลิงก์โดยตรงไม่ได้ และไม่มีทรานสคริปต์แนบมา)";
  }
  function srcHint(err){ return err.message + (err.status === 400 || /video|URL|youtube/i.test(err.message) ? "\nถ้าดึงจากลิงก์ไม่ได้ ลองวางทรานสคริปต์ในช่องด้านบนแทน" : ""); }

  /* ---------- หน้า ---------- */
  function refresh(){
    var c = MW.data.picked;
    $("sNoClip").hidden = !!c; $("sBody").hidden = !c;
    if(!c) return;
    $("sTitle").textContent = c.title;
    $("sMeta").textContent = (c.channel || "") + (MW.data.made[c.id] ? " · เคยทำแล้ว" : "");
    if(chatClip !== c.id){ chat = []; s1Len = 0; chatClip = c.id; $("s1Wrap").hidden = true; $("s2Wrap").hidden = true; $("reco").innerHTML = ""; note("sMsg",""); }
  }
  document.addEventListener("mw:tab", function(e){ if(e.detail === "script") refresh(); });

  /* ---------- แนะนำ prompt ---------- */
  $("recoBtn").addEventListener("click", async function(){
    busy(["recoBtn"], true); note("sMsg","กำลังดูคลิป...");
    try{
      var sys = 'คุณคัดเลือกวิธีทำบทพากย์ One Piece Shorts ภาษาไทย ตอบเป็น JSON เท่านั้นรูปแบบ {"prompt":"A" หรือ "B","reason":"เหตุผลสั้นๆ 1 ประโยคภาษาไทย"}\n'
        + 'A = ยึดโครงเรื่องและจังหวะต้นฉบับ เหมาะกับคอมเมดี้/WTF ที่ลำดับ setup→punchline คือตัวขาย คลิปสั้น เสียง OG เยอะ ลิสต์นับจำนวนที่ลำดับสำคัญ\n'
        + 'B = ดึงแก่นไวรัลแล้วเรียบเรียงใหม่ เหมาะกับคลิปเล่า lore/ข้อมูลที่โครงเรื่องไม่คม หรือยาวและต้องจัดใหม่ ถ้าไม่แน่ใจให้เลือก B';
      var out = await callAI([{ role:"user", content: sourceContent() }], sys, true, "low");
      var r = JSON.parse(out.replace(/```json|```/g, "").trim());
      var p = r.prompt === "A" ? "A" : "B";
      document.querySelector('input[name="pSel"][value="'+p+'"]').checked = true;
      $("reco").innerHTML = '<div class="reco"><b>แนะนำ '+p+'</b> · '+MW.esc(r.reason || "")+'</div>';
      note("sMsg","");
    }catch(err){ note("sMsg", srcHint(err), true); }
    busy(["recoBtn"], false);
  });

  /* ---------- State 1 ---------- */
  $("s1Btn").addEventListener("click", async function(){
    busy(["s1Btn"], true); note("sMsg","กำลังวิเคราะห์ซอส...");
    try{
      var sys = needPrompt(sel());
      chat = [{ role:"user", content: sourceContent() }];
      var out = await callAI(chat, sys);
      chat.push({ role:"assistant", content: out }); s1Len = chat.length;
      $("s1Out").value = out; $("s1Wrap").hidden = false; $("s2Wrap").hidden = true; note("sMsg","");
    }catch(err){ note("sMsg", srcHint(err), true); }
    busy(["s1Btn"], false);
  });

  function syncS1(){ chat[s1Len-1] = { role:"assistant", content: $("s1Out").value }; chat.length = s1Len; }

  $("s1FbBtn").addEventListener("click", async function(){
    var fb = $("s1Fb").value.trim(); if(!fb || !s1Len) return;
    busy(["s1FbBtn"], true); note("sMsg","กำลังปรับ State 1...");
    try{
      syncS1();
      var next = chat.concat([{ role:"user", content: fb }]);
      var out = await callAI(next, needPrompt(sel()));
      chat = next.concat([{ role:"assistant", content: out }]); s1Len = chat.length;
      $("s1Out").value = out; $("s1Fb").value = ""; note("sMsg","");
    }catch(err){ note("sMsg", err.message, true); }
    busy(["s1FbBtn"], false);
  });

  /* ---------- State 2 (รัน) ---------- */
  async function runState2(){
    busy(["runBtn","rerunBtn"], true); note("sMsg","กำลังเขียนบท...");
    try{
      syncS1();
      var next = chat.concat([{ role:"user", content: "รัน" }]);
      var out = await callAI(next, needPrompt(sel()));
      $("s2Out").value = out; $("s2Wrap").hidden = false; note("sMsg","");
      var id = MW.data.picked.id; MW.data.made[id] = true; MW.persist(); MW.onMadeChange();
    }catch(err){ note("sMsg", err.message, true); }
    busy(["runBtn","rerunBtn"], false);
  }
  $("runBtn").addEventListener("click", runState2);
  $("rerunBtn").addEventListener("click", runState2);

  $("s2FbBtn").addEventListener("click", async function(){
    var fb = $("s2Fb").value.trim(), txt = $("s2Out").value.trim(); if(!fb || !txt) return;
    busy(["s2FbBtn"], true); note("sMsg","กำลังแก้บท...");
    try{
      var out = await callAI([{ role:"user", content: "แก้บทพากย์ด้านล่างตามคำสั่ง แล้วตอบกลับมาเป็นฉบับแก้ไขทั้งหมด คงรูปแบบ PART 1 / PART 2 เดิม ไม่ต้องมีคำอธิบายเพิ่ม\n\nคำสั่ง: " + fb + "\n\n----\n" + txt }]);
      $("s2Out").value = out; $("s2Fb").value = ""; note("sMsg","");
    }catch(err){ note("sMsg", err.message, true); }
    busy(["s2FbBtn"], false);
  });

  $("copyBtn").addEventListener("click", function(){
    var t = $("s2Out").value, m = /PART 2[^\n]*\n/i.exec(t);
    var txt = (m ? t.slice(m.index + m[0].length) : t).trim();
    var done = function(){ $("copyBtn").textContent = "คัดลอกแล้ว"; setTimeout(function(){ $("copyBtn").textContent = "คัดลอกเฉพาะบท"; }, 1500); };
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(done).catch(function(){ window.prompt("คัดลอกบทนี้", txt); });
  });

  /* ---------- ตั้งค่า AI ---------- */
  $("gKey").value = load(OR_KEY, ""); $("gModel").value = cfg.model;
  if($("gModel").value !== cfg.model){ cfg.model = DEFAULT_MODEL; $("gModel").value = DEFAULT_MODEL; } /* โมเดลที่เซฟไว้เก่าและไม่อยู่ใน dropdown → ใช้ค่าเริ่มต้น */
  $("gThink").value = cfg.think; $("pA").value = cfg.A; $("pB").value = cfg.B;
  var THINK_TH = { low:"ต่ำสุด", medium:"ปานกลาง", high:"สูงสุด" };
  function updateModelLine(){ $("sModel").textContent = "โมเดล: " + cfg.model + " · ระดับการคิด: " + (THINK_TH[cfg.think] || cfg.think); }
  function orState(){ var on = !!$("gKey").value.trim(); $("gState").textContent = on ? "✓ ตั้งแล้ว" : "ยังไม่ได้ตั้ง"; $("gState").classList.toggle("ok", on); }
  orState();
  function saveAi(){
    cfg = { model: $("gModel").value || DEFAULT_MODEL, think: $("gThink").value, A: $("pA").value, B: $("pB").value };
    var ok = save(CFG, cfg) && save(OR_KEY, $("gKey").value.trim());
    MW.toast(ok ? "บันทึกแล้ว" : "บันทึกไม่ได้", !ok);
    updateModelLine(); orState();
  }
  ["gKey","gModel","gThink","pA","pB"].forEach(function(id){ $(id).addEventListener("change", saveAi); }); /* บันทึกอัตโนมัติทุกครั้งที่แก้ */
  $("saveAi").addEventListener("click", saveAi);

  updateModelLine();
  refresh();
})();
