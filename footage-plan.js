/* footage-plan.js — แท็บ "ผู้กำกับ" 2 แบบ:
   long (ไปตัดเอง) = ช็อตละประโยค ตัดคลิปยาว LONG วิ (เผื่อเลือก) คั่นทุกช็อตด้วยจอเขียว + เสียงตื๊ด SEP วิ
   fast (AI ตัดให้) = สับไว ช็อตละวลี 1-3 วิ ต่อกันเลยไม่คั่น แบบคลิปตัวอย่างของช่อง · เลือกเสียงพากย์ (MWVoice จากแท็บเสียงของแอพหลัก) → ตัดภาพตามเวลาคำพูดจริง + ใส่เสียงให้ในไฟล์ ·
   ไม่เลือกเสียง = ประมาณความยาวช็อตจากจำนวนตัวอักษร (RATE ตัว/วิ)
   บท → AI แบ่งช็อต (FT.beats) → ผู้สมัครในดัชนีในเครื่อง → AI ดูรูปจริงแล้วเลือก (FT.direct) → ตารางช็อต (แตะสลับ/ติ๊กไม่ใช้) → วิดีโอไฟล์เดียว (FT.stitch) → บันทึกไป CapCut · ตารางล่าสุดเก็บที่ MWStore key mw_footage_direct_v1 (อ้างคลิปด้วย id + ลำดับฉาก ไม่เก็บรูป) */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U || !FT.stitch) return;
  var $ = function(id){ return document.getElementById(id); };
  var KEY = "mw_footage_direct_v1", CAND = 6, PER_CLIP = 2, CHUNK = 6, RATE = 13, MIN_DUR = 1, MAX_DUR = 10, LONG = 10, LEAD = 1, SEP = 2, MAX_CHARS = 3000;
  function load(k, d){ return MWStore.get(k, d); } /* store.js: IndexedDB + แคช */
  function save(k, v){ return MWStore.set(k, v); }
  var plan = load(KEY, null); /* { mode, at, cost, ms, script, shots:[{ t, want, chars, keys, shot, dur, cands:[{ id, si }], why, use }] } (cands[0] = ที่ใช้อยู่) */
  var say = function(t, k){ U.msg("plShareMsg", t, k); };
  function isLong(){ return !plan || plan.mode !== "fast"; }
  var MODES = [
    { k:"long", name:"แบบ 1: ไปตัดเอง", desc:"ช็อตละประโยค คลิปละ ≤10 วิ คั่นจอเขียว + ตื๊ด", icon:"scissors" },
    { k:"fast", name:"แบบ 2: AI ตัดให้", desc:"สับไว 1–3 วิ ตามวลี ต่อกันเลย", icon:"film" }
  ];
  var mode = plan && plan.mode === "fast" ? "fast" : "long";
  function fsel(id, text, empty, icon){ $(id).className = "fsel" + (empty ? " empty" : ""); $(id).innerHTML = (icon ? MWIcon(icon) : "") + "<span>" + U.esc(text) + "</span>" + MWIcon("chev"); } /* ช่องเลือกที่เปิดชีตของแอพ (ไม่ใช้ select ของเบราว์เซอร์) */
  function showMode(){ var m = MODES.find(function(x){ return x.k === mode; }); fsel("plModeBtn", m.name, false, m.icon); }
  function setMode(k){ mode = k; showMode(); refreshVoices(); }
  $("plModeBtn").addEventListener("click", function(){
    FT.pick.open({ title:"แบบการตัดต่อ", search:false, items:function(){ return MODES.map(function(m){ return { k:m.k, name:m.name, desc:m.desc, icon:m.icon, on:m.k === mode }; }); }, onPick:setMode });
  });
  showMode();

  /* ---------- เสียงพากย์ (เทคล่าสุดจากแท็บเสียงของแอพหลัก เก็บใน MWVoice) ---------- */
  function norm(s){ return String(s || "").replace(/\s+/g, ""); }
  var voices = [], cl = [], voiceSel = "";
  var matchText = function(t){ return function(v){ var x = norm(v.text); return t && x && (x === t || x.indexOf(t) >= 0 || t.indexOf(x) >= 0); }; };
  function showVoice(){
    var v = voices.find(function(x){ return String(x.id) === voiceSel; }), c = cl.find(function(x){ return String(x.id) === voiceSel; });
    fsel("plVoiceBtn", v ? (v.name || "เสียง") + " · " + new Date(v.id).toLocaleTimeString("th-TH", { hour:"2-digit", minute:"2-digit" }) : c ? "(ในคลัง) " + new Date(c.id).toLocaleString("th-TH", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "ไม่ใส่เสียง (ประมาณเวลาจากตัวอักษร)", !voiceSel, "speaker");
    $("plVoiceInfo").textContent = voices.length ? "" : "ยังไม่มีเสียง · สร้างเสียงในแอพหลัก (แท็บ เสียง) ก่อน แล้วกลับมาเลือกที่นี่";
  }
  function autoVoice(){ /* เสียงที่เลือกไว้ยังอยู่ก็คงไว้ ไม่งั้นเลือกเทคที่ตรงกับบทให้ */
    var m = voices.find(matchText(norm($("plText").value)));
    if(!voices.concat(cl).some(function(v){ return String(v.id) === voiceSel; })) voiceSel = m ? String(m.id) : "";
    showVoice();
  }
  async function refreshVoices(){
    var on = mode === "fast"; $("plVoiceRow").hidden = !on; if(!on || !window.MWVoice) return;
    try{ voices = await MWVoice.list(); }catch(err){ voices = []; }
    cl = []; if(MWVoice.cloudOn()){ try{ cl = (await MWVoice.cloudList()).filter(function(c){ return !voices.some(function(v){ return v.id === c.id; }); }); }catch(err){} } /* เสียงที่อยู่ในคลังแต่ยังไม่ได้ดึงมาเครื่องนี้ */
    autoVoice();
  }
  $("plVoiceBtn").addEventListener("click", function(){
    var t = norm($("plText").value), match = matchText(t), time = function(id){ return new Date(id).toLocaleTimeString("th-TH", { hour:"2-digit", minute:"2-digit" }); };
    FT.pick.open({ title:"เสียงพากย์", search:false, icon:"speaker", items:function(){ /* มีบทอยู่แล้ว = โชว์เฉพาะเสียงที่ตรงกับบทนั้น · แตะตัวที่เลือกอยู่ซ้ำ = ยกเลิก */
      return [{ k:"", name:"ไม่ใส่เสียง", desc:t ? "ประมาณเวลาจากตัวอักษร" : "ประมาณเวลาจากตัวอักษร · เลือกบทก่อนจะเห็นเฉพาะเสียงของบทนั้น", icon:"x", on:!voiceSel }]
        .concat(voices.filter(function(v){ return !t || match(v) || String(v.id) === voiceSel; }).map(function(v){ return { k:String(v.id), name:(v.name || "เสียง"), desc:time(v.id) + (v.align ? " · มีเวลาคำพูด" : " · ไม่มีเวลาคำพูด (ประมาณตามตัวอักษร)"), on:String(v.id) === voiceSel }; }))
        .concat(t ? [] : cl.map(function(c){ return { k:String(c.id), name:"(ในคลัง) " + new Date(c.id).toLocaleString("th-TH", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }), desc:"ดึงมาให้ตอนกำกับ", icon:"cloud", on:String(c.id) === voiceSel }; })); },
      onPick:function(k){ voiceSel = k === voiceSel ? "" : k; showVoice(); } });
  });
  /* เปิดจากปุ่ม "ตัดต่อภาพ" ในแอพหลัก (footage.html?voice=รหัสเทค): ไปแท็บผู้กำกับ โหมด AI ตัดให้ ใส่บทและเลือกเสียงของเทคนั้นให้ */
  var voiceQ = new URLSearchParams(location.search).get("voice");
  if(voiceQ && window.MWVoice) (async function(){
    history.replaceState(null, "", location.pathname);
    try{
      var rec = await MWVoice.get(+voiceQ) || await MWVoice.pull(+voiceQ);
      document.querySelector('nav button[data-p="plan"]').click();
      mode = "fast"; showMode(); if(rec.text) $("plText").value = rec.text;
      voiceSel = String(rec.id); await refreshVoices(); voiceSel = String(rec.id); showVoice(); render();
    }catch(err){ say("เปิดเสียงที่เลือกไม่ได้: " + err.message, "err"); }
  })();
  $("plText").addEventListener("input", function(){ if(mode === "fast") autoVoice(); if($("plOut").hidden === sameScript()) render(); });
  async function audioDur(blob){ return new Promise(function(ok){ var a = new Audio(), u = URL.createObjectURL(blob); a.preload = "metadata"; a.src = u;
    a.onloadedmetadata = function(){ URL.revokeObjectURL(u); ok(isFinite(a.duration) ? a.duration : 0); }; a.onerror = function(){ URL.revokeObjectURL(u); ok(0); }; }); }
  function timeShots(shots, al, total){ /* หาเวลาเริ่ม (x.at) กับความยาว (x.dur) ของแต่ละช็อตให้ตรงเสียง: จับข้อความช็อตกับเวลาตัวอักษร ที่จับไม่ได้ประมาณตามจำนวนตัวอักษร */
    var n = shots.length, hit = [], pos = 0, i;
    if(al) shots.forEach(function(x, k){
      var s = norm(x.t), idx = al.chars.indexOf(s, pos), full = idx >= 0;
      if(!full && s.length > 8) idx = al.chars.indexOf(s.slice(0, 8), pos);
      if(idx >= 0){ var last = Math.min(al.en.length - 1, idx + s.length - 1); hit[k] = { s:al.st[idx], e:al.en[last] }; pos = idx + (full ? s.length : 8); }
    });
    for(i = 0; i < n; i++){ if(hit[i]) continue; /* ช่วงที่จับไม่ได้ → แบ่งตามจำนวนตัวอักษรระหว่างช็อตที่จับได้สองข้าง */
      var a = i, b = i; while(b < n && !hit[b]) b++;
      var lo = a && hit[a - 1] ? hit[a - 1].e : 0, hi = b < n ? hit[b].s : total, sum = 0, acc = 0, k;
      for(k = a; k < b; k++) sum += norm(shots[k].t).length || 1;
      for(k = a; k < b; k++){ var len = norm(shots[k].t).length || 1; hit[k] = { s:lo + (hi - lo) * acc / sum, e:lo + (hi - lo) * (acc + len) / sum }; acc += len; }
      i = b - 1; }
    var start = [];
    for(i = 0; i < n; i++) start[i] = i === 0 ? 0 : Math.max(hit[i].s - 0.05, start[i - 1] + 0.5);
    shots.forEach(function(x, k){ x.at = start[k]; x.dur = Math.max(0.4, (k + 1 < n ? start[k + 1] : total) - start[k]); });
  }

  /* ---------- บทจากประวัติของแอพหลัก (mw_history_v1) ---------- */
  function part2(t){ var m = /^[^\n]*PART\s*2[^\n]*$/im.exec(t || ""); return (m ? t.slice(m.index + m[0].length) : (t || "")).trim(); }
  var srcs = [], srcSel = -1;
  async function renderSrc(){ /* ให้เลือกได้เฉพาะบทที่เคยสร้างเสียงแล้ว (จับคู่ข้อความบทกับเสียงที่เก็บไว้) */
    var h = load("mw_history_v1", []), vs = [], used = {}; srcs = [];
    try{ if(window.MWVoice) vs = await MWVoice.list(); }catch(err){}
    (Array.isArray(h) ? h : []).forEach(function(e){
      (e && Array.isArray(e.vers) ? e.vers : []).forEach(function(v){
        var t = part2(v.s2), n = norm(t), hit = t ? vs.filter(matchText(n)) : [];
        if(hit.length){ hit.forEach(function(x){ used[x.id] = 1; }); srcs.push({ title:e.clip && e.clip.title || "คลิป", pname:v.pname || "", n:hit.length, text:t }); }
      });
    });
    vs.forEach(function(x){ /* เสียงที่บทในประวัติถูกแก้/เขียนใหม่/ลบไปหลังสร้างเสียง = ใช้บทที่เก็บไว้กับเสียงนั้นเอง ไม่ให้เสียงไม่มีบท */
      if(!used[x.id] && norm(x.text)) srcs.push({ title:String(x.name || "เสียง").replace(/\.mp3$/i, ""), pname:"บทที่ใช้สร้างเสียงนี้ · " + new Date(x.id).toLocaleTimeString("th-TH", { hour:"2-digit", minute:"2-digit" }), n:1, text:x.text, vid:String(x.id) });
    });
    if(srcSel >= srcs.length) srcSel = -1;
    fsel("plSrcBtn", srcSel >= 0 ? srcs[srcSel].title + " · " + srcs[srcSel].pname : "เลือกบท (" + srcs.length + ")", srcSel < 0, "film");
  }
  $("plSrcBtn").addEventListener("click", function(){
    FT.pick.open({ title:"บทที่เคยสร้างเสียง", placeholder:"พิมพ์ชื่อคลิปเพื่อหา", icon:"speaker",
      items:function(q){ return srcs.map(function(x, i){ return { k:String(i), name:x.title, desc:(x.pname ? x.pname + " · " : "") + (x.vid ? "" : "เสียง " + x.n + " เทค"), on:i === srcSel, x:x }; })
        .filter(function(it){ return !q || (it.name + " " + it.desc).toLowerCase().indexOf(q) >= 0; }); },
      onPick:function(k){
        if(+k === srcSel){ srcSel = -1; $("plText").value = ""; voiceSel = ""; renderSrc(); showVoice(); render(); return; } /* แตะบทที่เลือกอยู่ซ้ำ = ยกเลิก ล้างบทกับเสียงที่ผูกไว้ */
        srcSel = +k; var s = srcs[srcSel]; $("plText").value = s.text; renderSrc(); if(mode === "fast"){ voiceSel = s.vid || ""; autoVoice(); } render(); } });
  });
  document.querySelector(".tabs").addEventListener("click", function(e){ var b = e.target.closest("button[data-p]"); if(b && b.dataset.p === "plan"){ renderSrc(); render(); } });

  /* ---------- ช็อต → ผู้สมัครจากดัชนี (ในเครื่อง ฟรี) ---------- */
  function durOf(t){ return Math.max(MIN_DUR, Math.min(MAX_DUR, t.replace(/\s/g, "").length / RATE + 0.4)); }
  function clip(id){ return U.lib().find(function(c){ return c.id === id; }); }
  function candidates(shot, used){
    var ts = U.terms([shot.t, shot.want, shot.keys.join(" ")].join(" ")), want = [], out = [];
    shot.chars.forEach(function(n){ var k = U.charKey(n); if(want.indexOf(k) < 0) want.push(k); });
    U.lib().forEach(function(c){ if(c.status !== "done" || c.hide) return; c.scenes.forEach(function(sc, si){
      var cs = U.chars(sc), hitC = want.filter(function(k){ return cs.indexOf(k) >= 0; }).length, h = U.hay(c, sc), score = 0;
      ts.forEach(function(v){ var k = U.matchIdx(v, h); if(k >= 0) score += [3, 2, 1][k]; });
      if(want.length){ score += hitC * 8; if(!hitC) score -= 6; } /* สไตล์ช่อง: เอ่ยชื่อใคร ต้องเห็นคนนั้น */
      var len = sc.e - sc.s; score += len >= shot.dur ? 1.5 : len / shot.dur * 1.5; /* ฉากยาวพอกับประโยค */
      var a = sc.ai || {}; if(a.shot && a.shot === shot.shot) score += 1.5; /* ดัชนีรุ่นละเอียด: ระยะภาพตรงที่ผู้กำกับอยากได้ */
      if(a.usable && a.usable <= 2) score -= 2; if(a.multi) score -= 1; /* ขั้นเทพ: ใช้ยาก / มีหลายช็อตปน */
      (a.issues || []).forEach(function(x){ if(/watermark|subtitle|blurry|black/.test(x)) score -= 2; }); /* ภาพมีลายน้ำ/ซับ/เบลอ = ใช้ยาก */
      if(used[c.id + "#" + si]) score -= 5; /* ใช้ไปแล้วในบทนี้ */
      if(score > 0) out.push({ c:c, sc:sc, si:si, score:score });
    }); });
    out.sort(function(a, b){ return b.score - a.score; });
    var per = {}, top = [];
    for(var i = 0; i < out.length && top.length < CAND; i++){ var id = out[i].c.id; if((per[id] = (per[id] || 0) + 1) <= PER_CLIP) top.push(out[i]); } /* คลิปเดียวกันไม่เกิน 2 ตัว ให้ AI มีตัวเลือกหลากหลาย */
    return top;
  }

  /* ---------- กำกับ ---------- */
  var busy = false;
  $("plGo").addEventListener("click", async function(){
    if(busy) return;
    var script = $("plText").value.trim().slice(0, MAX_CHARS);
    if(!script){ U.msg("plMsg", "ใส่บทก่อน (เลือกจากบทที่เคยสร้างเสียง หรือวางเอง)", "err"); return; }
    if(!U.lib().some(function(c){ return c.status === "done"; })){ U.msg("plMsg", "คลังยังว่าง ไปอัปโหลดฟุตเทจก่อน", "err"); return; }
    if(!FT.orKey()){ U.msg("plMsg", "ยังไม่มี OpenRouter key ในเบราว์เซอร์นี้", "err"); return; }
    busy = true; this.disabled = true; var cost = 0, t0 = Date.now(), errs = 0;
    try{
      U.msg("plMsg", "AI กำลังแบ่งบทเป็นช็อต...");
      var voice = mode === "fast" && voiceSel && window.MWVoice ? (await MWVoice.get(+voiceSel) || await MWVoice.pull(+voiceSel)) : null;
      var b = await FT.beats(script, mode); cost += b.cost;
      if(!b.shots.length) throw new Error("AI แบ่งช็อตไม่ได้ ลองใหม่อีกครั้ง");
      var vdur = voice ? (await audioDur(voice.blob) || (voice.align ? voice.align.en[voice.align.en.length - 1] : 0)) : 0;
      if(voice && vdur) timeShots(b.shots, voice.align, vdur); else voice = null; /* ไม่มีความยาวเสียง = ประมาณจากตัวอักษรตามเดิม */
      var used = {}, shots = b.shots.map(function(x){
        if(!voice) x.dur = durOf(x.t);
        var cs = candidates(x, used); if(cs[0]) used[cs[0].c.id + "#" + cs[0].si] = 1;
        x.pool = cs; x.why = ""; return x;
      });
      for(var i = 0; i < shots.length; i += CHUNK){ /* ส่งทีละชุด ให้ AI เห็นช็อตติดกันพร้อมกัน (เลือกไม่ซ้ำ/สลับระยะภาพได้) */
        U.msg("plMsg", "AI กำลังดูภาพและเลือกฉาก " + Math.min(i + CHUNK, shots.length) + "/" + shots.length + " ช็อต...");
        var part = shots.slice(i, i + CHUNK).filter(function(x){ return x.pool.length > 1; }), prev = i ? shots[i - 1].pool[0] : null;
        if(!part.length) continue;
        var items = part.map(function(x){ var n = shots.indexOf(x) + 1;
          return { n:n, t:x.t, want:x.want, chars:x.chars, cands:x.pool.map(function(p, j){ var a = p.sc.ai || {};
            return { id:n + "abcdefgh"[j], who:(a.characters_th && a.characters_th.length ? a.characters_th : a.characters || []).join(","), sum:(a.summary_th || "") + (a.shot || a.event ? " [" + [a.shot, a.intensity ? "intensity " + a.intensity : "", a.event].filter(Boolean).join(", ") + "]" : ""), img:p.sc.thumb }; }) }; });
        try{
          var r = await FT.direct(script, items, prev ? (prev.sc.ai && prev.sc.ai.summary_th || "") : ""); cost += r.cost;
          r.picks.forEach(function(p){
            var x = shots[p.s - 1]; if(!x || !x.pool.length) return;
            var idx = function(id){ var m = /^(\d+)([a-h])$/.exec(String(id).trim()); return m && +m[1] === p.s ? "abcdefgh".indexOf(m[2]) : -1; };
            var order = [idx(p.best)].concat(p.alts.map(idx)).filter(function(j, k, a){ return j >= 0 && j < x.pool.length && a.indexOf(j) === k; });
            x.pool.forEach(function(_, j){ if(order.indexOf(j) < 0) order.push(j); });
            x.pool = order.map(function(j){ return x.pool[j]; }); x.why = p.why;
          });
        }catch(err){ if(err.budget) throw err; errs++; } /* ชุดนี้พลาด = ใช้ลำดับจากการค้นในเครื่องไปก่อน */
      }
      shots.forEach(function(x, k){ /* ไม่ใช้ฉากเดียวกันติดกันสองช็อต */
        var p = k && shots[k - 1].pool[0], a = x.pool[0];
        if(p && a && p.c.id === a.c.id && p.si === a.si && x.pool.length > 1) x.pool.push(x.pool.shift());
      });
      plan = { mode:mode, voice:voice ? { id:voice.id, name:voice.name || "", dur:vdur } : null, at:Date.now(), cost:cost, ms:Date.now() - t0, script:script, shots:shots.map(function(x){
        return { t:x.t, want:x.want, chars:x.chars, keys:x.keys, shot:x.shot, dur:x.dur, at:x.at, why:x.why, use:true, cands:x.pool.map(function(p){ return { id:p.c.id, si:p.si }; }) }; }) };
      save(KEY, plan);
      U.msg("plMsg", errs ? "เสร็จ แต่มี " + errs + " ชุดที่ AI เลือกไม่ได้ ใช้ผลค้นในเครื่องแทน (กดใหม่ได้)" : "", errs ? "err" : "");
      render();
    }catch(err){ U.msg("plMsg", "กำกับไม่ได้: " + err.message, "err"); }
    U.addCost(cost); busy = false; this.disabled = false;
  });

  /* ---------- ตารางช็อต ---------- */
  function chosen(x){ var cd = x.cands[0], c = cd && clip(cd.id), sc = c && c.scenes[cd.si]; return sc ? { c:c, sc:sc, si:cd.si } : null; }
  function cut(x, ch){ /* long: คลิปยาว LONG วิ เริ่มก่อนฉาก LEAD วิ (เผื่อเลือกตอนตัดเอง) · fast: ยาวเท่าประโยค ถ้าฉากสั้นกว่าใช้ทั้งฉาก */
    if(isLong()){ var f = Math.max(0, ch.sc.s - LEAD), end = ch.c.duration || ch.sc.e; return { from:f, to:Math.max(ch.sc.e, Math.min(end, f + LONG)) }; }
    var len = ch.sc.e - ch.sc.s; if(len <= x.dur) return { from:ch.sc.s, to:ch.sc.e };
    var from = ch.sc.s + Math.min(0.2, len - x.dur); return { from:from, to:from + x.dur };
  }
  function sameScript(){ return !!plan && norm(plan.script) === norm($("plText").value.trim().slice(0, MAX_CHARS)); } /* ตารางเก่าโชว์เฉพาะตอนบทในช่องตรงกับบทที่กำกับไว้ */
  function render(){
    if(!plan || !plan.shots || !plan.shots.length || !sameScript()){ $("plOut").hidden = true; $("plRows").innerHTML = ""; return; }
    var found = plan.shots.filter(function(x){ return chosen(x); }).length, secs = plan.shots.reduce(function(t, x){ return t + x.dur; }, 0);
    $("plOut").hidden = false;
    $("plInfo").textContent = (isLong() ? "แบบ 1 ไปตัดเอง · " : plan.voice ? "แบบ 2 AI ตัดให้ + เสียงพากย์ · " : "แบบ 2 AI ตัดให้ · ") + plan.shots.length + " ช็อต (เจอฉาก " + found + ") · เสียงยาวราว " + Math.round(secs) + " วิ · ใช้ไป " + U.money(plan.cost || 0) + " · " + ((plan.ms || 0) / 1000).toFixed(0) + " วิ · แตะรูปเล็กเพื่อสลับฉาก";
    $("plRows").innerHTML = plan.shots.map(function(x, k){
      var ch = chosen(x), r = ch && cut(x, ch);
      return '<div class="pl' + (x.use ? "" : " off") + '"><div class="ln"><i>' + (k + 1) + "</i>" + U.esc(x.t) + ' <small class="dur">' + (plan.voice ? x.at.toFixed(1) + "–" + (x.at + x.dur).toFixed(1) + " วิ" : x.dur.toFixed(1) + " วิ") + "</small></div>"
        + '<div class="want">' + MWIcon("film") + U.esc(x.want || "-") + "</div>"
        + (ch ? U.card(ch.c, ch.sc, false, x.why) + '<p class="hint" style="margin:4px 0 0">ตัดช่วง ' + U.tm(r.from) + "–" + U.tm(r.to) + " (" + (r.to - r.from).toFixed(1) + " วิ)" + (!isLong() && r.to - r.from < x.dur - 0.3 ? " · ฉากสั้นกว่าประโยค ยืดใน CapCut" : "") + "</p>"
              : '<div class="none">ไม่มีฉากที่ตรงในคลัง (อัปฟุตเทจเพิ่ม หรือหาเองตามคำอธิบายด้านบน)</div>')
        + (x.cands.length > 1 ? '<div class="alts">' + x.cands.map(function(cd, j){ var c = clip(cd.id), s = c && c.scenes[cd.si];
            return s ? '<button class="alt' + (j ? "" : " on") + '" data-alt="' + k + "|" + j + '" aria-label="ใช้ตัวเลือกนี้"><img src="' + s.thumb + '" alt=""></button>' : ""; }).join("") + "</div>" : "")
        + (ch ? '<label class="chk"><input type="checkbox" data-use="' + k + '"' + (x.use ? " checked" : "") + "> ใช้ช็อตนี้</label>" : "")
        + "</div>";
    }).join("");
    renderShare();
  }
  $("plRows").addEventListener("click", function(e){
    var b = e.target.closest("[data-alt]"); if(!b) return;
    var p = b.dataset.alt.split("|"), x = plan.shots[+p[0]], j = +p[1]; if(!j) return;
    x.cands.unshift(x.cands.splice(j, 1)[0]); x.why = "เลือกเอง"; save(KEY, plan); render(); /* ตัวที่แตะขึ้นเป็นตัวแรก (ตัวที่ใช้) */
  });
  $("plRows").addEventListener("change", function(e){
    var c = e.target.closest("[data-use]"); if(!c) return;
    plan.shots[+c.dataset.use].use = c.checked; save(KEY, plan); render();
  });

  /* ---------- วิดีโอยาว (จอเขียว + ตื๊ด คั่นทุกช็อต) ---------- */
  function picked(){
    var out = [], v = !isLong() && plan.voice; /* มีเสียง: ทุกช็อตอยู่ในเส้นเวลา ช็อตที่ไม่ใช้/ไม่มีฉากค้างภาพก่อนหน้า (c:null) ไม่งั้นเสียงกับภาพเลื่อน */
    plan.shots.forEach(function(x, k){ var ch = x.use && chosen(x);
      if(!ch){ if(v) out.push({ c:null, from:0, to:0, at:x.at, k:k, t:x.t }); return; }
      var r = cut(x, ch); out.push({ c:ch.c, sc:ch.sc, si:ch.si, from:r.from, to:r.to, at:x.at, k:k, t:x.t }); });
    return out;
  }
  function sig(list){ return (plan.voice ? "v" + plan.voice.id + ":" : "") + list.map(function(x){ return (x.c ? x.c.id + "#" + x.si : "hold") + "@" + x.from.toFixed(2) + "-" + x.to.toFixed(2); }).join(","); }
  var cuts = null, cutting = false, lastPick = ""; /* cuts = { sig, file, url, marks } หายเมื่อปิดหน้า */
  function renderResult(){
    var list = picked(), ok = cuts && cuts.sig === sig(list);
    if(!ok){ $("plBatches").innerHTML = ""; return; }
    $("plBatches").innerHTML = '<video class="plvid" src="' + cuts.url + '" controls playsinline></video>'
      + '<button class="btn" id="plSave" style="width:100%;margin-top:10px">' + MWIcon("save") + 'บันทึกไฟล์ลงเครื่อง (' + (cuts.file.size / 1048576).toFixed(1) + " MB)</button>"
      + '<p class="hint">จากนั้นเปิด CapCut → โปรเจกต์ใหม่ → เลือกวิดีโอจากแกลเลอรี (อัลบั้ม Download หรือ ล่าสุด) · ' + (isLong() ? "จอเขียว + เสียงตื๊ด = จุดเปลี่ยนช็อต เลือกช่วงที่ชอบแล้วตัดจอเขียวทิ้ง" : (plan.voice ? "ในไฟล์มีเสียงพากย์แล้ว ภาพตัดตามคำพูด ใส่ซับ/เอฟเฟกต์ต่อได้เลย" : "ปิดเสียงฉากแล้ววางเสียงพากย์ทับ ปรับจังหวะให้ตรงคำ")) + "</p>"
      + '<p class="hint">เวลาเริ่มของแต่ละช็อตในไฟล์:</p><ol class="marks">'
      + cuts.marks.map(function(m){ return "<li><b>" + m.at.toFixed(1) + " วิ</b> · ช็อต " + (m.x.k + 1) + (m.x.c ? "" : " (ค้างภาพก่อนหน้า)") + " · " + U.esc(m.x.t) + " (" + m.len.toFixed(1) + " วิ)</li>"; }).join("") + "</ol>";
  }
  function renderShare(){
    var list = picked(), miss = list.filter(function(x){ return x.c && !U.hasSrc(x.c); }), done = cuts && cuts.sig === sig(list);
    var sep = isLong() ? SEP : 0, secs = !isLong() && plan.voice ? plan.voice.dur : list.reduce(function(t, x){ return t + (x.to - x.from); }, 0) + Math.max(0, list.length - 1) * sep;
    $("plShare").innerHTML = MWIcon("scissors") + (done ? "ทำใหม่อีกรอบ" : (isLong() ? "สร้างวิดีโอยาว " : plan.voice ? "ตัดต่อ + ใส่เสียงพากย์ " : "ให้ AI ตัดต่อ ") + list.length + " ช็อต");
    $("plShare").disabled = cutting || !list.length || miss.length > 0 || !FT.stitch.ok();
    $("plNeed").hidden = !miss.length;
    $("plNeedTxt").textContent = "ยังไม่มีไฟล์ " + miss.length + "/" + list.length + " ช็อต (ไม่อยู่ในคลังคลาวด์ และยังไม่ได้เปิดไฟล์ในเครื่อง) · กดปุ่มด้านล่าง → เข้าโฟลเดอร์อัลบั้ม → เลือกทั้งหมด แอพเก็บเฉพาะคลิปที่ใช้เอง";
    if(!cutting) say(!list.length ? "" : miss.length ? lastPick
      : done ? "สร้างไว้แล้ว ดูตัวอย่างด้านล่างก่อนบันทึกได้"
      : "กดปุ่มตัดต่อแล้วแอพจะเล่นเฉพาะช่วงที่ตัดเรียงตามบท" + (sep ? " คั่นด้วยจอเขียว + เสียงตื๊ด " + sep + " วิ" : plan.voice ? " ตามจังหวะเสียงพากย์ (ใส่เสียงให้ในไฟล์)" : " ต่อกันเลย") + " (ใช้เวลา ≈ " + Math.round(secs) + " วิ · เปิดหน้าค้างไว้ ห้ามสลับแอพ)", done ? "ok" : "");
    renderResult();
  }
  document.addEventListener("ft:files", function(e){ /* footage-find.js ส่งมาหลังเลือกไฟล์ */
    if(!plan) return;
    var list = picked(), got = list.filter(function(x){ return U.hasSrc(x.c); }).length;
    lastPick = "เลือกมา " + e.detail + " ไฟล์ → พร้อม " + got + "/" + list.length + " ช็อต" + (got < list.length ? " · เปิดอัลบั้มที่เหลือต่อได้เลย (ของเดิมไม่หาย)" : "");
    renderShare();
  });
  $("plDocs").addEventListener("click", function(){ U.openFiles(true); });
  $("plShare").addEventListener("click", async function(){
    var list = picked();
    if(!FT.stitch.ok()){ say("เบราว์เซอร์นี้อัดวิดีโอไม่ได้ ใช้ปุ่ม คัดลอกตาราง แทน", "err"); return; }
    if(cuts){ URL.revokeObjectURL(cuts.url); cuts = null; }
    cutting = true; renderShare(); $("plProg").hidden = false; $("plBar").style.width = "0";
    try{
      var vb = null;
      if(!isLong() && plan.voice){ var vr = window.MWVoice ? await MWVoice.get(plan.voice.id) : null; if(!vr) throw new Error("ไม่เจอเสียงพากย์ที่เลือกไว้แล้ว (ถูกลบ) ให้กำกับใหม่อีกครั้ง"); vb = vr.blob; }
      var r = await FT.stitch.make(list, function(i, x){
        say("กำลังอัดช็อต " + (i + 1) + "/" + list.length + " · " + x.t + " · อย่าสลับแอพ");
        $("plBar").style.width = (i / list.length * 100) + "%";
      }, say, { sep:isLong() ? SEP : 0, voice:vb });
      cuts = { sig:sig(list), file:r.file, url:URL.createObjectURL(r.file), marks:r.marks };
      cutting = false; renderShare();
      say("เสร็จแล้ว " + r.marks.length + " ช็อต · " + (r.file.size / 1048576).toFixed(1) + " MB · ดูตัวอย่างด้านล่าง แล้วกดปุ่มบันทึก", "ok");
    }catch(err){ cutting = false; renderShare(); say("อัดไม่ได้: " + err.message + (document.hidden ? " (สลับแอพระหว่างอัด?)" : ""), "err"); }
    $("plProg").hidden = true;
  });
  $("plBatches").addEventListener("click", function(e){ if(cuts && e.target.closest("#plSave")) FT.stitch.save(cuts.file, say); });
  $("plCopy").addEventListener("click", function(){
    var txt = plan.shots.map(function(x, k){ var ch = x.use && chosen(x), r = ch && cut(x, ch);
      return (k + 1) + ". " + x.t + "\n   → " + (ch ? ch.c.name + " ช่วง " + U.tm(r.from) + "–" + U.tm(r.to) + " (" + (r.to - r.from).toFixed(1) + " วิ)" : "ไม่มีในคลัง: " + x.want); }).join("\n");
    var b = this;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function(){ b.textContent = "คัดลอกแล้ว"; setTimeout(function(){ b.textContent = "คัดลอกตาราง"; }, 1500); })
      .catch(function(){ MWDialog.copy(txt); });
  });

  renderSrc(); refreshVoices();
  /* ดัชนีโหลดจาก IndexedDB หลังหน้าเปิด → วาดตารางเดิมเมื่อเข้าแท็บนี้ (render ตอนกดแท็บ) */
})();
