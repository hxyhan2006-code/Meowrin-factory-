/* llm.js — ชั้นเรียก AI (ไม่มีหน้าจอของตัวเอง ยกเว้นบรรทัดค่าใช้จ่าย #spendInfo)
   คำขอที่ผู้เรียกใส่ opt.free (งานเล็ก/ข้อความล้วน เช่น แก้บท) + โมเดล Google + มี Gemini key → Gemini API ตรงก่อน (ฟรี)
   โควตาเต็ม/key ใช้ไม่ได้/ล่ม/ช้า → ถอยไป OpenRouter ให้เอง · งานดูวิดีโอ/เขียนบทหลักไม่ใส่ opt.free = OpenRouter ตรงๆ (Gemini ฟรีช้า/ล่มบ่อยกับวิดีโอ)
   ต้องโหลดหลัง app.js และก่อน ai.js · ส่งออก MW.llm */
(function(){
  "use strict";
  var MW = window.MW; if(!MW) return;
  var $ = function(id){ return document.getElementById(id); };
  var OR_KEY = "mw_openrouter_key_v1", GM_KEY = "mw_gemini_key_v1";
  var OR_URL = "https://openrouter.ai/api/v1/chat/completions";
  var GM_TIMEOUT = 90e3;
  var GM_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
  function load(k, d){ return MWStore.get(k, d); } /* store.js: IndexedDB + แคช */
  function save(k, v){ return MWStore.set(k, v); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  /* ---------- ค่าใช้จ่ายรายเดือน (mw_cost_v1) · g = จำนวนคำขอที่ใช้ Gemini ฟรี ---------- */
  var LAST = "mw_gemini_last_v1"; /* เหตุผลล่าสุดที่ Gemini ตรงใช้ไม่ได้ (ไว้โชว์ในตั้งค่า) */
  var COST = "mw_cost_v1";
  function monthKey(){ var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  var spend = load(COST, {});
  function fresh(){ if(spend.m !== monthKey()) spend = { m:monthKey(), usd:0, n:0, g:0 }; spend.g = spend.g || 0; }
  function money(x){ return "$" + (x < 0.1 ? x.toFixed(3) : x.toFixed(2)); }
  function renderSpend(){
    fresh();
    var t = [], orUse = MWBudget.real(); /* ยอดจริงจาก OpenRouter ({d,w,m} USD) ดึงโดย budget.js — รวมทุกการใช้ key นี้ ไม่ใช่แค่ในแอพ */
    if(orUse) t.push("OpenRouter รายงาน (ทุกการใช้ key นี้): วันนี้ " + money(orUse.d) + " · สัปดาห์นี้ " + money(orUse.w) + " · เดือนนี้ " + money(orUse.m) + " (เวลา UTC)");
    else if(spend.n) t.push("เดือนนี้ใช้ไป " + money(spend.usd) + " (" + spend.n + " คำขอผ่าน OpenRouter)");
    if(spend.g) t.push("ฟรีผ่าน Gemini " + spend.g + " คำขอ");
    $("spendInfo").textContent = t.length ? t.join(" · ") : "ยังไม่มีข้อมูลค่าใช้จ่ายเดือนนี้ (จะแสดงหลังทำบทครั้งถัดไป)";
  }
  function addSpend(usd, free){ fresh(); if(free) spend.g++; else { spend.usd += usd; spend.n++; MWBudget.add(usd); } save(COST, spend); renderSpend(); } /* MWBudget.add นับเพดาน + ดึงยอดจริงใหม่ */
  function refreshUsage(){ return MWBudget.refresh().then(renderSpend); }
  MWStore.on(function(k){ if(k === "mw_spend_v1") renderSpend(); }); /* ยอดจริงอัปเดต (จาก budget.js) → วาดใหม่ */

  function isGoogle(m){ return /^google\//.test(m || ""); }
  function short(m){ return String(m || "").replace(/^[^/]+\//, ""); }

  /* ---------- OpenRouter ---------- */
  function supportsReasoning(m){
    return /^google\/gemini-(2\.5|[3-9])/.test(m)          /* Gemini 2.5 ขึ้นไป */
        || /^anthropic\/claude-/.test(m)                     /* Claude ชุดที่ใช้ในรายการ รองรับ reasoning */
        || /^openai\/(o\d|gpt-([5-9]|\d{2,}))/.test(m);      /* o-series / GPT-5+ */
  }
  function textOnly(msg){
    if(!Array.isArray(msg.content)) return msg;
    return { role: msg.role, content: msg.content.map(function(p){
      return p.type === "video_url" ? "ลิงก์วิดีโอ YouTube: " + p.video_url.url + " (เนื้อหาคลิปดูจาก State 1 ด้านล่าง)" : (p.text || "");
    }).filter(Boolean).join("\n") };
  }
  async function viaOpenRouter(messages, system, model, think, v){
    var key = load(OR_KEY, "");
    if(!key) throw new Error("ยังไม่ได้ใส่ OpenRouter API key (แท็บตั้งค่า)");
    MWBudget.check(); /* เกินเพดานรายวัน/รายเดือน → หยุดก่อนเรียก */
    if(!isGoogle(model)) messages = messages.map(textOnly); /* ค่ายอื่นรับ video_url ไม่ได้ (เช่น ตอนเขียนบทต่อจาก State 1 ที่ Gemini ดูคลิป) */
    var body = { model: model, messages: system ? [{ role:"system", content: system }].concat(messages) : messages };
    if(supportsReasoning(model)) body.reasoning = { effort: think || "medium" }; /* ส่งเฉพาะโมเดลที่รองรับ */
    body.usage = { include: true }; /* ขอให้ OpenRouter ส่งค่าใช้จ่ายของคำขอนี้กลับมา */
    var res, j, delays = [2000, 5000];
    for(var attempt = 0; ; attempt++){
      res = await fetch(OR_URL, {
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
      if(st === 408) throw new Error("โมเดล " + model + " ตอบช้าเกินเวลา ลองใหม่อีกครั้ง");
      if(st === 429) throw new Error("ชนลิมิต/โควต้า OpenRouter ลองใหม่อีกสักพัก" + (m ? ": " + m : ""));
      if(st === 502 || st === 503) throw new Error("โมเดล " + model + " ใช้ไม่ได้ชั่วคราว (ผู้ให้บริการล่ม/คนใช้เยอะ) ลองใหม่อีกครั้ง หรือเปลี่ยนโมเดลในตั้งค่า" + (m ? ": " + m : ""));
      if(st === 404 || (st === 400 && /valid model|model id/i.test(m))) throw new Error("ไม่พบโมเดล/ผู้ให้บริการที่รองรับ \"" + model + "\" เช็กชื่อโมเดลในตั้งค่า" + (m ? ": " + m : ""));
      if(st === 400 && /reasoning|thinking/i.test(m)) throw new Error("โมเดลนี้ไม่รับระดับการคิดที่ตั้งไว้ ลองเปลี่ยนระดับในตั้งค่า: " + m);
      var e = new Error("OpenRouter error " + st + (m ? ": " + m : "")); e.status = st; throw e;
    }
    var c = j.choices && j.choices[0], t = c && c.message && c.message.content;
    if(typeof t !== "string" || !t.trim()) throw new Error("โมเดลไม่ตอบ" + (c && c.finish_reason ? " (finish_reason: " + c.finish_reason + ")" : ""));
    var cost = j.usage && typeof j.usage.cost === "number" ? j.usage.cost : null;
    if(cost !== null){ if(v) v.cost = (v.cost || 0) + cost; addSpend(cost, false); }
    return t.trim();
  }

  /* ---------- Gemini API ตรง (generateContent) ----------
     ข้อความแบบ OpenRouter → contents ของ Gemini · video_url (YouTube) → fileData.fileUri */
  function toGemini(messages){
    return messages.map(function(msg){
      var parts = Array.isArray(msg.content) ? msg.content.map(function(p){
        return p.type === "video_url" ? { fileData:{ fileUri: p.video_url.url } } : { text: p.text || "" };
      }) : [{ text: String(msg.content || "") }];
      return { role: msg.role === "assistant" ? "model" : "user", parts: parts };
    });
  }
  var on = true; /* เปิด/ปิดใช้ Gemini ตรง (ตั้งจาก ai.js ตามติ๊ก "ใช้ Gemini ฟรี") */
  var skip = {}, noThink = {}; /* skip.all = งดเรียก Gemini ตรงถึงเวลานี้ (โควตาเต็ม/key ผิด) · skip[model] = ไม่รู้จักโมเดลนี้ · noThink[model] = ไม่รับระดับการคิด */
  function gemFail(why, fallback){ var e = new Error(why); e.fallback = fallback; return e; }
  async function viaGemini(messages, system, model, think, key){
    var body = { contents: toGemini(messages) };
    if(system) body.systemInstruction = { parts:[{ text: system }] };
    if(think && !noThink[model]) body.generationConfig = { thinkingConfig:{ thinkingLevel: think } };
    var res, j, ctl = new AbortController(), timer = setTimeout(function(){ ctl.abort(); }, GM_TIMEOUT); /* ฟรีอาจคิวยาว ช้าเกินกำหนด = ถอยไป OpenRouter */
    for(var attempt = 0; attempt < 2; attempt++){
      try{
        res = await fetch(GM_URL + encodeURIComponent(short(model)) + ":generateContent", {
          method:"POST", headers:{ "Content-Type":"application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: ctl.signal
        });
        j = await res.json().catch(function(){ return {}; });
      }catch(err){ clearTimeout(timer); if(ctl.signal.aborted) skip.all = Date.now() + 10 * 60e3; /* ช้าเกิน = งด Gemini ชั่วคราว ไม่ต้องรอซ้ำทุกขั้น */
        throw gemFail(ctl.signal.aborted ? "Gemini ตอบช้าเกิน " + GM_TIMEOUT / 1000 + " วินาที" : "ต่อ Gemini ไม่ได้", true); } /* เน็ต/CORS/หมดเวลา */
      var m = (j.error && j.error.message) || "";
      /* โมเดลไม่รับระดับการคิดที่ตั้งไว้ → ลองใหม่ครั้งเดียวด้วยค่าเริ่มต้นของโมเดล */
      if(res.status === 400 && body.generationConfig && /thinking/i.test(m)){ delete body.generationConfig; noThink[model] = true; continue; }
      break;
    }
    clearTimeout(timer);
    if(!res.ok){
      var st = res.status, why = (j.error && j.error.message) || ("HTTP " + st);
      var g = " [" + st + ": " + why.slice(0, 160) + "]"; /* ข้อความจริงจาก Google ไว้ดูสาเหตุ */
      if(st === 429){ skip.all = Date.now() + 10 * 60e3; throw gemFail("โควตา Gemini ฟรีเต็ม/ไม่มีโควตาฟรี" + g, true); }
      if(st === 404){ skip[model] = true; throw gemFail("Gemini ไม่รู้จักโมเดล " + short(model) + g, true); }
      if(st === 401 || st === 403 || /API key/i.test(why)){ skip.all = Date.now() + 60 * 60e3; throw gemFail("Gemini key ใช้ไม่ได้" + g, true); }
      if(st >= 500) throw gemFail("Gemini ล่มชั่วคราว" + g, true);
      throw gemFail("Gemini error " + st + " (" + why.slice(0, 120) + ")", true); /* คำขอที่ Gemini ตรงไม่รับ OpenRouter อาจยังทำได้ (เคยใช้ได้จริง) */
    }
    var cand = j.candidates && j.candidates[0];
    var t = cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts.filter(function(p){ return !p.thought && typeof p.text === "string"; }).map(function(p){ return p.text; }).join("") : "";
    if(!t.trim()){
      var block = j.promptFeedback && j.promptFeedback.blockReason;
      throw gemFail("Gemini ไม่ตอบ" + (block ? " (บล็อก: " + block + ")" : cand && cand.finishReason ? " (finishReason: " + cand.finishReason + ")" : ""), false);
    }
    return t.trim();
  }

  /* ---------- ทางเข้าเดียวของทั้งแอพ ---------- */
  async function call(messages, system, model, opt){
    opt = opt || {};
    var gk = load(GM_KEY, "");
    if(opt.free && on && gk && isGoogle(model) && !skip[model] && !(skip.all > Date.now())){
      try{
        var t = await viaGemini(messages, system, model, opt.think, gk);
        if(opt.v) opt.v.free = (opt.v.free || 0) + 1;
        addSpend(0, true);
        return t;
      }catch(err){
        if(!err.fallback) throw err;
        if(!load(OR_KEY, "")) throw new Error(err.message + " และยังไม่ได้ใส่ OpenRouter key ให้ใช้แทน");
        save(LAST, { at: Date.now(), msg: err.message }); /* เก็บเหตุผลไว้โชว์ในตั้งค่า (toast หายเร็ว) */
        MW.toast(err.message.replace(/ \[.*$/, "") + " → ใช้ OpenRouter แทน (ดูเหตุผลในตั้งค่า)", false, 6000);
      }
    }
    return viaOpenRouter(messages, system, model, opt.think, opt.v);
  }

  /* ปุ่ม "ทดสอบ Gemini" ในตั้งค่า: ยิงคำขอสั้นๆ ต่อโมเดล แล้วคืนผลดิบ (สถานะ + ข้อความจาก Google) ไว้ดูสาเหตุที่ถอยไป OpenRouter */
  async function testGemini(models, think){
    var key = load(GM_KEY, ""); if(!key) return ["ยังไม่ได้ใส่ Gemini key"];
    var out = [], last = load(LAST, null);
    if(last) out.push("ครั้งล่าสุดที่ถอยไป OpenRouter: " + last.msg);
    try{ /* รายชื่อโมเดลที่คีย์นี้เรียกได้จริง ไว้เทียบชื่อ */
      var lr = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers:{ "x-goog-api-key": key } });
      var lj = await lr.json().catch(function(){ return {}; });
      out.push(lr.ok ? "โมเดล Gemini ที่เรียกได้: " + (lj.models || []).filter(function(x){ return /gemini/i.test(x.name) && (x.supportedGenerationMethods || []).indexOf("generateContent") >= 0; })
        .map(function(x){ return x.name.replace(/^models\//, ""); }).slice(0, 30).join(", ") : "ดึงรายชื่อโมเดลไม่ได้ HTTP " + lr.status + " " + ((lj.error && lj.error.message) || "").slice(0, 150));
    }catch(err){ out.push("ดึงรายชื่อโมเดลไม่ได้ (" + err.message + ")"); }
    for(var i = 0; i < models.length; i++){
      var m = models[i], line = short(m) + " : ";
      try{
        var res = await fetch(GM_URL + encodeURIComponent(short(m)) + ":generateContent", {
          method:"POST", headers:{ "Content-Type":"application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents:[{ role:"user", parts:[{ text:"ตอบคำเดียวว่า ok" }] }], generationConfig: think ? { thinkingConfig:{ thinkingLevel: think } } : undefined })
        });
        var j = await res.json().catch(function(){ return {}; });
        line += res.ok ? "ใช้ได้ (HTTP " + res.status + ")" : "ใช้ไม่ได้ HTTP " + res.status + " " + ((j.error && j.error.message) || "").slice(0, 200);
      }catch(err){ line += "ต่อไม่ได้ (" + err.message + ")"; }
      out.push(line);
    }
    return out;
  }

  MW.llm = { setOn: function(v){ on = !!v; }, test: testGemini, call: call, isGoogle: isGoogle, short: short, money: money, OR_KEY: OR_KEY, GM_KEY: GM_KEY };
  renderSpend(); refreshUsage();
  document.addEventListener("mw:tab", function(e){ if(e.detail === "settings") refreshUsage(); });
})();
