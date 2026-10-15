/* footage-pick.js — "เลือกฉากไปทำวิดีโอ" ในแท็บคลัง: กดโหมดเลือก → การ์ดฉากมีช่องติ๊ก → ถาดล่างรวมฉากที่เลือก (เรียง/ลบได้) → ต่อเป็นวิดีโอเดียว → แชร์ CapCut/บันทึกลงเครื่อง
   ที่เลือกไว้เก็บที่ MWStore key mw_footage_pick_v1 ([{ id, si }] = คลิป + ลำดับฉาก) ติดไว้ข้ามการค้นหา · ใช้ FT.stitch (footage-stitch.js) · โหลดหลัง footage-plan.js */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U || !FT.stitch) return;
  var $ = function(id){ return document.getElementById(id); }, esc = U.esc, tm = U.tm;
  var KEY = "mw_footage_pick_v1", sel = MWStore.get(KEY, []), mode = false, map = {}, out = null, making = false;
  var SHARE_MAX = 49 * 1048576, origCache = {}, origBusy = false; /* origCache = คลิปต้นฉบับที่โหลดจากคลังมาเตรียมแชร์ (id → File) · แชร์ต้องแตะแล้วแชร์ทันที จึงโหลดให้เสร็จก่อน */
  function save(){ MWStore.set(KEY, sel); }
  function keyOf(c, sc){ return c.id + "#" + c.scenes.indexOf(sc); }
  function resolve(){ /* [{ c, si, sc, lines }] เฉพาะฉากที่ยังอยู่ในดัชนี */
    var lib = U.lib(), r = [];
    sel.forEach(function(x){ var c = lib.find(function(y){ return y.id === x.id; }), sc = c && c.scenes[x.si]; if(sc) r.push({ c:c, si:x.si, sc:sc, lines:[r.length + 1] }); });
    return r;
  }
  /* ---------- ต้นฉบับทั้งคลิป: แชร์/บันทึก/คัดลอกรายการช่วงเวลา (ไม่ต้องต่อวิดีโอ) ---------- */
  function origs(l){ var m = [], seen = {}; l.forEach(function(x){ var o = seen[x.c.id]; if(!o){ o = seen[x.c.id] = { c:x.c, rs:[] }; m.push(o); } o.rs.push(x.sc); }); return m; }
  function ranges(o){ return o.rs.map(function(sc){ return tm(sc.s) + "–" + tm(sc.e); }).join(", "); }
  function mb(n){ return (n / 1048576).toFixed(1); }
  async function getFile(c, onp){ var f = origCache[c.id] || U.fileFor(c); if(f) return f;
    if(c.r2 && FT.cloud && FT.cloud.ready()) return FT.cloud.fetch({ key:c.r2, info:{ name:c.name, lastModified:c.lastModified } }, onp);
    throw new Error("ไม่มีไฟล์ " + c.name); }
  function origHtml(l){
    var o = origs(l), total = o.reduce(function(t, x){ return t + (x.c.size || 0); }, 0), miss = o.some(function(x){ return !U.hasSrc(x.c); }), fit = o.length <= 10 && total <= SHARE_MAX;
    var ready = o.every(function(x){ return origCache[x.c.id] || U.fileFor(x.c); }), dis = origBusy || miss ? " disabled" : "";
    var net = o.filter(function(x){ return !(origCache[x.c.id] || U.fileFor(x.c)); }).reduce(function(t, x){ return t + (x.c.size || 0); }, 0);
    return '<hr><h2 style="font-size:16px">หรือ: หาเองใน CapCut (ไม่ใช้เน็ต)</h2><p class="hint" style="margin-top:0">' + o.length + " คลิป · เปิด CapCut เลือกคลิปจากแกลเลอรีที่รูปปกและความยาวตรงกับด้านล่าง แล้วตัดตามช่วงเวลา · ได้ไฟล์ต้นฉบับเต็มคุณภาพ ไม่ต้องรออัด</p>"
      + o.map(function(x){ return '<div class="pkrow"><div class="cvr"><img src="' + (x.c.cover || "") + '" alt="ปก"><em>' + U.capDur(x.c.duration) + '</em></div><div class="t"><b>' + esc(x.c.name) + "</b><span>" + esc(x.c.album) + " · ตัดช่วง " + ranges(x) + "</span></div></div>"; }).join("")
      + '<button class="btn ghost small" id="pickOCopy" style="width:100%;margin-top:10px">คัดลอกรายการช่วงเวลา</button>'
      + '<p class="hint" style="margin-top:14px">หรือส่งไฟล์ต้นฉบับให้เลย · ' + (net ? "⚠ ต้องโหลดจากคลัง ≈ " + mb(net) + " MB (แนะนำต่อ Wi-Fi)" : "ไฟล์อยู่ในเครื่องแล้ว ไม่ต้องโหลด") + " · รวม " + mb(total) + " MB</p>"
      + '<button class="btn ghost" id="pickOShare" style="width:100%"' + (fit ? dis : " disabled") + ">" + (fit ? (ready ? "📤 แชร์คลิปต้นฉบับไป CapCut" : "⬇ โหลดจากคลังให้พร้อมแชร์ (" + mb(total) + " MB)") : "📤 แชร์ไม่ได้ (ลิมิตแชร์ ≤10 คลิป รวม ≤50 MB)") + "</button>"
      + '<button class="btn ghost" id="pickOSave" style="width:100%;margin-top:8px"' + dis + ">💾 บันทึกคลิปต้นฉบับลงเครื่อง (ไม่จำกัดจำนวน/ขนาด)</button>"
      + (fit ? "" : '<p class="hint">ปุ่มแชร์ของเบราว์เซอร์มือถือจำกัด ≤10 ไฟล์ รวม ≤50 MB ต่อครั้ง แก้ไม่ได้จากในแอพ · ใช้ 💾 บันทึกลงเครื่อง หรือเลือกจากแกลเลอรีใน CapCut ตามรายการด้านบน (บันทึกหลายไฟล์ เบราว์เซอร์อาจถามขออนุญาต กดอนุญาต)</p>');
  }
  function sig(l){ return l.map(function(x){ return x.c.id + "#" + x.si; }).join(","); }
  function secs(l){ return l.reduce(function(t, x){ return t + (x.sc.e - x.sc.s); }, 0); }

  /* ช่องติ๊กบนการ์ด (footage-find.js เรียกผ่าน U.pickHtml) */
  U.pickHtml = function(c, sc){
    if(!mode) return ""; var k = keyOf(c, sc); map[k] = { c:c, sc:sc };
    return '<label class="chk pk"><input type="checkbox" data-pk="' + esc(k) + '"' + (sel.some(function(x){ return x.id === c.id && x.si === c.scenes.indexOf(sc); }) ? " checked" : "") + "> เลือกฉากนี้</label>";
  };
  document.querySelector("main").addEventListener("change", function(e){
    var cb = e.target.closest("[data-pk]"), h = cb && map[cb.dataset.pk]; if(!h) return;
    var si = h.c.scenes.indexOf(h.sc), i = sel.findIndex(function(x){ return x.id === h.c.id && x.si === si; });
    if(cb.checked && i < 0) sel.push({ id:h.c.id, si:si }); else if(!cb.checked && i >= 0) sel.splice(i, 1);
    save(); bar(); if(!$("pickSheet").hidden) sheet();
  });
  $("pickMode").addEventListener("click", function(){
    mode = !mode; this.textContent = mode ? "✔ เสร็จการเลือก (ปิดช่องติ๊ก)" : "☑ เลือกฉากไปทำวิดีโอ";
    $("pickHint").hidden = !mode; if(U.search) U.search();
  });

  function bar(){
    var l = resolve(); $("pickBar").hidden = !l.length; document.body.classList.toggle("hasbar", !!l.length);
    $("pickInfo").textContent = "🎬 เลือกแล้ว " + l.length + " ฉาก · ≈ " + Math.round(secs(l)) + " วิ";
  }
  function sheet(){ /* ถาดรายการฉากที่เลือก + ผลลัพธ์ */
    var l = resolve(), miss = l.filter(function(x){ return !U.hasSrc(x.c); }), ok = out && out.sig === sig(l);
    if(!l.length){ $("pickSheet").hidden = true; bar(); return; }
    $("pickList").innerHTML = l.map(function(x, i){
      var a = x.sc.ai || {};
      return '<div class="pkrow"><img src="' + x.sc.thumb + '" alt=""><div class="t"><b>' + (i + 1) + ". " + esc(x.c.album) + " · " + tm(x.sc.s) + "–" + tm(x.sc.e) + " (" + (x.sc.e - x.sc.s).toFixed(1) + " วิ)</b><span>" + esc(a.summary_th || "") + (U.hasSrc(x.c) ? "" : " ⚠ ยังไม่มีไฟล์") + "</span></div>"
        + '<div class="mv"><button data-up="' + i + '" aria-label="ขึ้น"' + (i ? "" : " disabled") + '>▲</button><button data-dn="' + i + '" aria-label="ลง"' + (i < l.length - 1 ? "" : " disabled") + '>▼</button><button data-rm="' + i + '" aria-label="เอาออก">✕</button></div></div>';
    }).join("");
    $("pickTotal").textContent = l.length + " ฉาก · ≈ " + Math.round(secs(l)) + " วิ (เรียงตามรายการนี้)";
    $("pickMake").textContent = ok ? "✂ ทำใหม่อีกรอบ" : "✂ ต่อ " + l.length + " ฉากเป็นวิดีโอเดียว"; $("pickMake").disabled = making || miss.length > 0 || !FT.stitch.ok();
    $("pickNeed").hidden = !miss.length; $("pickNeedTxt").textContent = "ยังไม่มีไฟล์ " + miss.length + " ฉาก (ไม่อยู่ในคลังคลาวด์ และยังไม่ได้เปิดไฟล์ในเครื่อง)";
    $("pickOut").innerHTML = ok ? '<video class="plvid" src="' + out.url + '" controls playsinline></video>'
      + '<button class="btn" id="pickSend" style="width:100%;margin-top:10px">แชร์ไป CapCut (1 ไฟล์ · ' + (out.file.size / 1048576).toFixed(1) + " MB)</button>"
      + '<button class="btn ghost" id="pickSave" style="width:100%;margin-top:8px">💾 บันทึกไฟล์ลงเครื่อง</button>'
      + '<p class="hint">จุดเริ่มของแต่ละฉากในไฟล์ (แยกคลิปใน CapCut ตรงเวลาเหล่านี้):</p><ol class="marks">'
      + out.marks.map(function(m){ return "<li><b>" + m.at.toFixed(1) + " วิ</b> · ฉาก " + m.lines.join(",") + " · " + esc(m.c.album) + " " + tm(m.sc.s) + " (" + m.len.toFixed(1) + " วิ)</li>"; }).join("") + "</ol>" : "";
    $("pickOrig").innerHTML = origHtml(l);
    $("pickSheet").hidden = false;
  }
  var say = function(t, k){ U.msg("pickMsg", t, k); };
  $("pickOpen").addEventListener("click", function(){ sheet(); });
  $("pickX").addEventListener("click", function(){ $("pickSheet").hidden = true; });
  $("pickClear").addEventListener("click", function(){ if(!window.confirm("ล้างฉากที่เลือกทั้งหมด?")) return; sel = []; save(); if(out){ URL.revokeObjectURL(out.url); out = null; } bar(); sheet(); if(mode && U.search) U.search(); });
  $("pickFiles").addEventListener("click", function(){ U.openFiles(true); });
  document.addEventListener("ft:files", function(){ if(!$("pickSheet").hidden) sheet(); }); /* เลือกไฟล์เพิ่มแล้ว ตรวจใหม่ว่าฉากไหนพร้อม */
  $("pickList").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return; var d = b.dataset, i;
    if(d.rm !== undefined){ sel.splice(+d.rm, 1); }
    else if(d.up !== undefined){ i = +d.up; sel.splice(i - 1, 0, sel.splice(i, 1)[0]); }
    else if(d.dn !== undefined){ i = +d.dn; sel.splice(i + 1, 0, sel.splice(i, 1)[0]); }
    else return;
    save(); bar(); sheet(); if(mode && U.search) U.search(); /* ติ๊กบนการ์ดให้ตรงกับที่เหลือ */
  });
  $("pickMake").addEventListener("click", async function(){
    var l = resolve(); if(!l.length || making) return;
    if(out){ URL.revokeObjectURL(out.url); out = null; }
    making = true; sheet(); $("pickProg").hidden = false; $("pickBarP").style.width = "0";
    try{
      var r = await FT.stitch.make(l, function(i, x){
        say("กำลังอัดฉาก " + (i + 1) + "/" + l.length + " (" + x.c.album + " " + tm(x.sc.s) + "–" + tm(x.sc.e) + ") · อย่าสลับแอพ");
        $("pickBarP").style.width = (i / l.length * 100) + "%";
      }, say);
      out = { sig:sig(l), file:r.file, url:URL.createObjectURL(r.file), marks:r.marks };
      say("เสร็จแล้ว " + r.marks.length + " ฉาก · " + (r.file.size / 1048576).toFixed(1) + " MB · ดูตัวอย่างก่อนแชร์ได้", "ok");
    }catch(err){ say("อัดไม่ได้: " + err.message + (document.hidden ? " (สลับแอพระหว่างอัด?)" : ""), "err"); }
    making = false; $("pickProg").hidden = true; sheet();
  });
  $("pickOut").addEventListener("click", function(e){
    if(!out) return;
    if(e.target.closest("#pickSave")) FT.stitch.save(out.file, say);
    else if(e.target.closest("#pickSend")) FT.stitch.send(out.file, say);
  });
  $("pickOrig").addEventListener("click", async function(e){
    var b = e.target.closest("button"); if(!b || origBusy) return; var l = resolve(), o = origs(l);
    if(b.id === "pickOCopy"){
      var txt = o.map(function(x, i){ return (i + 1) + ". " + x.c.name + " (" + x.c.album + ") · " + ranges(x); }).join("\n");
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function(){ b.textContent = "คัดลอกแล้ว"; setTimeout(function(){ b.textContent = "คัดลอกรายการช่วงเวลา"; }, 1500); }).catch(function(){ window.prompt("คัดลอกตรงนี้", txt); });
      return;
    }
    if(b.id === "pickOShare"){
      if(o.every(function(x){ return origCache[x.c.id] || U.fileFor(x.c); })){ FT.stitch.send(o.map(function(x){ return origCache[x.c.id] || U.fileFor(x.c); }), say); return; } /* พร้อมแล้ว → แชร์ทันที (ต้องอยู่ในจังหวะแตะ) */
      origBusy = true; sheet();
      try{ for(var i = 0; i < o.length; i++){ var c = o[i].c; if(origCache[c.id] || U.fileFor(c)) continue;
            origCache[c.id] = await getFile(c, function(p){ say("โหลดคลิป " + (i + 1) + "/" + o.length + " จากคลัง " + Math.round(p * 100) + "%"); }); }
        say("โหลดครบแล้ว กด 📤 แชร์คลิปต้นฉบับไป CapCut อีกครั้ง", "ok"); }
      catch(err){ say("โหลดไม่ได้: " + err.message, "err"); }
      origBusy = false; sheet(); return;
    }
    if(b.id === "pickOSave"){
      origBusy = true; sheet();
      try{ for(var j = 0; j < o.length; j++){ var f = await getFile(o[j].c, function(p){ say("โหลดคลิป " + (j + 1) + "/" + o.length + " " + Math.round(p * 100) + "%"); }); FT.stitch.save(f, function(){}); await new Promise(function(ok){ setTimeout(ok, 600); }); }
        say("สั่งบันทึกแล้ว " + o.length + " คลิป ดูในโฟลเดอร์ Download (ถ้าเบราว์เซอร์ถามขออนุญาตดาวน์โหลดหลายไฟล์ ให้กดอนุญาต) แล้วเลือกจากแกลเลอรีใน CapCut · ช่วงเวลาที่ต้องตัดดูในรายการด้านบน", "ok"); }
      catch(err){ say("บันทึกไม่ได้: " + err.message, "err"); }
      origBusy = false; sheet();
    }
  });
  bar();
})();
