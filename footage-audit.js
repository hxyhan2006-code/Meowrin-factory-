/* footage-audit.js — "ตรวจความแม่นของ AI" ในแท็บคลัง: สุ่มฉากจากดัชนีจริง โชว์รูป+ป้ายที่ AI ติดไว้ Han แตะเฉพาะข้อที่ผิด → สรุป % ถูกต่อหมวด
   ไม่เรียก AI ไม่เสียเงิน · ผลเก็บใน MWStore key mw_footage_audit_v1 (ขึ้น Drive รวมกับ mw_* อื่น) · โหลดหลัง footage-find.js (ใช้ FT.ui.show) */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U || !U.show) return;
  var $ = function(id){ return document.getElementById(id); }, esc = U.esc, tm = U.tm;
  var KEY = "mw_footage_audit_v1", N = 30;
  var FIELDS = [["ch", "ตัวละครผิด/ขาด"], ["em", "สีหน้า/อารมณ์ผิด"], ["ds", "คำอธิบายผิด"], ["cut", "ตัดฉากไม่พอดี"]];
  var NAME = { ch:"จำตัวละคร", em:"สีหน้า/อารมณ์", ds:"คำอธิบายฉาก", cut:"ตัดฉาก" };
  var log = MWStore.get(KEY, []), run = null; /* log = [{ k, ch, em, ds, cut, who:[ชื่อที่ AI ติดให้], fix, at }] · run = { list, i, flags, mine:[] } */
  function save(){ MWStore.set(KEY, log); }
  function keyOf(c, sc){ return c.id + "#" + Math.round(sc.s * 10); }
  function pick(){ /* ฉากที่มีป้ายและยังไม่เคยตรวจ สุ่ม N ฉาก */
    var done = {}; log.forEach(function(r){ done[r.k] = 1; }); var pool = [];
    U.lib().forEach(function(c){ if(c.status === "done") c.scenes.forEach(function(sc){ if(sc.ai && !done[keyOf(c, sc)]) pool.push({ c:c, sc:sc }); }); });
    for(var i = pool.length - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    return pool.slice(0, N);
  }
  function pct(a, f){ return a.length ? Math.round((a.length - a.filter(function(r){ return r[f]; }).length) / a.length * 100) : 0; }
  function summary(a, title){
    if(!a.length) return "";
    var bad = {}; a.forEach(function(r){ if(r.ch) r.who.forEach(function(w){ bad[w] = (bad[w] || 0) + 1; }); });
    var top = Object.keys(bad).sort(function(x, y){ return bad[y] - bad[x]; }).slice(0, 6), fixes = a.filter(function(r){ return r.ch && r.fix; }).slice(-6);
    return "<p class=\"hint\" style=\"margin-top:0\"><b>" + title + "</b> · " + a.length + " ฉาก</p><div class=\"stats\">"
      + Object.keys(NAME).map(function(f){ return '<div class="stat"><b>' + pct(a, f) + "%</b><span>" + NAME[f] + "ถูก</span></div>"; }).join("") + "</div>"
      + (top.length ? '<p class="hint">ตัวละครที่ AI ติดให้แล้วถูกบอกว่าผิดบ่อย: ' + top.map(function(w){ return esc(w) + " (" + bad[w] + ")"; }).join(", ") + "</p>" : "")
      + (fixes.length ? '<p class="hint">ที่ Han บอกว่าถูกคือ: ' + fixes.map(function(r){ return esc(r.who.join("+")) + " → " + esc(r.fix); }).join(" · ") + "</p>" : "");
  }
  function view(){
    var el = $("auditBox"), n = log.length;
    $("auditTag").textContent = n ? n + " ฉาก · ตัวละคร " + pct(log, "ch") + "%" : "ยังไม่เคยตรวจ";
    if(run && run.i < run.list.length){
      var h = run.list[run.i], c = h.c, sc = h.sc, a = sc.ai || {}, k = U.show(c, sc), who = (a.characters_th && a.characters_th.length ? a.characters_th : a.characters || []);
      el.innerHTML = '<p class="hint" style="margin-top:0">ฉากที่ ' + (run.i + 1) + "/" + run.list.length + " · แตะรูปเพื่อขยาย/เล่นดู · แตะเฉพาะข้อที่ AI <b>ผิด</b> (ไม่แตะ = ถูก)</p>"
        + '<img class="auditimg" src="' + (sc.img || sc.thumb) + '" data-k="' + k + '" alt="ฉากที่ตรวจ">'
        + '<p><b>ตัวละคร:</b> ' + (who.length ? esc(who.join(", ")) : "(AI ไม่ได้ระบุ)") + "<br><b>อารมณ์/การกระทำ:</b> " + esc([a.emotion, a.action].filter(Boolean).join(" · ") || "-")
        + "<br><b>คำอธิบาย:</b> " + esc(a.summary_th || "-") + "<br><b>ช่วง:</b> " + tm(sc.s) + "–" + tm(sc.e) + " (" + (sc.e - sc.s).toFixed(1) + " วิ) · " + esc(c.album) + "</p>"
        + '<div class="chips wrap">' + FIELDS.map(function(f){ return '<button class="chip' + (run.flags[f[0]] ? " bad" : "") + '" data-f="' + f[0] + '">' + (run.flags[f[0]] ? MWIcon("x") : "") + f[1] + "</button>"; }).join("") + "</div>"
        + (run.flags.ch ? '<input id="auditFix" type="text" placeholder="ที่ถูกคือใคร (ไม่บังคับ) เช่น โซโร, นามิ" autocomplete="off" value="' + esc(run.fix || "") + '">' : "")
        + '<div class="row" style="margin-top:12px"><button class="btn" id="auditNext">' + (run.i + 1 < run.list.length ? "ถัดไป ›" : MWIcon("check") + "จบ") + '</button><button class="btn ghost" id="auditSkip">ข้าม</button><button class="btn ghost" id="auditStop">หยุด</button></div>';
      return;
    }
    el.innerHTML = (run ? summary(run.mine, "ผลรอบนี้") + "<hr>" : "") + summary(log, "ผลรวมทุกรอบ")
      + '<p class="hint">สุ่ม ' + N + " ฉากจากดัชนี (ไม่เสียค่า AI) ใช้เวลาไม่กี่นาที · ยิ่งตรวจหลายรอบ ตัวเลขยิ่งน่าเชื่อ</p>"
      + '<button class="btn" id="auditGo" style="width:100%">' + (run ? "ตรวจอีกรอบ" : "เริ่มตรวจ") + " " + N + " ฉากสุ่ม</button>"
      + (log.length ? '<button class="btn ghost small" id="auditClear" style="width:100%;margin-top:8px">ล้างผลที่ตรวจไว้</button>' : "");
  }
  function commit(){ /* บันทึกผลฉากปัจจุบันแล้วไปฉากถัดไป */
    var h = run.list[run.i], a = h.sc.ai || {}, fx = $("auditFix"), f = run.flags;
    var r = { k:keyOf(h.c, h.sc), ch:!!f.ch, em:!!f.em, ds:!!f.ds, cut:!!f.cut, who:(a.characters_th && a.characters_th.length ? a.characters_th : a.characters || []).slice(0, 6), fix:fx ? fx.value.trim() : "", at:Date.now() };
    log.push(r); run.mine.push(r); save();
  }
  function next(){ run.i++; run.flags = {}; view(); }
  $("auditBox").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    if(b.id === "auditGo"){ var l = pick(); if(!l.length){ $("auditBox").innerHTML = '<p class="empty">ไม่มีฉากใหม่ให้ตรวจแล้ว</p>'; return; } run = { list:l, i:0, flags:{}, mine:[] }; view(); }
    else if(b.dataset.f){ var fx = $("auditFix"); run.fix = fx ? fx.value : run.fix; run.flags[b.dataset.f] = !run.flags[b.dataset.f]; view(); }
    else if(b.id === "auditNext"){ commit(); next(); }
    else if(b.id === "auditSkip") next();
    else if(b.id === "auditStop"){ run.i = run.list.length; view(); }
    else if(b.id === "auditClear"){ MWDialog.confirm("ล้างผลการตรวจทั้งหมด?", { ok:"ล้าง" }).then(function(ok){ if(ok){ log = []; run = null; save(); view(); } }); }
  });
  view();
})();
