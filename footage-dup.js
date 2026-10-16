/* footage-dup.js — พับ "ตรวจฟุตซ้ำ" ในแท็บตั้งค่า: หาคลิปที่เป็นฟุตเดียวกันที่อัดหน้าจอซ้ำหลายรอบ (คนละไฟล์ แต่ฉากเหมือนกัน)
   วิธี: ทำลายนิ้วมือภาพ (dHash 64 บิต) ของรูปฉากที่เก็บไว้ (ไม่เรียก AI ไม่เสียเงิน) → จับคู่ฉากที่ต่างกัน ≤ T บิต ข้ามคลิป → คลิปที่ฉากซ้ำกันมากพอ = ซ้ำ
   → จัดกลุ่ม (union-find) แนะนำเก็บตัวที่ใหญ่/ยาวสุด · "ซ่อน" = c.hide (ค้นหา/ชิป/ผู้กำกับไม่เห็น ย้อนกลับได้ ไม่ลบไฟล์ในคลัง)
   แฮชเก็บที่ sc.h (hex 16 ตัว, "" = ภาพเรียบ/ดำ ข้าม) · โหลดหลัง footage-find.js */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U) return;
  var $ = function(id){ return document.getElementById(id); }, esc = U.esc;
  var T = 8, MIN_MATCH = 2, MIN_RATIO = 0.4, FLAT = 7; /* T = ต่างกันได้กี่บิต · MIN_MATCH/RATIO = ฉากซ้ำอย่างน้อยกี่ฉาก/สัดส่วนของคลิปที่เล็กกว่า · FLAT = ภาพเรียบเกินไป (ส่วนเบี่ยงเบนเกรย์) */
  var cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently:true }); cv.width = 9; cv.height = 8;
  var busy = false, groups = null;

  function load(src){ return new Promise(function(ok, no){ var i = new Image(); i.onload = function(){ ok(i); }; i.onerror = function(){ no(new Error("อ่านรูปไม่ได้")); }; i.src = src; }); }
  async function hashOf(src){ /* dHash: ย่อเป็น 9×8 เกรย์ เทียบพิกเซลซ้าย-ขวา → 64 บิต เก็บเป็น hex · ภาพเรียบเกินไปคืน "" */
    var img = await load(src); cx.drawImage(img, 0, 0, 9, 8);
    var d = cx.getImageData(0, 0, 9, 8).data, g = [], sum = 0, i, x, y;
    for(i = 0; i < 72; i++){ g[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10; sum += g[i]; }
    var mean = sum / 72, v = 0; for(i = 0; i < 72; i++) v += (g[i] - mean) * (g[i] - mean);
    if(Math.sqrt(v / 72) < FLAT) return "";
    var bits = ""; for(y = 0; y < 8; y++) for(x = 0; x < 8; x++) bits += g[y * 9 + x] < g[y * 9 + x + 1] ? "1" : "0";
    var hex = ""; for(i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }
  var POP = []; for(var p = 0; p < 256; p++){ var c = 0, q = p; while(q){ c += q & 1; q >>= 1; } POP[p] = c; }
  function ham(a, b){ var s = 0; for(var i = 0; i < 16; i += 2) s += POP[parseInt(a.substr(i, 2), 16) ^ parseInt(b.substr(i, 2), 16)]; return s; }

  async function ensureHashes(clips, onP){ /* เติม sc.h ให้ฉากที่ยังไม่มี แล้วบันทึกคลิปที่เปลี่ยน */
    var todo = 0, done = 0; clips.forEach(function(c){ c.scenes.forEach(function(sc){ if(sc.h === undefined && sc.thumb) todo++; }); });
    var dirty = {};
    for(var k = 0; k < clips.length; k++){ var c = clips[k];
      for(var i = 0; i < c.scenes.length; i++){ var sc = c.scenes[i]; if(sc.h !== undefined || !sc.thumb) continue;
        try{ sc.h = await hashOf(sc.thumb); }catch(err){ sc.h = ""; } dirty[c.id] = c; done++;
        if(done % 40 === 0){ onP(done, todo); await new Promise(function(r){ setTimeout(r, 0); }); } }
      if(Object.keys(dirty).length >= 30){ await FT.store.putMany(Object.keys(dirty).map(function(i){ return dirty[i]; })); dirty = {}; }
    }
    if(Object.keys(dirty).length) await FT.store.putMany(Object.keys(dirty).map(function(i){ return dirty[i]; }));
  }
  function analyze(clips){ /* → กลุ่มคลิปซ้ำ [{ keep, items:[{ c, match, of, ratio }] }] */
    var idx = [], buckets = {};
    clips.forEach(function(c, ci){ c.scenes.forEach(function(sc, si){ if(!sc.h) return; var n = idx.push({ ci:ci, si:si, h:sc.h }) - 1;
      for(var k = 0; k < 4; k++){ var key = k + sc.h.substr(k * 4, 4); (buckets[key] = buckets[key] || []).push(n); } }); });
    var pair = {}, seen = {}; /* pair["a|b"] = ฉากที่ซ้ำกันของแต่ละคลิป (sa = คลิป a, sb = คลิป b) */
    Object.keys(buckets).forEach(function(key){ var b = buckets[key]; if(b.length > 400) return; /* ถังใหญ่เกิน = ภาพทั่วไปที่หน้าตาคล้ายกันหมด ข้าม */
      for(var i = 0; i < b.length; i++) for(var j = i + 1; j < b.length; j++){ var A = idx[b[i]], B = idx[b[j]]; if(A.ci === B.ci) continue;
        var sk = Math.min(b[i], b[j]) + "," + Math.max(b[i], b[j]); if(seen[sk]) continue; seen[sk] = 1;
        if(ham(A.h, B.h) > T) continue;
        var lo = A.ci < B.ci ? A : B, hi = lo === A ? B : A, pk = lo.ci + "|" + hi.ci;
        var o = pair[pk] = pair[pk] || { a:lo.ci, b:hi.ci, sa:{}, sb:{} }; o.sa[lo.si] = 1; o.sb[hi.si] = 1; } });
    var par = clips.map(function(_, i){ return i; }); var find = function(x){ while(par[x] !== x){ par[x] = par[par[x]]; x = par[x]; } return x; };
    var links = [];
    Object.keys(pair).forEach(function(pk){ var o = pair[pk], na = Object.keys(o.sa).length, nb = Object.keys(o.sb).length, m = Math.min(na, nb), sm = Math.min(clips[o.a].scenes.length, clips[o.b].scenes.length), r = m / Math.max(1, sm);
      if((m >= MIN_MATCH && r >= MIN_RATIO) || m >= 5){ links.push({ a:o.a, b:o.b, m:m, r:r }); par[find(o.a)] = find(o.b); } });
    var gm = {}; links.forEach(function(l){ var root = find(l.a); (gm[root] = gm[root] || { ids:{}, links:[] }); gm[root].ids[l.a] = 1; gm[root].ids[l.b] = 1; gm[root].links.push(l); });
    return Object.keys(gm).map(function(r){ var g = gm[r], list = Object.keys(g.ids).map(function(i){ return clips[+i]; });
      list.sort(function(x, y){ return (y.duration || 0) - (x.duration || 0) || (y.size || 0) - (x.size || 0); }); /* เก็บตัวยาวสุด (ครอบคลุมฟุตมากสุด) ถ้าเท่ากันเอาไฟล์ใหญ่ */
      var best = {}; g.links.forEach(function(l){ var ia = clips[l.a].id, ib = clips[l.b].id; best[ia] = Math.max(best[ia] || 0, l.r); best[ib] = Math.max(best[ib] || 0, l.r); });
      return { keep:list[0], items:list.map(function(c){ return { c:c, ratio:best[c.id] || 0 }; }) }; })
      .sort(function(x, y){ return y.items.length - x.items.length; });
  }
  function gb(n){ return n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : (n / 1048576).toFixed(0) + " MB"; }
  function render(){
    var box = $("dupOut"); if(!groups){ box.innerHTML = ""; return; }
    var hidden = U.lib().filter(function(c){ return c.hide; });
    var dupClips = 0, bytes = 0; groups.forEach(function(g){ g.items.forEach(function(it){ if(it.c !== g.keep){ dupClips++; bytes += it.c.size || 0; } }); });
    box.innerHTML = (groups.length ? '<p class="hint"><b>พบ ' + groups.length + " กลุ่ม</b> · คลิปที่ซ้ำ " + dupClips + " คลิป (ราว " + gb(bytes) + ") · ตัวที่ติดป้าย \"เก็บ\" คือตัวที่ยาว/ครอบคลุมที่สุด</p>"
      + '<button class="btn" id="dupHideAll" style="width:100%">' + MWIcon("hide") + 'ซ่อนตัวที่ซ้ำทั้งหมด (' + dupClips + " คลิป)</button>"
      : '<p class="hint">ไม่พบฟุตซ้ำ (ที่ฉากเหมือนกัน ≥ 40%)</p>')
      + groups.map(function(g, gi){
        return '<div class="dupg"><div class="dupr">' + g.items.map(function(it){ var c = it.c, keep = c === g.keep;
          return '<div class="dupc' + (c.hide ? " off" : "") + '"><img src="' + (c.cover || "") + '" alt=""><b class="' + (keep ? "ok" : "bad") + '">' + (keep ? MWIcon("check") + "เก็บ" : c.hide ? "ซ่อนแล้ว" : "ซ้ำ") + "</b><span>" + esc(c.name.length > 22 ? c.name.slice(0, 20) + "…" : c.name) + "<br>" + U.capDur(c.duration) + " · " + gb(c.size || 0) + "<br>" + esc(c.album) + "</span></div>"; }).join("") + "</div>"
          + '<button class="btn ghost small" data-dg="' + gi + '" style="width:100%;margin-top:6px">' + (g.items.every(function(it){ return it.c === g.keep || it.c.hide; }) ? "↩ คืนตัวที่ซ่อนในกลุ่มนี้" : MWIcon("hide") + "ซ่อนตัวที่ซ้ำในกลุ่มนี้") + "</button></div>"; }).join("")
      + (hidden.length ? '<p class="hint" style="margin-top:12px">ซ่อนอยู่ทั้งหมด ' + hidden.length + ' คลิป (ไม่โผล่ในค้นหา/ผู้กำกับ · ไฟล์ในคลังยังอยู่)</p><button class="btn ghost small" id="dupShowAll" style="width:100%">↩ คืนทุกคลิปที่ซ่อน</button>' : "");
  }
  async function setHide(clips, on){
    clips.forEach(function(c){ if(on) c.hide = true; else delete c.hide; });
    await FT.store.putMany(clips); render(); if(U.search) U.search();
  }
  $("dupBtn").addEventListener("click", async function(){
    if(busy) return; busy = true; var b = this; b.disabled = true; var clips = U.lib().filter(function(c){ return c.status === "done"; });
    try{
      await ensureHashes(clips, function(d, t){ b.textContent = "กำลังทำลายนิ้วมือภาพ " + d + "/" + t + "..."; });
      b.textContent = "กำลังเทียบฉาก..."; await new Promise(function(r){ setTimeout(r, 20); });
      groups = analyze(clips); $("dupInfo").textContent = "ตรวจ " + clips.length + " คลิป · " + clips.reduce(function(t, c){ return t + c.scenes.length; }, 0) + " ฉาก";
    }catch(err){ $("dupInfo").textContent = "ตรวจไม่สำเร็จ: " + err.message; }
    b.disabled = false; b.innerHTML = MWIcon("repeat") + "ตรวจฟุตซ้ำอีกรอบ"; busy = false; render();
  });
  $("dupOut").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b || !groups) return;
    if(b.id === "dupHideAll"){ var all = []; groups.forEach(function(g){ g.items.forEach(function(it){ if(it.c !== g.keep) all.push(it.c); }); }); setHide(all, true); }
    else if(b.id === "dupShowAll"){ setHide(U.lib().filter(function(c){ return c.hide; }), false); }
    else if(b.dataset.dg !== undefined){ var g = groups[+b.dataset.dg], others = g.items.filter(function(it){ return it.c !== g.keep; }).map(function(it){ return it.c; });
      setHide(others, !others.every(function(c){ return c.hide; })); }
  });
  U.dupHash = hashOf; /* ให้เทสต์/ไฟล์อื่นใช้ */
})();
