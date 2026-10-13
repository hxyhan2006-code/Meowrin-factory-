/* ai.js — ทำบทด้วย Gemini: แนะนำ prompt A/B → State 1 → รัน → แก้บท
   ต้องโหลดหลัง app.js (ใช้ window.MW) ElevenLabs ยังไม่ทำ จะเติมในเฟสถัดไป */
(function(){
  "use strict";
  var MW = window.MW; if(!MW) return;
  var $ = function(id){ return document.getElementById(id); };
  var CFG = "mw_ai_cfg_v1", GK = "mw_gemini_key_v1";
  var ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";
  function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
  function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  var cfg = Object.assign({ model:"gemini-3.8-flash", think:"medium", A:"", B:"" }, load(CFG, {}));
  var chat = [], s1Len = 0, chatClip = null;

  function note(el, text, err){ $(el).innerHTML = text ? '<div class="msg'+(err?' err':'')+'">'+MW.esc(text)+'</div>' : ""; }
  function busy(ids, on){ ids.forEach(function(i){ $(i).disabled = on; }); }
  function sel(){ return document.querySelector('input[name="pSel"]:checked').value; }

  /* ---------- Gemini ---------- */
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  async function gemini(contents, system, json, think){
    var key = load(GK, "");
    if(!key) throw new Error("ยังไม่ได้ใส่ Gemini API key (แท็บตั้งค่า)");
    var body = { contents: contents }, gc = {};
    if(system) body.systemInstruction = { parts: [{ text: system }] };
    if(json) gc.responseMimeType = "application/json";
    if(/^gemini-3/.test(cfg.model)) gc.thinkingConfig = { thinkingLevel: think || cfg.think || "medium" };
    if(Object.keys(gc).length) body.generationConfig = gc;
    var res, j, delays = [2000, 5000];
    for(var attempt = 0; ; attempt++){
      res = await fetch(ENDPOINT + encodeURIComponent(cfg.model) + ":generateContent", {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body)
      });
      j = await res.json().catch(function(){ return {}; });
      if(res.status === 503 && attempt < delays.length){ await sleep(delays[attempt]); continue; } /* โมเดลคนใช้เยอะชั่วคราว ลองซ้ำ */
      break;
    }
    if(!res.ok){
      var m = (j.error && j.error.message) || "";
      if(res.status === 503) throw new Error("โมเดล " + cfg.model + " คนใช้เยอะ ลองใหม่อีกครั้ง หรือเปลี่ยนโมเดลในตั้งค่า");
      if(res.status === 429) throw new Error("ชนลิมิต/โควต้า Gemini ลองใหม่อีกสักพัก");
      if(res.status === 403 || /API key/i.test(m)) throw new Error("Gemini key ใช้ไม่ได้: " + m);
      if(res.status === 404) throw new Error("ไม่พบโมเดล "+cfg.model+" เช็กชื่อโมเดลในตั้งค่า");
      if(res.status === 400 && /thinking/i.test(m)) throw new Error("โมเดลนี้ไม่รับระดับการคิดที่ตั้งไว้ ลองเปลี่ยนระดับในตั้งค่า: " + m);
      var e = new Error("Gemini error " + res.status + (m ? ": " + m : "")); e.status = res.status; throw e;
    }
    var c = j.candidates && j.candidates[0];
    if(!c || !c.content || !c.content.parts) throw new Error("Gemini ไม่ตอบ" + (j.promptFeedback && j.promptFeedback.blockReason ? " (ถูกบล็อก: "+j.promptFeedback.blockReason+")" : ""));
    return c.content.parts.map(function(p){ return p.text || ""; }).join("").trim();
  }
  function needPrompt(p){
    if(!cfg[p] || !cfg[p].trim()) throw new Error("ยังไม่ได้วาง prompt "+p+" (แท็บตั้งค่า)");
    return cfg[p];
  }
  function sourceParts(){
    var c = MW.data.picked, t = $("sTrans").value.trim();
    if(t) return [{ text: t }];
    return [{ fileData: { fileUri: "https://www.youtube.com/watch?v=" + c.id } }, { text: "https://www.youtube.com/shorts/" + c.id }];
  }
  function srcHint(err){ return err.message + (err.status === 400 || /video|URL|fileUri/i.test(err.message) ? "\nถ้าดึงจากลิงก์ไม่ได้ ลองวางทรานสคริปต์ในช่องด้านบนแทน" : ""); }

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
      var out = await gemini([{ role:"user", parts: sourceParts() }], sys, true, "low");
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
      chat = [{ role:"user", parts: sourceParts() }];
      var out = await gemini(chat, sys);
      chat.push({ role:"model", parts:[{ text: out }] }); s1Len = chat.length;
      $("s1Out").value = out; $("s1Wrap").hidden = false; $("s2Wrap").hidden = true; note("sMsg","");
    }catch(err){ note("sMsg", srcHint(err), true); }
    busy(["s1Btn"], false);
  });

  function syncS1(){ chat[s1Len-1] = { role:"model", parts:[{ text: $("s1Out").value }] }; chat.length = s1Len; }

  $("s1FbBtn").addEventListener("click", async function(){
    var fb = $("s1Fb").value.trim(); if(!fb || !s1Len) return;
    busy(["s1FbBtn"], true); note("sMsg","กำลังปรับ State 1...");
    try{
      syncS1();
      var next = chat.concat([{ role:"user", parts:[{ text: fb }] }]);
      var out = await gemini(next, needPrompt(sel()));
      chat = next.concat([{ role:"model", parts:[{ text: out }] }]); s1Len = chat.length;
      $("s1Out").value = out; $("s1Fb").value = ""; note("sMsg","");
    }catch(err){ note("sMsg", err.message, true); }
    busy(["s1FbBtn"], false);
  });

  /* ---------- State 2 (รัน) ---------- */
  async function runState2(){
    busy(["runBtn","rerunBtn"], true); note("sMsg","กำลังเขียนบท...");
    try{
      syncS1();
      var next = chat.concat([{ role:"user", parts:[{ text: "รัน" }] }]);
      var out = await gemini(next, needPrompt(sel()));
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
      var out = await gemini([{ role:"user", parts:[{ text: "แก้บทพากย์ด้านล่างตามคำสั่ง แล้วตอบกลับมาเป็นฉบับแก้ไขทั้งหมด คงรูปแบบ PART 1 / PART 2 เดิม ไม่ต้องมีคำอธิบายเพิ่ม\n\nคำสั่ง: " + fb + "\n\n----\n" + txt }] }]);
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
  $("gKey").value = load(GK, ""); $("gModel").value = cfg.model; $("gThink").value = cfg.think; $("pA").value = cfg.A; $("pB").value = cfg.B;
  $("saveAi").addEventListener("click", function(){
    cfg = { model: $("gModel").value.trim() || "gemini-3.8-flash", think: $("gThink").value, A: $("pA").value, B: $("pB").value };
    var ok = save(CFG, cfg) && save(GK, $("gKey").value.trim());
    note("aiSetMsg", ok ? "บันทึกแล้ว" : "บันทึกไม่ได้", !ok);
  });

  refresh();
})();
