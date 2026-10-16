/* ai.js — ทำบท (เรียก AI ผ่าน MW.llm ใน llm.js: Gemini ตรงก่อน แล้วถอยไป OpenRouter)
   ปุ่มเดียว "ทำบทเลย": ตัวดูคลิป (Google, State 1) → ตัวเขียนบท (โมเดลอะไรก็ได้, State 2)
   เลือกได้หลาย prompt = ได้หลายเวอร์ชันพร้อมกัน · ประวัติเก็บต่อคลิป
   ต้องโหลดหลัง app.js และ llm.js (ใช้ window.MW, MW.llm) */
(function(){
  "use strict";
  var MW = window.MW; if(!MW || !MW.llm) return;
  var $ = function(id){ return document.getElementById(id); };
  var esc = MW.esc;
  var CFG = "mw_ai_cfg_v1", L = MW.llm, OR_KEY = L.OR_KEY, GM_KEY = L.GM_KEY;
  var isGoogle = L.isGoogle, short = L.short, money = L.money;
  var DEFAULT_MODEL = "google/gemini-3.8-flash";
  var CHARS_PER_SEC = 14; /* ความเร็วพากย์ไทยโดยประมาณ ใช้กะความยาวบท */
  function load(k, d){ return MWStore.get(k, d); } /* store.js: IndexedDB + แคช */
  function save(k, v){ return MWStore.set(k, v); }

  /* ---------- ตั้งค่า (mw_ai_cfg_v1) ----------
     model = ตัวเขียนบท (State 2) · eye = ตัวดูคลิป (State 1) · prompts = [{id,name,text}] · sel = prompt ที่เลือกไว้
     A/B เก็บสำเนาไว้ด้วย เผื่อย้อนกลับไปโค้ดเก่าแล้ว prompt ไม่หาย */
  var cfg = Object.assign({ model:DEFAULT_MODEL, think:"medium", A:"", B:"" }, load(CFG, {}));
  if(cfg.model.indexOf("/") < 0) cfg.model = DEFAULT_MODEL; /* ชื่อโมเดลเก่าแบบ Gemini ตรง (ไม่มี "ค่าย/") OpenRouter ไม่รู้จัก */
  if(!cfg.eye) cfg.eye = /^google\//.test(cfg.model) ? cfg.model : DEFAULT_MODEL;
  if(!Array.isArray(cfg.prompts)){ /* ย้ายจาก A/B เดิม */
    cfg.prompts = [{ id:"A", name:"A · ยึดโครงต้นฉบับ", text:cfg.A || "" }, { id:"B", name:"B · เรียบเรียงใหม่", text:cfg.B || "" }];
  }
  if(!cfg.prompts.length) cfg.prompts.push({ id:newId(), name:"Prompt ใหม่", text:"" });
  if(!Array.isArray(cfg.sel)) cfg.sel = [];
  cfg.sel = cfg.sel.filter(function(id){ return prompt(id); });
  if(!cfg.sel.length) cfg.sel = [cfg.prompts[0].id];
  function newId(){ return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function prompt(id){ return cfg.prompts.find(function(p){ return p.id === id; }); }
  function saveCfg(){
    ["A","B"].forEach(function(k){ var p = prompt(k); if(p) cfg[k] = p.text; });
    return save(CFG, cfg);
  }

  /* ---------- ประวัติบท (mw_history_v1) ----------
     ต่อคลิป 1 รายการ: { id, clip, at, trans, active, vers:[{ pid, pname, eye, writer, chat, s1Len, s1, s2, at }] } */
  var HIST = "mw_history_v1", HIST_MAX = 30;
  function normHist(h){ /* รายการแบบเก่า (เวอร์ชันเดียว) → แบบมีหลายเวอร์ชัน */
    if(!h || !h.id || !h.clip) return null;
    if(Array.isArray(h.vers)) return h;
    var p = prompt(h.p);
    return { id:h.id, clip:h.clip, at:h.at || 0, trans:h.trans || "", active:0,
             vers:[{ pid:h.p || "A", pname:p ? p.name : "Prompt " + (h.p || "A"), eye:h.model, writer:h.model,
                     chat:h.chat || [], s1Len:h.s1Len || 0, s1:h.s1 || "", s2:h.s2 || "", at:h.at || 0 }] };
  }
  var hist = load(HIST, []).map(normHist).filter(Boolean);
  function findHist(id){ return hist.find(function(h){ return h.id === id; }); }
  function saveHist(c){
    var vs = c.vers.filter(function(v){ return v.s1Len; });
    if(!vs.length) return;
    var e = { id:c.clip.id, clip:c.clip, at:Date.now(), trans:c.trans, active:Math.max(0, vs.indexOf(c.vers[c.active])),
              vers: vs.map(function(v){ return { pid:v.pid, pname:v.pname, eye:v.eye, writer:v.writer, chat:v.chat, s1Len:v.s1Len, s1:v.s1, s2:v.s2, orig:v.orig || "", hist:v.hist || [], hi:v.hi || 0, cost:v.cost || 0, free:v.free || 0, at:v.at }; }) };
    hist = [e].concat(hist.filter(function(h){ return h.id !== e.id; })).slice(0, HIST_MAX);
    if(!save(HIST, hist)) MW.toast("พื้นที่เก็บเต็ม บันทึกประวัติไม่ได้", true);
    renderHistCount();
  }
  /* ให้ไฟล์สำรอง (app.js) อ่าน/รวมประวัติได้ */
  MW.history = {
    all: function(){ return hist; },
    merge: function(arr){ /* รวมตาม id เก็บอันที่ใหม่กว่า */
      var byId = {}; hist.concat(arr.map(normHist)).forEach(function(h){ if(h && (!byId[h.id] || (h.at||0) > (byId[h.id].at||0))) byId[h.id] = h; });
      hist = Object.keys(byId).map(function(k){ return byId[k]; }).sort(function(x,y){ return (y.at||0) - (x.at||0); }).slice(0, HIST_MAX);
      save(HIST, hist); renderHistCount();
    }
  };
  function renderHistCount(){ $("histCount").textContent = hist.length; $("histCount").hidden = !hist.length; }

  function note(el, text, err){ $(el).innerHTML = text ? '<div class="msg'+(err?' err':'')+'">'+esc(text)+'</div>' : ""; }

  function callAI(messages, system, model, v, free){ return L.call(messages, system, model, { think: cfg.think, v: v, free: !!free }); } /* free = งานเล็กข้อความล้วน ลอง Gemini ฟรีก่อน */
  function promptText(v){
    var p = prompt(v.pid);
    if(!p || !p.text.trim()) throw new Error("prompt \"" + v.pname + "\" ว่างอยู่ (แท็บตั้งค่า)");
    return p.text;
  }
  function sourceFor(c, model){
    var t = c.trans.trim();
    if(t) return t;
    if(isGoogle(model)) return [{ type:"video_url", video_url:{ url: "https://www.youtube.com/watch?v=" + c.clip.id } }, { type:"text", text: "https://www.youtube.com/shorts/" + c.clip.id }];
    /* โมเดลค่ายอื่นรับ YouTube video_url ตรงๆ ไม่ได้ ส่งลิงก์เป็นข้อความธรรมดากัน API error */
    return "ลิงก์วิดีโอ YouTube: https://www.youtube.com/watch?v=" + c.clip.id + "\n(โมเดลนี้เปิดดูวิดีโอจากลิงก์โดยตรงไม่ได้ และไม่มีทรานสคริปต์แนบมา)";
  }
  function srcHint(err){ return err.message + (err.status === 400 || /video|URL|youtube/i.test(err.message) ? " · ถ้าดึงจากลิงก์ไม่ได้ ลองวางทรานสคริปต์แทน" : ""); }
  /* บทสนทนาจนถึง State 1 (ใช้ State 1 ที่แก้ในจอ) */
  function chatS1(v){ var ch = v.chat.slice(0, v.s1Len); ch[v.s1Len - 1] = { role:"assistant", content: v.s1 }; return ch; }

  /* ---------- งานของคลิปที่เปิดอยู่ ----------
     cur = { clip, trans, active, vers:[...] } — งานที่ยังวิ่งอยู่ผูกกับ cur ของคลิปนั้นเสมอ สลับคลิประหว่างรอก็ไม่ปนกัน */
  var cur = null;
  function loadCur(clip){
    var h = findHist(clip.id);
    return h ? { clip:h.clip, trans:h.trans || "", active:h.active || 0, vers:h.vers.map(function(v){ return Object.assign({ busy:false, step:"", err:"" }, v); }) }
             : { clip:{ id:clip.id, title:clip.title, channel:clip.channel, views:clip.views, published:clip.published, score:clip.score }, trans:"", active:0, vers:[] };
  }
  function activeV(){ return cur && cur.vers[cur.active]; }
  function running(c){ return c.vers.some(function(v){ return v.busy; }); }
  function paint(c, v){ if(c !== cur) return; renderRun(); if(v === activeV()) renderVersion(); }
  function finishMade(c){
    if(!c.vers.some(function(v){ return v.s2; })) return;
    MW.data.made[c.clip.id] = true; MW.persist(); MW.onMadeChange();
    if(c === cur) $("sMeta").textContent = (c.clip.channel || "") + " · เคยทำแล้ว";
  }

  async function step(c, v, label, fn){
    v.busy = true; v.step = label; v.err = ""; paint(c, v);
    try{ await fn(); v.at = Date.now(); saveHist(c); }
    catch(err){ v.err = srcHint(err); }
    v.busy = false; v.step = ""; paint(c, v);
  }
  /* ทำครบ: ดูคลิป → เขียนบท */
  function runFull(c, v){
    return step(c, v, "กำลังดูคลิป...", async function(){
      var sys = promptText(v);
      var ch = [{ role:"user", content: sourceFor(c, v.eye) }];
      v.s1 = await callAI(ch, sys, v.eye, v);
      v.chat = ch.concat([{ role:"assistant", content: v.s1 }]); v.s1Len = v.chat.length;
      saveHist(c); v.step = "กำลังเขียนบท..."; paint(c, v);
      v.s2 = await callAI(chatS1(v).concat([{ role:"user", content:"รัน" }]), sys, v.writer, v); tidy(v); startHist(v);
    });
  }

  $("goBtn").addEventListener("click", async function(){
    var c = cur; if(!c || running(c)) return;
    var vs = cfg.sel.map(function(pid){
      var p = prompt(pid), v = c.vers.find(function(x){ return x.pid === pid; });
      if(!v){ v = { pid:pid }; c.vers.push(v); }
      return Object.assign(v, { pname:p.name, eye:cfg.eye, writer:cfg.model, chat:[], s1Len:0, s1:"", s2:"", orig:"", hist:[], hi:0, cost:0, free:0, busy:false, step:"", err:"" });
    });
    c.active = c.vers.indexOf(vs[0]); renderVersion();
    await Promise.all(vs.map(function(v){ return runFull(c, v); }));
    finishMade(c);
  });

  /* ---------- หน้า ---------- */
  function renderChips(){
    $("pChips").innerHTML = cfg.prompts.map(function(p){
      return '<button class="fchip'+(cfg.sel.indexOf(p.id) >= 0 ? ' on' : '')+'" data-pid="'+esc(p.id)+'">'+esc(p.name)+'</button>';
    }).join("");
  }
  $("pChips").addEventListener("click", function(e){
    var b = e.target.closest("button[data-pid]"); if(!b) return;
    var id = b.dataset.pid, i = cfg.sel.indexOf(id);
    if(i >= 0){ if(cfg.sel.length > 1) cfg.sel.splice(i, 1); else MW.toast("ต้องเลือกอย่างน้อย 1 prompt", true); }
    else cfg.sel.push(id);
    saveCfg(); renderChips(); renderRun();
  });

  /* ปุ่ม/แท็บเวอร์ชัน/สถานะ (ไม่แตะช่องพิมพ์ จะได้ไม่ทับตอนกำลังแก้) */
  function renderRun(){
    if(!cur) return;
    var n = cfg.sel.length, busy = running(cur);
    $("goBtn").disabled = busy;
    $("goBtn").textContent = busy ? "กำลังทำบท..." : cur.vers.length ? (n > 1 ? "ทำใหม่ " + n + " เวอร์ชัน" : "ทำบทใหม่") : (n > 1 ? "ทำบท " + n + " เวอร์ชัน" : "ทำบทเลย");
    $("vWrap").hidden = !cur.vers.length;
    $("vTabs").innerHTML = cur.vers.length < 2 ? "" : cur.vers.map(function(v, i){
      var ic = v.busy ? MWIcon("clock") : v.err ? MWIcon("warn") : v.s2 ? MWIcon("check") : "";
      return '<button class="fchip'+(i === cur.active ? ' on' : '')+'" data-v="'+i+'">'+ic+esc(v.pname)+'</button>';
    }).join("");
    var v = activeV();
    if(!v) return;
    $("vStatus").innerHTML = v.busy ? '<div class="msg">'+esc(v.step)+'</div>' : v.err ? '<div class="msg err">'+esc(v.err)+'</div>' : "";
    ["s1FbBtn","s1Run","s2FbBtn"].forEach(function(id){ $(id).disabled = v.busy || !v.s1Len; });
    $("s2Wrap").hidden = !v.s2;
    renderUndo(v);
    $("vBody").hidden = !v.s2; $("vNo").hidden = !!v.s2;
    $("vMsg").innerHTML = $("vStatus").innerHTML; /* แก้บทด้วย AI จากหน้าเสียงก็เห็นสถานะ */
    $("vText").readOnly = v.busy;
  }
  /* เนื้อหาของเวอร์ชันที่เปิดอยู่ลงช่องพิมพ์ */
  function renderVersion(){
    var v = activeV(); if(!v) return;
    $("s1Out").value = v.s1 || "";
    $("s1Info").textContent = "ตัวดูคลิป: " + short(v.eye) + " · ตัวเขียนบท: " + short(v.writer);
    $("s1Fold").hidden = !v.s1Len;
    var p = parts(v.s2 || "");
    renderP1(p.title);
    $("s2View").textContent = v.orig ? parts(v.orig).script : p.script; /* หน้าบทโชว์ต้นฉบับที่ AI เขียน แก้ในหน้าเสียงไม่เปลี่ยนตรงนี้ */
    $("vText").value = p.script; fit();
    $("vClip").textContent = cur.clip.title;
    $("vVer").textContent = v.pname + " · เขียนโดย " + short(v.writer);
    renderCount(); renderRun();
  }
  $("vTabs").addEventListener("click", function(e){
    var b = e.target.closest("button[data-v]"); if(!b || !cur) return;
    cur.active = +b.dataset.v; renderVersion();
  });

  function refresh(){
    var c = MW.data.picked;
    $("sNoClip").hidden = !!c; $("sBody").hidden = !c;
    renderChips(); updateModelLine();
    if(!c){ $("vBody").hidden = true; $("vNo").hidden = false; return; }
    $("sTitle").textContent = c.title;
    $("sMeta").textContent = (c.channel || "") + (MW.data.made[c.id] ? " · เคยทำแล้ว" : "");
    if(!cur || cur.clip.id !== c.id){
      cur = loadCur(c); /* เคยทำคลิปนี้ไว้ → โหลดกลับมาให้ต่อได้เลย */
      $("sTrans").value = cur.trans; $("transFold").open = !!cur.trans;
      renderVersion(); renderRun();
    }
  }
  document.addEventListener("mw:tab", function(e){ $("histBtn").hidden = e.detail !== "script"; if(e.detail === "script" || e.detail === "voice") refresh(); }); /* ปุ่มประวัติโชว์เฉพาะแท็บบท */

  /* ---------- แก้เอง / สั่งแก้ ---------- */
  $("sTrans").addEventListener("input", function(){ if(cur) cur.trans = this.value; });
  $("s1Out").addEventListener("input", function(){ var v = activeV(); if(v) v.s1 = this.value; });
  /* กล่องบทในหน้าเสียงสูงตามเนื้อหา (หน้าเลื่อนยาวแบบ ElevenLabs ไม่มีกล่องเลื่อนซ้อน) — วัดได้เมื่อแท็บเสียงแสดงอยู่เท่านั้น */
  function fit(){ var t = $("vText"); t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  document.addEventListener("mw:tab", function(e){ if(e.detail === "voice") fit(); });
  /* แก้บทในหน้าเสียง = แก้เฉพาะ PART 2 ของเวอร์ชันที่เปิดอยู่ (PART 1 คงเดิม) */
  $("vText").addEventListener("input", function(){
    var v = activeV(); if(!v) return;
    ensureHist(v); setScript(v, this.value); fit(); renderCount(); renderUndo(v);
  });
  $("vText").addEventListener("change", function(){ var v = activeV(); if(v){ commit(v); renderUndo(v); } }); /* พิมพ์แก้เสร็จ (แตะออกจากช่อง) = หนึ่งขั้นให้ย้อนได้ */
  ["s1Out","vText","sTrans"].forEach(function(id){ $(id).addEventListener("change", function(){ if(cur) saveHist(cur); }); }); /* แก้เองแล้วเก็บให้ด้วย */

  $("s1FbBtn").addEventListener("click", function(){
    var c = cur, v = activeV(), fb = $("s1Fb").value.trim(); if(!v || !fb || !v.s1Len) return;
    $("s1Fb").value = "";
    step(c, v, "กำลังปรับ State 1...", async function(){
      var next = chatS1(v).concat([{ role:"user", content: fb }]);
      v.s1 = await callAI(next, promptText(v), v.eye, v);
      v.chat = next.concat([{ role:"assistant", content: v.s1 }]); v.s1Len = v.chat.length;
    });
  });
  $("s1Run").addEventListener("click", function(){
    var c = cur, v = activeV(); if(!v || !v.s1Len) return;
    v.writer = cfg.model; /* เขียนใหม่ด้วยตัวเขียนบทที่ตั้งไว้ตอนนี้ */
    step(c, v, "กำลังเขียนบท...", async function(){
      v.s2 = await callAI(chatS1(v).concat([{ role:"user", content:"รัน" }]), promptText(v), v.writer, v); tidy(v); startHist(v);
    }).then(function(){ finishMade(c); });
  });
  /* แก้บท: ทุกขั้นเก็บใน v.hist ให้ย้อนกลับ/ไปข้างหน้าได้ (v.hist[0] = ต้นฉบับ) */
  var QUICK = { short:"ตัดให้สั้นลงประมาณ 20% โดยคงใจความและมุกสำคัญไว้", long:"ขยายให้ยาวขึ้นเล็กน้อย เพิ่มรายละเอียดและจังหวะให้เนื้อเรื่องเต็มขึ้น",
                punch:"ปรับให้แรงขึ้น เปิดประโยคแรกให้ดึงดูด จังหวะกระชับ ตัดคำฟุ่มเฟือย", funny:"ปรับให้ตลกขึ้น เพิ่มมุกและจังหวะ punchline ให้ชัด" };
  function editScript(fb){
    var c = cur, v = activeV(), txt = v ? parts(v.s2 || "").script : ""; if(!v || v.busy || !fb || !txt) return;
    step(c, v, "กำลังแก้บท...", async function(){
      var out = await callAI([{ role:"user", content: "แก้บทพากย์ด้านล่างตามคำสั่ง แล้วตอบกลับมาเฉพาะบทพากย์ฉบับแก้ทั้งหมด ไม่ต้องมีหัวข้อ ชื่อคลิป หรือคำอธิบายเพิ่ม\nคงการเว้นบรรทัดว่างคั่นท่อนแบบเดิม ภายในท่อนให้เขียนต่อเนื่องเป็นบรรทัดเดียว ห้ามขึ้นบรรทัดใหม่กลางประโยค\n\nคำสั่ง: " + fb + "\n\n----\n" + txt }], "", v.writer, v, true);
      commit(v); setScript(v, reflow(parts(out).script)); commit(v);
    });
  }
  $("s2FbBtn").addEventListener("click", function(){ var fb = $("s2Fb").value.trim(); if(!fb) return; $("s2Fb").value = ""; editScript(fb); });
  $("quickFb").addEventListener("click", function(e){
    var b = e.target.closest("button[data-q]"); if(!b) return;
    if(b.dataset.q !== "lines") return editScript(QUICK[b.dataset.q]);
    var v = activeV(); if(!v || v.busy || !v.s2) return; /* จัดบรรทัดด้วยโค้ด ฟรี ไม่เรียก AI */
    commit(v); tidy(v); commit(v); saveHist(cur); renderVersion();
  });
  /* ย้อนกลับ/ไปข้างหน้า: v.hist = บททุกขั้น (ตัวแรก = ต้นฉบับที่ AI เขียน) · v.hi = ขั้นที่ใช้อยู่ · ขั้นใหม่ = AI แก้หนึ่งครั้ง หรือพิมพ์แก้เองแล้วแตะออกจากช่อง */
  var HIST_STEPS = 20;
  function startHist(v){ v.orig = v.s2; v.hist = [v.s2]; v.hi = 0; } /* AI เขียนบทใหม่ = เริ่มประวัติใหม่ */
  function ensureHist(v){ /* บทเก่าที่ยังไม่มีประวัติ: ถือบทตอนนี้เป็นต้นฉบับ */
    if(!v.hist || !v.hist.length){ if(!v.orig) v.orig = v.s2; v.hist = [v.orig]; v.hi = 0; }
    if(!v.orig) v.orig = v.hist[0];
  }
  function commit(v){ /* บทตอนนี้ต่างจากขั้นที่ใช้อยู่ → ตัดขั้นข้างหน้าทิ้ง แล้วเพิ่มเป็นขั้นใหม่ */
    ensureHist(v);
    if(v.s2 === v.hist[v.hi]) return;
    v.hist = v.hist.slice(0, v.hi + 1); v.hist.push(v.s2);
    if(v.hist.length > HIST_STEPS + 1) v.hist.splice(1, 1); /* เกินแล้วทิ้งขั้นเก่าสุด เก็บต้นฉบับไว้เสมอ */
    v.hi = v.hist.length - 1;
  }
  function renderUndo(v){
    var n = v && v.hist ? v.hist.length : 0, dirty = !!(v && v.s2 && v.hist && v.hist.length && v.s2 !== v.hist[v.hi]); /* ยังพิมพ์ค้าง = ย้อนได้ทันที */
    $("s2Back").disabled = !v || v.busy || !(v.hi > 0 || dirty);
    $("s2Fwd").disabled = !v || v.busy || !(n && v.hi < n - 1 && !dirty);
  }
  function stepHist(d){
    var v = activeV(); if(!v || v.busy) return;
    commit(v); var i = v.hi + d; if(i < 0 || i >= v.hist.length) return;
    v.hi = i; v.s2 = v.hist[i]; saveHist(cur); renderVersion();
  }
  $("s2Back").addEventListener("click", function(){ stepHist(-1); });
  $("s2Fwd").addEventListener("click", function(){ stepHist(1); });

  /* ---------- แยกชื่อคลิป (PART 1) กับบท (PART 2) ---------- */
  function parts(t){
    var m2 = /^[^\n]*PART\s*2[^\n]*$/im.exec(t);
    if(!m2) return { head:"", title:"", script:t.trim() };
    var m1 = /^[^\n]*PART\s*1[^\n]*$/im.exec(t.slice(0, m2.index));
    return { head: t.slice(0, m2.index + m2[0].length), title: m1 ? t.slice(m1.index + m1[0].length, m2.index).trim() : "", script: t.slice(m2.index + m2[0].length).trim() };
  }
  /* จัดรูปแบบบทด้วยโค้ด (ไม่พึ่ง AI): ภายในท่อนเดียวกันรวมเป็นบรรทัดต่อเนื่อง ไม่ตัดตามความกว้างจอ (ให้จอตัดบรรทัดให้เอง เหมือน ElevenLabs)
     ขึ้นบรรทัดจริงเฉพาะที่เว้นบรรทัดว่างคั่นท่อน · ทุกขึ้นบรรทัดในช่องบทถูกส่งไปเจนเสียงเป็นจังหวะหยุด จึงห้ามมีบรรทัดที่ตัดเพราะความกว้าง */
  function reflow(text){
    return text.split(/\n[ \t]*\n/).map(function(p){
      return p.split("\n").map(function(l){ return l.trim(); }).filter(Boolean).join(" ");
    }).filter(Boolean).join("\n\n");
  }
  function tidy(v){ setScript(v, reflow(parts(v.s2 || "").script)); } /* ใช้หลังทุกครั้งที่ AI ส่งบทมา */
  function setScript(v, script){ var h = parts(v.s2 || "").head; v.s2 = h ? h + "\n" + script : script; }
  /* PART 1 → ชื่อคลิป 3 อัน + ข้อความบนจอ (อ่านจากรูปแบบที่ prompt สร้าง ถ้าอ่านไม่ออกจะโชว์ข้อความดิบ) */
  var pk = { titles:[], hook:"" };
  function clean(s){ return s.replace(/^["“'*\s]+|["”'*\s]+$/g, ""); }
  function packaging(t){
    var out = { titles:[], hook:"" }, hook = [], inHook = false;
    t.split("\n").map(function(l){ return l.trim(); }).filter(Boolean).forEach(function(l){
      var after = clean(l.split(/[:：]/).slice(1).join(":"));
      if(/hook\s*text|ข้อความบนจอ/i.test(l)){ inHook = true; if(after) hook.push(after); return; }
      if(/video\s*titles?|ชื่อคลิป/i.test(l)){ inHook = false; return; }
      var m = /^(?:\d+[.)]|[-•*])\s*(.+)$/.exec(l), s = clean(m ? m[1] : l);
      if(!s) return;
      if(inHook) hook.push(s); else if(m) out.titles.push(s);
    });
    out.hook = hook.join(" ");
    return out;
  }
  function renderP1(t){
    pk = packaging(t);
    var row = function(k, i, s){ return '<button class="p1row" data-k="'+k+'" data-i="'+i+'"><span>'+esc(s)+'</span><em>คัดลอก</em></button>'; };
    $("p1Card").innerHTML = pk.titles.length || pk.hook
      ? (pk.titles.length ? '<div class="p1lab">ชื่อคลิป</div>' + pk.titles.map(function(s, i){ return row("t", i, s); }).join("") : "")
        + (pk.hook ? '<div class="p1lab">ข้อความบนจอ</div>' + row("h", 0, pk.hook) : "")
      : '<div class="p1raw">' + esc(t || "บทนี้ไม่มีส่วน PART 1") + '</div>';
  }
  $("p1Card").addEventListener("click", function(e){
    var b = e.target.closest("button.p1row"); if(!b) return;
    var txt = b.dataset.k === "h" ? pk.hook : pk.titles[+b.dataset.i];
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function(){
      MW.toast("คัดลอกแล้ว"); b.classList.add("done"); b.querySelector("em").innerHTML = MWIcon("check") + "คัดลอกแล้ว";
      setTimeout(function(){ b.classList.remove("done"); b.querySelector("em").textContent = "คัดลอก"; }, 1500);
    }).catch(function(){ MWDialog.copy(txt); });
  });
  $("toVoice").addEventListener("click", function(){ MW.showTab("voice"); });
  function renderCount(){
    var v = activeV(), s = v ? parts(v.s2 || "").script : "", n = s.replace(/\s/g, "").length;
    $("s2Count").textContent = n ? "บท " + n.toLocaleString() + " ตัวอักษร · พากย์ประมาณ " + Math.round(n / CHARS_PER_SEC) + " วิ" + (v && v.cost ? " · ค่าใช้จ่ายเวอร์ชันนี้ " + money(v.cost) : v && v.free ? " · ฟรี (Gemini)" : "") : "";
    document.dispatchEvent(new CustomEvent("mw:script")); /* บทในหน้าเสียงเปลี่ยน → tts.js อัปเดตปุ่มสร้างเสียง */
  }
  function copy(btn, txt, idle){
    if(!txt){ MW.toast("ยังไม่มีบทให้คัดลอก", true); return; }
    var done = function(){ btn.textContent = "คัดลอกแล้ว"; setTimeout(function(){ btn.textContent = idle; }, 1500); };
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(done).catch(function(){ MWDialog.copy(txt); });
  }
  $("copyBtn").addEventListener("click", function(){ copy(this, $("vText").value.trim(), "คัดลอกบท"); });

  /* ---------- ตั้งค่า AI ---------- */
  function pickModel(selId, val, fallback){ $(selId).value = val; if($(selId).value !== val){ $(selId).value = fallback; return fallback; } return val; } /* โมเดลที่เซฟไว้แต่ไม่อยู่ในรายการ → ค่าเริ่มต้น */
  var GR_KEY = "mw_groq_key_v1"; /* Groq ใช้ในหน้าซับจอเขียว (sub/) อย่างเดียว */
  $("gKey").value = load(OR_KEY, ""); $("gmKey").value = load(GM_KEY, ""); $("grKey").value = load(GR_KEY, "");
  $("gmOn").checked = cfg.gem !== false; L.setOn($("gmOn").checked); /* ติ๊ก "ใช้ Gemini ฟรี" เก็บใน mw_ai_cfg_v1 (gem) */
  cfg.model = pickModel("gModel", cfg.model, DEFAULT_MODEL);
  cfg.eye = pickModel("gEye", cfg.eye, DEFAULT_MODEL);
  $("gThink").value = cfg.think;
  var THINK_TH = { low:"ต่ำสุด", medium:"ปานกลาง", high:"สูงสุด" };
  function updateModelLine(){ $("sModel").textContent = "ดูคลิป: " + short(cfg.eye) + " · เขียนบท: " + short(cfg.model) + " · คิด" + (THINK_TH[cfg.think] || cfg.think); }
  function orState(){
    [["gKey","gState"],["gmKey","gmState"],["grKey","grState"]].forEach(function(x){
      var on = !!$(x[0]).value.trim(); $(x[1]).innerHTML = on ? MWIcon("check") + "ตั้งแล้ว" : "ยังไม่ได้ตั้ง"; $(x[1]).classList.toggle("ok", on);
    });
  }
  orState();
  function saveAi(){
    cfg.gem = $("gmOn").checked; L.setOn(cfg.gem);
    cfg.model = $("gModel").value || DEFAULT_MODEL; cfg.eye = $("gEye").value || DEFAULT_MODEL; cfg.think = $("gThink").value;
    var ok = saveCfg() && save(OR_KEY, $("gKey").value.trim()) && save(GM_KEY, $("gmKey").value.trim()) && save(GR_KEY, $("grKey").value.trim());
    MW.toast(ok ? "บันทึกแล้ว" : "บันทึกไม่ได้", !ok);
    updateModelLine(); orState();
  }
  ["gKey","gmKey","grKey","gmOn","gModel","gEye","gThink"].forEach(function(id){ $(id).addEventListener("change", saveAi); }); /* บันทึกอัตโนมัติทุกครั้งที่แก้ */
  $("saveAi").addEventListener("click", saveAi);
  $("gmTest").addEventListener("click", async function(){
    var b = this; b.disabled = true; b.textContent = "กำลังทดสอบ...";
    var models = cfg.eye === cfg.model ? [cfg.eye] : [cfg.eye, cfg.model].filter(isGoogle);
    var lines = await L.test(models, cfg.think);
    $("gmTestOut").textContent = lines.join("\n"); b.disabled = false; b.textContent = "ทดสอบ Gemini";
  });

  /* ---------- สำรอง/นำเข้า (ให้ app.js เรียก) ไม่รวม key ---------- */
  function aiBackup(){ return { gem:cfg.gem !== false, model:cfg.model, eye:cfg.eye, think:cfg.think, prompts:cfg.prompts, sel:cfg.sel }; }
  function hasText(p){ return !!(p && p.text && p.text.trim()); }
  MW.aiCfg = {
    get: aiBackup,
    differs: function(o){ /* ของในเครื่องมีเนื้อหา และไม่เหมือนในไฟล์ → นำเข้าจะทับ */
      return cfg.prompts.some(hasText) && JSON.stringify(cfg.prompts) !== JSON.stringify(o && o.prompts);
    },
    set: function(o){
      if(!o || typeof o !== "object") return;
      if(Array.isArray(o.prompts)){
        var seen = {}, ps = o.prompts.filter(function(p){ return p && typeof p.id === "string" && p.id && !seen[p.id] && (seen[p.id] = 1); })
          .map(function(p){ return { id:p.id, name:String(p.name || "ไม่มีชื่อ"), text:String(p.text || "") }; });
        if(ps.length) cfg.prompts = ps;
      }
      cfg.sel = (Array.isArray(o.sel) ? o.sel : []).filter(function(id){ return prompt(id); });
      if(!cfg.sel.length) cfg.sel = [cfg.prompts[0].id];
      var has = function(selId, v){ return typeof v === "string" && Array.prototype.some.call($(selId).options, function(x){ return x.value === v; }); };
      if(has("gModel", o.model)) cfg.model = o.model;
      if(has("gEye", o.eye)) cfg.eye = o.eye;
      if(has("gThink", o.think)) cfg.think = o.think;
      if(typeof o.gem === "boolean"){ cfg.gem = o.gem; $("gmOn").checked = o.gem; L.setOn(o.gem); }
      saveCfg();
      $("gModel").value = cfg.model; $("gEye").value = cfg.eye; $("gThink").value = cfg.think; MW.syncSelects();
      renderPrompts(); renderChips(); updateModelLine();
    }
  };

  /* ---------- รายการ prompt (เพิ่ม/ตั้งชื่อ/ทำสำเนา/ลบ) ---------- */
  function promptState(p){ var n = p.text.trim().length; return n ? n.toLocaleString() + " ตัวอักษร" : "ว่าง"; }
  function renderPrompts(openId){
    $("promptList").innerHTML = cfg.prompts.map(function(p){
      var id = esc(p.id);
      return '<details class="fold" data-fold="'+id+'"'+(p.id === openId ? ' open' : '')+'><summary><span>'+esc(p.name)+'</span><em class="state'+(p.text.trim() ? ' ok' : '')+'">'+promptState(p)+'</em></summary><div class="fbody">'
        + '<label for="pn_'+id+'" style="margin-top:0">ชื่อ</label><input id="pn_'+id+'" data-pname="'+id+'" value="'+esc(p.name)+'" autocomplete="off">'
        + '<div class="ftools" style="margin-top:12px"><button type="button" class="btn small ghost" data-paste="pt_'+id+'">วาง</button><button type="button" class="rowmore" data-pmore aria-label="เมนู prompt นี้">'+MWIcon("more")+'</button></div>'
        + '<textarea id="pt_'+id+'" data-ptext="'+id+'" rows="14" placeholder="วาง prompt ทั้งก้อนที่นี่" aria-label="ข้อความ prompt">'+esc(p.text)+'</textarea>'
        + '<div class="fmenu"><button type="button" class="btn small ghost" data-clear="pt_'+id+'">ล้างข้อความ</button><button type="button" class="btn small ghost" data-pdup="'+id+'">ทำสำเนา</button><button type="button" class="btn small ghost" data-pdel="'+id+'">ลบ prompt นี้</button></div>'
        + '</div></details>';
    }).join("");
  }
  $("promptList").addEventListener("change", function(e){
    var t = e.target, p;
    if(t.dataset.pname && (p = prompt(t.dataset.pname))){
      p.name = t.value.trim() || "ไม่มีชื่อ";
      t.closest("details").querySelector("summary span").textContent = p.name;
    }else if(t.dataset.ptext && (p = prompt(t.dataset.ptext))){
      p.text = t.value;
      var st = t.closest("details").querySelector("summary .state"); st.textContent = promptState(p); st.classList.toggle("ok", !!p.text.trim());
    }else return;
    var ok = saveCfg(); MW.toast(ok ? "บันทึกแล้ว" : "บันทึกไม่ได้", !ok); renderChips();
  });
  $("promptList").addEventListener("click", function(e){
    var mo = e.target.closest("[data-pmore]"); if(mo){ mo.closest(".fbody").classList.toggle("mopen"); return; } /* ล้าง/สำเนา/ลบ ซ่อนไว้ แตะสามจุดถึงโผล่ */
    var b = e.target.closest("button[data-pdup], button[data-pdel]"); if(!b) return;
    if(b.dataset.pdup){
      var src = prompt(b.dataset.pdup), cp = { id:newId(), name:src.name + " (สำเนา)", text:src.text };
      cfg.prompts.splice(cfg.prompts.indexOf(src) + 1, 0, cp); saveCfg(); renderPrompts(cp.id); renderChips(); MW.toast("ทำสำเนาแล้ว");
      return;
    }
    if(cfg.prompts.length < 2){ MW.toast("ต้องมีอย่างน้อย 1 prompt", true); return; }
    MW.confirmTap(b, "ลบ prompt นี้", function(){
      cfg.prompts = cfg.prompts.filter(function(p){ return p.id !== b.dataset.pdel; });
      cfg.sel = cfg.sel.filter(function(id){ return prompt(id); }); if(!cfg.sel.length) cfg.sel = [cfg.prompts[0].id];
      saveCfg(); renderPrompts(); renderChips(); MW.toast("ลบ prompt แล้ว");
    });
  });
  $("addPrompt").addEventListener("click", function(){
    var p = { id:newId(), name:"Prompt ใหม่", text:"" };
    cfg.prompts.push(p); saveCfg(); renderPrompts(p.id); renderChips();
    var inp = $("pn_" + p.id); inp.focus(); inp.select();
  });

  /* ---------- ปุ่มประวัติ (มุมขวาบน) ---------- */
  function histMeta(h){
    return [h.clip.channel, MW.ago(new Date(h.at).toISOString()), h.vers.map(function(v){ return v.pname; }).join(", "), short(h.vers[0] && h.vers[0].writer)].filter(Boolean).join(" · ");
  }
  function renderHist(){
    $("histList").innerHTML = hist.length ? hist.map(function(h){
      var done = h.vers.filter(function(v){ return v.s2; }).length;
      return '<div class="hrow"><div class="hopen"><button class="hthumb" data-play="'+esc(h.id)+'" aria-label="ดูวิดีโอ"><img loading="lazy" alt="" src="'+MW.thumbUrl(h.id)+'"><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></i></button>' /* แตะรูป = ดูวิดีโอในแอพ · แตะข้อความ = เปิดบท */
        + '<button class="hmain" data-open="'+esc(h.id)+'"><span class="ht"><b>'+esc(h.clip.title)+'</b><small>'+esc(histMeta(h))+'</small></span>'
        + '<span class="htags"><span class="sel-tag">'+(done ? "บทเสร็จ" + (done > 1 ? " ×" + done : "") : "State 1")+'</span><span class="sel-tag vo" data-vo="'+esc(h.id)+'" hidden></span></span></button>'
        + '<button class="hmore" data-more="'+esc(h.id)+'" aria-label="เมนูรายการนี้">'+MWIcon("more")+'</button></div>'
        + '<button class="btn small ghost hdel" data-del="'+esc(h.id)+'">ลบรายการนี้</button></div>';
    }).join("") : '<div class="empty"><div class="empty-ico">'+MWIcon("clock")+'</div>ยังไม่มีประวัติ ทำบทแล้วจะมาอยู่ตรงนี้</div>';
    $("histClear").hidden = !hist.length;
    markVoiced();
  }
  async function markVoiced(){ /* ป้าย "มีเสียง" ต่อรายการ: เวอร์ชันของบทที่ข้อความตรงกับเสียงที่เก็บไว้ (MWVoice) */
    var vs = []; try{ if(window.MWVoice) vs = await MWVoice.list(); }catch(err){}
    var norm = function(s){ return String(s || "").replace(/\s+/g, ""); }, el = $("histList");
    hist.forEach(function(h){
      var tag = el.querySelector('[data-vo="' + h.id + '"]'); if(!tag) return;
      var n = h.vers.filter(function(v){ var t = norm(parts(v.s2 || "").script); return t && vs.some(function(x){ var y = norm(x.text); return y && (y === t || y.indexOf(t) >= 0 || t.indexOf(y) >= 0); }); }).length;
      tag.hidden = !n; tag.innerHTML = MWIcon("speaker") + (h.vers.length > 1 ? "มีเสียง " + n + "/" + h.vers.length : "มีเสียง");
    });
  }
  $("histBtn").addEventListener("click", function(){ renderHist(); MW.openModal("histSheet"); });
  $("histClose").addEventListener("click", function(){ MW.closeModal("histSheet"); });
  $("histSheet").addEventListener("click", function(e){ if(e.target === this) MW.closeModal("histSheet"); });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape" && !$("histSheet").hidden) MW.closeModal("histSheet"); });
  $("histList").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    if(b.dataset.more){ /* ปุ่มลบซ่อนไว้ แตะสามจุดถึงโผล่ · เปิดได้ทีละรายการ แตะที่เดิมซ้ำ = ปิด */
      var row = b.closest(".hrow"), was = row.classList.contains("open");
      $("histList").querySelectorAll(".hrow.open").forEach(function(r){ r.classList.remove("open"); });
      if(!was) row.classList.add("open"); return;
    }
    if(b.dataset.play){ var ph = findHist(b.dataset.play); if(ph) MW.openPlayer(ph.clip); return; }
    if(b.dataset.open){
      var h = findHist(b.dataset.open); if(!h) return;
      MW.closeModal("histSheet");
      if(cur && cur.clip.id === h.id && !running(cur)) cur = null; /* โหลดจากประวัติใหม่ */
      MW.setPick(h.clip); MW.showTab("script");
    }
    if(b.dataset.del) MW.confirmTap(b, "ลบรายการนี้", function(){ hist = hist.filter(function(x){ return x.id !== b.dataset.del; }); save(HIST, hist); renderHist(); renderHistCount(); });
  });
  $("histClear").addEventListener("click", function(){
    var b = this; MW.confirmTap(b, "ล้างทั้งหมด", function(){ hist = []; save(HIST, hist); renderHist(); renderHistCount(); MW.toast("ล้างประวัติแล้ว"); });
  });

  if(!load(CFG, null) || !Array.isArray(load(CFG, {}).prompts)) saveCfg(); /* บันทึกรูปแบบใหม่ครั้งแรก */
  renderPrompts(); renderHistCount();
  refresh();
})();
