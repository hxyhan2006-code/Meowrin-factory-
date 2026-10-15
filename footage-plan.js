/* footage-plan.js — แท็บ "วางแผน": บท → AI คิดฉากทีละบรรทัด (FT.plan) → หาคลิปจริงในดัชนี (ค้นในเครื่อง + FT.rank)
   → เลือก/สลับ → แชร์ไฟล์คลิปที่เลือกเรียงตามบทไป CapCut (Web Share) · โหลดหลัง footage.js (ใช้ FT.ui)
   แผนล่าสุดเก็บใน MWStore (store.js) key mw_footage_plan_v1 (อ้างคลิปด้วย id + ลำดับฉาก ไม่เก็บรูป) */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U) return;
  var $ = function(id){ return document.getElementById(id); };
  var KEY = "mw_footage_plan_v1", POOL = 40, PICKS = 3, PAR = 3, MAX_LINES = 40;
  function load(k, d){ return MWStore.get(k, d); } /* store.js: IndexedDB + แคช */
  function save(k, v){ return MWStore.set(k, v); }
  var plan = load(KEY, null); /* { at, cost, rows:[{ line, scene, backup, picks:[{id, si, why}], sel, use }] } */

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

  /* ---------- หาผู้สมัครในดัชนีจากฉากที่ AI อยากได้ (ค้นในเครื่อง ฟรี) ---------- */
  function candidates(it){
    var ts = U.terms([it.scene, it.backup, it.chars.join(" "), it.keys.join(" ")].join(" ")), want = it.chars.map(function(c){ return c.toLowerCase(); }), out = [];
    U.lib().forEach(function(c){ if(c.status !== "done") return; c.scenes.forEach(function(sc, si){
      var h = U.hay(c, sc), hit = 0, score = 0, a = sc.ai || {};
      ts.forEach(function(v){ var w = [4, 2, 1].find(function(_, k){ return v.some(function(n){ return h[k].indexOf(n) >= 0; }); }); if(w){ hit++; score += w; } });
      if((a.characters || []).some(function(n){ return want.indexOf(String(n).toLowerCase()) >= 0; })) score += 3;
      if(hit || score) out.push({ c:c, sc:sc, si:si, s:hit * 10 + score });
    }); });
    return out.sort(function(x, y){ return y.s - x.s; }).slice(0, POOL);
  }
  function clip(id){ return U.lib().find(function(c){ return c.id === id; }); }
  function sameScene(a, b){ return a && b && a.id === b.id && a.si === b.si; }

  /* ---------- วางแผน ---------- */
  var busy = false;
  $("plGo").addEventListener("click", async function(){
    if(busy) return;
    var lines = $("plText").value.split("\n").map(function(l){ return l.trim(); }).filter(Boolean).slice(0, MAX_LINES);
    if(!lines.length){ U.msg("plMsg", "ใส่บทก่อน (เลือกจากประวัติ หรือวางเอง)", "err"); return; }
    if(!U.lib().some(function(c){ return c.status === "done"; })){ U.msg("plMsg", "ดัชนียังว่าง ไปทำดัชนีคลิปก่อน", "err"); return; }
    if(!FT.orKey()){ U.msg("plMsg", "ยังไม่มี OpenRouter key ในเบราว์เซอร์นี้", "err"); return; }
    busy = true; this.disabled = true; var cost = 0, t0 = Date.now();
    try{
      U.msg("plMsg", "AI กำลังคิดฉากทีละบรรทัด (" + lines.length + " บรรทัด)...");
      var p = await FT.plan(lines); cost += p.cost;
      var rows = p.items.map(function(it){ return { line:it.line, scene:it.scene, backup:it.backup, picks:[], sel:0, use:true, it:it }; }), done = 0;
      U.msg("plMsg", "กำลังหาคลิปในดัชนี 0/" + rows.length + "...");
      for(var i = 0; i < rows.length; i += PAR){ /* ส่งพร้อมกันทีละ PAR บรรทัด */
        await Promise.all(rows.slice(i, i + PAR).map(async function(r){
          var pool = candidates(r.it);
          if(pool.length){
            try{
              var items = pool.map(function(x, k){ var a = x.sc.ai || {}; return { i:k + 1, who:(a.characters_th && a.characters_th.length ? a.characters_th : a.characters || []).join(","), sum:a.summary_th || "", tags:(a.tags_th || []).join(","), loc:a.location || "" }; });
              var rr = await FT.rank('บทพูด: "' + r.line + '"\nฉากที่อยากได้: ' + r.scene + "\nหรือ: " + r.backup, items); cost += rr.cost;
              r.picks = rr.picks.filter(function(pk){ return pk.i <= pool.length; }).slice(0, PICKS).map(function(pk){ var x = pool[pk.i - 1]; return { id:x.c.id, si:x.si, why:pk.why }; });
            }catch(err){ r.err = err.message; }
          }
          done++; U.msg("plMsg", "กำลังหาคลิปในดัชนี " + done + "/" + rows.length + "...");
        }));
      }
      rows.forEach(function(r, k){ /* ไม่ใช้ฉากเดียวกันติดกันสองบรรทัด */
        var prev = k && rows[k - 1].picks[rows[k - 1].sel];
        if(sameScene(r.picks[0], prev) && r.picks.length > 1) r.sel = 1;
        delete r.it;
      });
      plan = { at:Date.now(), cost:cost, ms:Date.now() - t0, rows:rows }; save(KEY, plan);
      U.msg("plMsg", ""); render();
    }catch(err){ U.msg("plMsg", "วางแผนไม่ได้: " + err.message, "err"); }
    U.addCost(cost); busy = false; this.disabled = false;
  });

  /* ---------- แสดงแผน ---------- */
  function chosen(r){ var pk = r.picks[r.sel]; return pk && clip(pk.id) ? { pk:pk, c:clip(pk.id) } : null; }
  function render(){
    if(!plan || !plan.rows || !plan.rows.length){ $("plOut").hidden = true; $("plRows").innerHTML = ""; return; }
    var found = plan.rows.filter(function(r){ return chosen(r); }).length;
    $("plOut").hidden = false;
    $("plInfo").textContent = "เจอคลิปให้ " + found + "/" + plan.rows.length + " บรรทัด · ใช้ไป " + U.money(plan.cost || 0) + " · " + ((plan.ms || 0) / 1000).toFixed(0) + " วิ · แตะรูปเล็กด้านล่างแต่ละบรรทัดเพื่อสลับฉาก";
    $("plRows").innerHTML = plan.rows.map(function(r, k){
      var ch = chosen(r), sc = ch && ch.c.scenes[ch.pk.si];
      return '<div class="pl' + (r.use ? "" : " off") + '"><div class="ln"><i>' + (k + 1) + "</i>" + U.esc(r.line) + "</div>"
        + '<div class="want">🎬 ' + U.esc(r.scene || "-") + (r.backup ? "<br>สำรอง: " + U.esc(r.backup) : "") + "</div>"
        + (sc ? U.card(ch.c, sc, false, ch.pk.why) : '<div class="none">' + (r.err ? "หาไม่ได้: " + U.esc(r.err) : "ไม่มีฉากที่ตรงในดัชนี (ลองหาเองตามคำอธิบายด้านบน)") + "</div>")
        + (r.picks.length > 1 ? '<div class="alts">' + r.picks.map(function(pk, j){ var c = clip(pk.id), s = c && c.scenes[pk.si];
            return s ? '<button class="alt' + (j === r.sel ? " on" : "") + '" data-alt="' + k + "|" + j + '" aria-label="ใช้ตัวเลือกนี้"><img src="' + s.thumb + '" alt=""></button>' : ""; }).join("") + "</div>" : "")
        + (sc ? '<label class="chk"><input type="checkbox" data-use="' + k + '"' + (r.use ? " checked" : "") + "> ใช้บรรทัดนี้ตอนแชร์</label>" : "")
        + "</div>";
    }).join("");
    renderShare();
  }
  $("plRows").addEventListener("click", function(e){
    var b = e.target.closest("[data-alt]"); if(!b) return;
    var p = b.dataset.alt.split("|"); plan.rows[+p[0]].sel = +p[1]; save(KEY, plan); render();
  });
  $("plRows").addEventListener("change", function(e){
    var c = e.target.closest("[data-use]"); if(!c) return;
    plan.rows[+c.dataset.use].use = c.checked; save(KEY, plan); render();
  });

  /* ---------- แชร์ไป CapCut / คัดลอกรายการ ---------- */
  /* ฉากที่ใช้ เรียงตามบท (บรรทัดติดกันใช้ฉากเดียวกัน = ไฟล์เดียว) */
  function picked(){
    var out = [];
    plan.rows.forEach(function(r, k){ var ch = r.use && chosen(r); if(!ch) return;
      var last = out[out.length - 1];
      if(last && last.c.id === ch.c.id && last.si === ch.pk.si) last.lines.push(k + 1); else out.push({ c:ch.c, si:ch.pk.si, sc:ch.c.scenes[ch.pk.si], lines:[k + 1] });
    });
    return out;
  }
  function sig(list){ return list.map(function(x){ return x.c.id + "#" + x.si; }).join(","); }

  var cuts = null, cutting = false; /* cuts = { sig, file, url, marks:[{lines, at, len}] } หายเมื่อปิดหน้า · การอัด/แชร์/บันทึกอยู่ใน footage-stitch.js (FT.stitch) */
  function renderBatches(){
    var list = picked(), ok = cuts && cuts.sig === sig(list);
    if(!ok){ $("plBatches").innerHTML = ""; return; }
    $("plBatches").innerHTML = '<video class="plvid" src="' + cuts.url + '" controls playsinline></video>'
      + '<button class="btn" id="plSave" style="width:100%;margin-top:10px">💾 บันทึกไฟล์ลงเครื่อง (ใช้ทางนี้)</button>'
      + '<p class="hint">จากนั้นเปิด CapCut → โปรเจกต์ใหม่ → เลือกวิดีโอจากแกลเลอรี (อัลบั้ม Download หรือ ล่าสุด)</p>'
      + '<details class="dbg"><summary>ลองแชร์ตรง (ใน Brave มักใช้กับ CapCut ไม่ได้)</summary><button class="btn ghost" id="plSend" style="width:100%;margin-top:8px">แชร์ไป CapCut (1 ไฟล์ · ' + (cuts.file.size / 1048576).toFixed(1) + " MB)</button></details>"
      + '<p class="hint">จุดเริ่มของแต่ละบรรทัดในไฟล์ (แยกคลิปใน CapCut ตรงเวลาเหล่านี้):</p><ol class="marks">'
      + cuts.marks.map(function(m){ return "<li><b>" + m.at.toFixed(1) + " วิ</b> · บรรทัด " + m.lines.join(",") + " · " + U.esc(m.c.album) + " " + U.tm(m.sc.s) + " (" + m.len.toFixed(1) + " วิ)</li>"; }).join("") + "</ol>";
  }
  function renderShare(){
    var list = picked(), miss = list.filter(function(x){ return !U.hasSrc(x.c); }), alb = {};
    miss.forEach(function(x){ alb[x.c.album] = (alb[x.c.album] || 0) + 1; });
    var done = cuts && cuts.sig === sig(list);
    $("plShare").textContent = done ? "✂ ทำใหม่อีกรอบ" : "✂ ต่อ " + list.length + " ฉากเป็นวิดีโอเดียว";
    $("plShare").disabled = cutting || !list.length || miss.length > 0;
    $("plNeed").hidden = !miss.length;
    $("plNeedTxt").innerHTML = "ยังไม่ได้เปิดไฟล์ " + miss.length + "/" + list.length + " ฉาก จากอัลบั้ม: <b>" + Object.keys(alb).map(function(a){ return U.esc(a) + " (" + alb[a] + ")"; }).join(", ") + "</b>"
      + "<br>วิธีเร็ว: กดปุ่มด้านล่าง → เข้าโฟลเดอร์ชื่ออัลบั้ม (มักอยู่ใน Movies หรือ DCIM) → กดค้างคลิปแรก → ⋮ → เลือกทั้งหมด → เลือก · แอพคัดเอาเฉพาะคลิปที่ใช้ให้เอง ทำทีละอัลบั้มได้";
    if(!cutting) U.msg("plShareMsg", !list.length ? "" : miss.length ? lastPick
      : done ? "ต่อไว้แล้ว " + cuts.marks.length + " ฉาก ยาว " + cuts.marks.reduce(function(t, m){ return t + m.len; }, 0).toFixed(1) + " วิ · ดูตัวอย่างด้านล่างก่อนแชร์ได้"
      : "ไฟล์ครบแล้ว กด ✂ แอพจะเล่นเฉพาะช่วงฉากเรียงตามบทแล้วอัดต่อกันเป็นวิดีโอเดียว (ใช้เวลา ≈ " + Math.round(list.reduce(function(t, x){ return t + (x.sc.e - x.sc.s); }, 0)) + " วิ · เปิดหน้าค้างไว้)", done && !miss.length ? "ok" : "");
    renderBatches();
  }
  var lastPick = "";
  document.addEventListener("ft:files", function(e){ /* footage-find.js ส่งมาหลังเลือกไฟล์ */
    if(!plan) return;
    var n = e.detail, list = picked(), got = list.filter(function(x){ return U.hasSrc(x.c); }).length;
    lastPick = "เลือกมา " + n + " ไฟล์ → ตรงกับแผน " + got + "/" + list.length + " ฉาก" + (got < list.length ? " · เปิดอัลบั้มที่เหลือต่อได้เลย (ของเดิมไม่หาย)" : "");
    renderShare();
  });
  $("plDocs").addEventListener("click", function(){ U.openFiles(true); });
  $("plGal").addEventListener("click", function(){ U.openFiles(false); });
  var say = function(t, k){ U.msg("plShareMsg", t, k); };
  $("plShare").addEventListener("click", async function(){
    var list = picked();
    if(!FT.stitch.ok()){ say("เบราว์เซอร์นี้อัดวิดีโอไม่ได้ ใช้ปุ่ม คัดลอกรายการ แทน", "err"); return; }
    if(cuts){ URL.revokeObjectURL(cuts.url); cuts = null; }
    cutting = true; renderShare(); $("plProg").hidden = false; $("plBar").style.width = "0";
    try{
      var r = await FT.stitch.make(list, function(i, x){
        say("กำลังอัดฉาก " + (i + 1) + "/" + list.length + " (" + x.c.album + " " + U.tm(x.sc.s) + "–" + U.tm(x.sc.e) + ") · อย่าสลับแอพ");
        $("plBar").style.width = (i / list.length * 100) + "%";
      }, say);
      cuts = { sig:sig(list), file:r.file, url:URL.createObjectURL(r.file), marks:r.marks };
      cutting = false; renderShare();
      say("เสร็จแล้ว " + r.marks.length + " ฉาก · " + (r.file.size / 1048576).toFixed(1) + " MB · " + (r.rate / 1e6).toFixed(1) + " Mbps (" + r.mime + ")" + (r.mime.indexOf("avc1") < 0 ? " · ไม่ใช่ H.264 ถ้า CapCut ไม่รับ บอกได้เลย" : "") + " · ดูตัวอย่างด้านล่างก่อนแชร์", "ok");
    }catch(err){ cutting = false; renderShare(); say("อัดไม่ได้: " + err.message + (document.hidden ? " (สลับแอพระหว่างอัด?)" : ""), "err"); }
    $("plProg").hidden = true;
  });
  $("plBatches").addEventListener("click", function(e){
    if(!cuts) return;
    if(e.target.closest("#plSave")) FT.stitch.save(cuts.file, say);
    else if(e.target.closest("#plSend")) FT.stitch.send(cuts.file, say);
  });
  $("plCopy").addEventListener("click", function(){
    var txt = plan.rows.map(function(r, k){ var ch = r.use && chosen(r), sc = ch && ch.c.scenes[ch.pk.si];
      return (k + 1) + ". " + r.line + "\n   → " + (sc ? ch.c.album + " · " + ch.c.name + " (" + U.capDur(ch.c.duration) + ") ฉาก " + U.tm(sc.s) + "–" + U.tm(sc.e) : "ไม่มีในคลัง: " + r.scene); }).join("\n");
    var b = this;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function(){ b.textContent = "คัดลอกแล้ว"; setTimeout(function(){ b.textContent = "คัดลอกรายการ"; }, 1500); })
      .catch(function(){ window.prompt("คัดลอกตรงนี้", txt); });
  });

  renderSrc();
  /* ดัชนีโหลดจาก IndexedDB หลังหน้าเปิด → วาดแผนเดิมเมื่อเข้าแท็บนี้ (render ตอนกดแท็บ) */
})();
