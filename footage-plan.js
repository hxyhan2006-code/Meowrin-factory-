/* footage-plan.js — แท็บ "ผู้กำกับ": บท → AI แบ่งเป็นช็อตสั้นๆ (FT.beats) → หาผู้สมัครในดัชนีในเครื่อง → AI ดูรูปจริงแล้วเลือก (FT.direct)
   → ตารางช็อต (แตะสลับตัวสำรอง/ติ๊กไม่ใช้) → วิดีโอยาวไฟล์เดียว คั่นทุกช็อตด้วยจอเขียว + เสียงตื๊ด (FT.stitch) → บันทึกไปตัดต่อใน CapCut
   ความยาวช็อต = ประมาณจากจำนวนตัวอักษรของประโยค (RATE ตัว/วิ) ไม่เกิน 10 วิ · ตารางล่าสุดเก็บที่ MWStore key mw_footage_direct_v1 (อ้างคลิปด้วย id + ลำดับฉาก ไม่เก็บรูป) */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U || !FT.stitch) return;
  var $ = function(id){ return document.getElementById(id); };
  var KEY = "mw_footage_direct_v1", CAND = 6, PER_CLIP = 2, CHUNK = 6, RATE = 13, MIN_DUR = 1, MAX_DUR = 10, SEP = 2, MAX_CHARS = 3000;
  function load(k, d){ return MWStore.get(k, d); } /* store.js: IndexedDB + แคช */
  function save(k, v){ return MWStore.set(k, v); }
  var plan = load(KEY, null); /* { at, cost, ms, script, shots:[{ t, want, chars, keys, shot, dur, cands:[{ id, si }], why, use }] } (cands[0] = ที่ใช้อยู่) */
  var say = function(t, k){ U.msg("plShareMsg", t, k); };

  /* ---------- บทจากประวัติของแอพหลัก (mw_history_v1) ---------- */
  function part2(t){ var m = /^[^\n]*PART\s*2[^\n]*$/im.exec(t || ""); return (m ? t.slice(m.index + m[0].length) : (t || "")).trim(); }
  var srcs = [];
  function renderSrc(){
    var h = load("mw_history_v1", []); srcs = [];
    (Array.isArray(h) ? h : []).forEach(function(e){
      (e && Array.isArray(e.vers) ? e.vers : []).forEach(function(v){
        var t = part2(v.s2); if(t) srcs.push({ label:(e.clip && e.clip.title || "คลิป") + " · " + (v.pname || ""), text:t });
      });
    });
    $("plSrc").innerHTML = '<option value="">— เลือกบท (' + srcs.length + ') —</option>' + srcs.map(function(s, i){ return '<option value="' + i + '">' + U.esc(s.label) + "</option>"; }).join("");
  }
  $("plSrc").addEventListener("change", function(){ var s = srcs[+this.value]; if(this.value !== "" && s) $("plText").value = s.text; });
  document.querySelector(".tabs").addEventListener("click", function(e){ var b = e.target.closest("button[data-p]"); if(b && b.dataset.p === "plan"){ renderSrc(); render(); } });

  /* ---------- ช็อต → ผู้สมัครจากดัชนี (ในเครื่อง ฟรี) ---------- */
  function durOf(t){ return Math.max(MIN_DUR, Math.min(MAX_DUR, t.replace(/\s/g, "").length / RATE + 0.4)); }
  function clip(id){ return U.lib().find(function(c){ return c.id === id; }); }
  function candidates(shot, used){
    var ts = U.terms([shot.t, shot.want, shot.keys.join(" ")].join(" ")), want = [], out = [];
    shot.chars.forEach(function(n){ var k = U.charKey(n); if(want.indexOf(k) < 0) want.push(k); });
    U.lib().forEach(function(c){ if(c.status !== "done") return; c.scenes.forEach(function(sc, si){
      var cs = U.chars(sc), hitC = want.filter(function(k){ return cs.indexOf(k) >= 0; }).length, h = U.hay(c, sc), score = 0;
      ts.forEach(function(v){ var w = [3, 2, 1].find(function(_, k){ return v.some(function(n){ return h[k].indexOf(n) >= 0; }); }); if(w) score += w; });
      if(want.length){ score += hitC * 8; if(!hitC) score -= 6; } /* สไตล์ช่อง: เอ่ยชื่อใคร ต้องเห็นคนนั้น */
      var len = sc.e - sc.s; score += len >= shot.dur ? 1.5 : len / shot.dur * 1.5; /* ฉากยาวพอกับประโยค */
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
    if(!script){ U.msg("plMsg", "ใส่บทก่อน (เลือกจากประวัติ หรือวางเอง)", "err"); return; }
    if(!U.lib().some(function(c){ return c.status === "done"; })){ U.msg("plMsg", "คลังยังว่าง ไปอัปโหลดฟุตเทจก่อน", "err"); return; }
    if(!FT.orKey()){ U.msg("plMsg", "ยังไม่มี OpenRouter key ในเบราว์เซอร์นี้", "err"); return; }
    busy = true; this.disabled = true; var cost = 0, t0 = Date.now(), errs = 0;
    try{
      U.msg("plMsg", "AI กำลังแบ่งบทเป็นช็อต...");
      var b = await FT.beats(script); cost += b.cost;
      if(!b.shots.length) throw new Error("AI แบ่งช็อตไม่ได้ ลองใหม่อีกครั้ง");
      var used = {}, shots = b.shots.map(function(x){
        x.dur = durOf(x.t);
        var cs = candidates(x, used); if(cs[0]) used[cs[0].c.id + "#" + cs[0].si] = 1;
        x.pool = cs; x.why = ""; return x;
      });
      for(var i = 0; i < shots.length; i += CHUNK){ /* ส่งทีละชุด ให้ AI เห็นช็อตติดกันพร้อมกัน (เลือกไม่ซ้ำ/สลับระยะภาพได้) */
        U.msg("plMsg", "AI กำลังดูภาพและเลือกฉาก " + Math.min(i + CHUNK, shots.length) + "/" + shots.length + " ช็อต...");
        var part = shots.slice(i, i + CHUNK).filter(function(x){ return x.pool.length > 1; }), prev = i ? shots[i - 1].pool[0] : null;
        if(!part.length) continue;
        var items = part.map(function(x){ var n = shots.indexOf(x) + 1;
          return { n:n, t:x.t, want:x.want, chars:x.chars, cands:x.pool.map(function(p, j){ var a = p.sc.ai || {};
            return { id:n + "abcdefgh"[j], who:(a.characters_th && a.characters_th.length ? a.characters_th : a.characters || []).join(","), sum:a.summary_th || "", img:p.sc.thumb }; }) }; });
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
      plan = { at:Date.now(), cost:cost, ms:Date.now() - t0, script:script, shots:shots.map(function(x){
        return { t:x.t, want:x.want, chars:x.chars, keys:x.keys, shot:x.shot, dur:x.dur, why:x.why, use:true, cands:x.pool.map(function(p){ return { id:p.c.id, si:p.si }; }) }; }) };
      save(KEY, plan);
      U.msg("plMsg", errs ? "เสร็จ แต่มี " + errs + " ชุดที่ AI เลือกไม่ได้ ใช้ผลค้นในเครื่องแทน (กดใหม่ได้)" : "", errs ? "err" : "");
      render();
    }catch(err){ U.msg("plMsg", "กำกับไม่ได้: " + err.message, "err"); }
    U.addCost(cost); busy = false; this.disabled = false;
  });

  /* ---------- ตารางช็อต ---------- */
  function chosen(x){ var cd = x.cands[0], c = cd && clip(cd.id), sc = c && c.scenes[cd.si]; return sc ? { c:c, sc:sc, si:cd.si } : null; }
  function cut(x, ch){ /* ช่วงที่ตัดจากฉาก: ยาวเท่าประโยค ถ้าฉากสั้นกว่าใช้ทั้งฉาก */
    var len = ch.sc.e - ch.sc.s; if(len <= x.dur) return { from:ch.sc.s, to:ch.sc.e };
    var from = ch.sc.s + Math.min(0.2, len - x.dur); return { from:from, to:from + x.dur };
  }
  function render(){
    if(!plan || !plan.shots || !plan.shots.length){ $("plOut").hidden = true; $("plRows").innerHTML = ""; return; }
    var found = plan.shots.filter(function(x){ return chosen(x); }).length, secs = plan.shots.reduce(function(t, x){ return t + x.dur; }, 0);
    $("plOut").hidden = false;
    $("plInfo").textContent = plan.shots.length + " ช็อต (เจอฉาก " + found + ") · เสียงยาวราว " + Math.round(secs) + " วิ · ใช้ไป " + U.money(plan.cost || 0) + " · " + ((plan.ms || 0) / 1000).toFixed(0) + " วิ · แตะรูปเล็กเพื่อสลับฉาก";
    $("plRows").innerHTML = plan.shots.map(function(x, k){
      var ch = chosen(x), r = ch && cut(x, ch);
      return '<div class="pl' + (x.use ? "" : " off") + '"><div class="ln"><i>' + (k + 1) + "</i>" + U.esc(x.t) + ' <small class="dur">' + x.dur.toFixed(1) + " วิ</small></div>"
        + '<div class="want">🎬 ' + U.esc(x.want || "-") + "</div>"
        + (ch ? U.card(ch.c, ch.sc, false, x.why) + '<p class="hint" style="margin:4px 0 0">ตัดช่วง ' + U.tm(r.from) + "–" + U.tm(r.to) + " (" + (r.to - r.from).toFixed(1) + " วิ)" + (r.to - r.from < x.dur - 0.3 ? " · ฉากสั้นกว่าประโยค ยืดใน CapCut" : "") + "</p>"
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
    var out = [];
    plan.shots.forEach(function(x, k){ var ch = x.use && chosen(x); if(!ch) return; var r = cut(x, ch);
      out.push({ c:ch.c, sc:ch.sc, si:ch.si, from:r.from, to:r.to, k:k, t:x.t }); });
    return out;
  }
  function sig(list){ return list.map(function(x){ return x.c.id + "#" + x.si + "@" + x.from.toFixed(2) + "-" + x.to.toFixed(2); }).join(","); }
  var cuts = null, cutting = false, lastPick = ""; /* cuts = { sig, file, url, marks } หายเมื่อปิดหน้า */
  function renderResult(){
    var list = picked(), ok = cuts && cuts.sig === sig(list);
    if(!ok){ $("plBatches").innerHTML = ""; return; }
    $("plBatches").innerHTML = '<video class="plvid" src="' + cuts.url + '" controls playsinline></video>'
      + '<button class="btn" id="plSave" style="width:100%;margin-top:10px">💾 บันทึกไฟล์ลงเครื่อง (' + (cuts.file.size / 1048576).toFixed(1) + " MB)</button>"
      + '<p class="hint">จากนั้นเปิด CapCut → โปรเจกต์ใหม่ → เลือกวิดีโอจากแกลเลอรี (อัลบั้ม Download หรือ ล่าสุด) · จอเขียว + เสียงตื๊ด = จุดเปลี่ยนช็อต ตัดทิ้งแล้ววางเสียงพากย์ทับ</p>'
      + '<p class="hint">เวลาเริ่มของแต่ละช็อตในไฟล์:</p><ol class="marks">'
      + cuts.marks.map(function(m){ return "<li><b>" + m.at.toFixed(1) + " วิ</b> · ช็อต " + (m.x.k + 1) + " · " + U.esc(m.x.t) + " (" + m.len.toFixed(1) + " วิ)</li>"; }).join("") + "</ol>";
  }
  function renderShare(){
    var list = picked(), miss = list.filter(function(x){ return !U.hasSrc(x.c); }), done = cuts && cuts.sig === sig(list);
    var secs = list.reduce(function(t, x){ return t + (x.to - x.from); }, 0) + Math.max(0, list.length - 1) * SEP;
    $("plShare").textContent = done ? "✂ ทำใหม่อีกรอบ" : "✂ สร้างวิดีโอยาว " + list.length + " ช็อต";
    $("plShare").disabled = cutting || !list.length || miss.length > 0 || !FT.stitch.ok();
    $("plNeed").hidden = !miss.length;
    $("plNeedTxt").textContent = "ยังไม่มีไฟล์ " + miss.length + "/" + list.length + " ช็อต (ไม่อยู่ในคลังคลาวด์ และยังไม่ได้เปิดไฟล์ในเครื่อง) · กดปุ่มด้านล่าง → เข้าโฟลเดอร์อัลบั้ม → เลือกทั้งหมด แอพเก็บเฉพาะคลิปที่ใช้เอง";
    if(!cutting) say(!list.length ? "" : miss.length ? lastPick
      : done ? "สร้างไว้แล้ว ดูตัวอย่างด้านล่างก่อนบันทึกได้"
      : "กด ✂ แล้วแอพจะเล่นเฉพาะช่วงที่ตัดเรียงตามบท คั่นด้วยจอเขียว + เสียงตื๊ด " + SEP + " วิ (ใช้เวลา ≈ " + Math.round(secs) + " วิ · เปิดหน้าค้างไว้ ห้ามสลับแอพ)", done ? "ok" : "");
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
      var r = await FT.stitch.make(list, function(i, x){
        say("กำลังอัดช็อต " + (i + 1) + "/" + list.length + " · " + x.t + " · อย่าสลับแอพ");
        $("plBar").style.width = (i / list.length * 100) + "%";
      }, say, { sep:SEP });
      cuts = { sig:sig(list), file:r.file, url:URL.createObjectURL(r.file), marks:r.marks };
      cutting = false; renderShare();
      say("เสร็จแล้ว " + r.marks.length + " ช็อต · " + (r.file.size / 1048576).toFixed(1) + " MB · ดูตัวอย่างด้านล่าง แล้วกด 💾 บันทึก", "ok");
    }catch(err){ cutting = false; renderShare(); say("อัดไม่ได้: " + err.message + (document.hidden ? " (สลับแอพระหว่างอัด?)" : ""), "err"); }
    $("plProg").hidden = true;
  });
  $("plBatches").addEventListener("click", function(e){ if(cuts && e.target.closest("#plSave")) FT.stitch.save(cuts.file, say); });
  $("plCopy").addEventListener("click", function(){
    var txt = plan.shots.map(function(x, k){ var ch = x.use && chosen(x), r = ch && cut(x, ch);
      return (k + 1) + ". " + x.t + "\n   → " + (ch ? ch.c.name + " ช่วง " + U.tm(r.from) + "–" + U.tm(r.to) + " (" + (r.to - r.from).toFixed(1) + " วิ)" : "ไม่มีในคลัง: " + x.want); }).join("\n");
    var b = this;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function(){ b.textContent = "คัดลอกแล้ว"; setTimeout(function(){ b.textContent = "คัดลอกตาราง"; }, 1500); })
      .catch(function(){ window.prompt("คัดลอกตรงนี้", txt); });
  });

  renderSrc();
  /* ดัชนีโหลดจาก IndexedDB หลังหน้าเปิด → วาดตารางเดิมเมื่อเข้าแท็บนี้ (render ตอนกดแท็บ) */
})();
