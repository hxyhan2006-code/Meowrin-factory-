/* footage-cloud.js — คลังวิดีโอบนคลาวด์ (Cloudflare R2 ผ่าน r2.js) ของหน้าฟุตเทจ · โหลดหลัง footage.js (ใช้ FT.ui)
   โครงในคลัง: <อัลบั้ม>/<ชื่อไฟล์> (โฟลเดอร์ = อัลบั้ม) · คลิปในดัชนีจำตำแหน่งในคลังไว้ที่ c.r2
   - ตั้งค่าคีย์/ทดสอบ (แท็บตั้งค่า) · ดูไฟล์ในคลัง จับคู่กับดัชนี (ชื่อ+ขนาด) · เอาไฟล์ที่ยังไม่ทำดัชนีเข้าคิว · อัปไฟล์จากเครื่อง */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U || !window.R2) return;
  var $ = function(id){ return document.getElementById(id); };
  var VID = /\.(mp4|m4v|mov|webm|mkv|3gp)$/i, objs = null; /* objs = รายการในคลังล่าสุด */
  function base(k){ return k.slice(k.lastIndexOf("/") + 1); }
  function albumOf(k){ var i = k.indexOf("/"); return i > 0 ? k.slice(0, i) : "ไม่ระบุ"; }
  function gb(n){ return n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : (n / 1048576).toFixed(0) + " MB"; }
  function folder(a){ return !a || a === "ไม่ระบุ" ? "unsorted" : a.replace(/[\\/:*?"<>|#%]+/g, "_").trim() || "unsorted"; }

  FT.cloud = {
    ready:R2.ready,
    fetch:async function(q, onProg){ var b = await R2.get(q.key, onProg); return new File([b], q.info.name, { type:b.type || "video/mp4", lastModified:q.info.lastModified }); },
    upload:async function(c, file, onProg){
      if(!file) throw new Error("ไม่มีไฟล์ในเครื่องให้อัป");
      if(!objs) objs = await R2.list(); /* กันอัปซ้ำ: ไฟล์ชื่อ+ขนาดเดียวกันอยู่ในคลังแล้ว (เช่นเคยอัปไว้) → ผูกกับดัชนีเฉยๆ ไม่ส่งไฟล์ใหม่ */
      var same = objs.filter(function(o){ return o.size === file.size && VID.test(o.key); }), have = same.find(function(o){ return base(o.key) === file.name; }) || (same.length === 1 ? same[0] : null);
      if(have){ c.r2 = have.key; await FT.store.put(c); if(onProg) onProg(1); return have.key; }
      var key = folder(c.album) + "/" + file.name, clash = objs && objs.find(function(o){ return o.key === key && o.size !== file.size; });
      if(clash) key = folder(c.album) + "/" + file.name.replace(/(\.\w+)?$/, "_" + file.size + "$1"); /* ชื่อซ้ำแต่คนละไฟล์ → ต่อท้ายขนาด */
      MWBudget.r2Check(objs.reduce(function(t, o){ return t + o.size; }, 0), file.size); /* เพดานขนาดคลัง (budget.js) */
      await R2.put(key, file, onProg);
      c.r2 = key; await FT.store.put(c);
      if(objs && !objs.some(function(o){ return o.key === key; })) objs.push({ key:key, size:file.size, at:Date.now() });
      if(objs) MWBudget.r2Stat(objs.reduce(function(t, o){ return t + o.size; }, 0));
      return key;
    }
  };

  /* ---------- ตั้งค่า ---------- */
  function fill(){ var c = R2.cfg(); ["account", "bucket", "keyId", "secret", "endpoint", "region"].forEach(function(k){ var el = $("r2" + k[0].toUpperCase() + k.slice(1)); if(el) el.value = c[k] || ""; }); }
  function msg(id, t, kind){ U.msg(id, t, kind); }
  $("r2Save").addEventListener("click", async function(){
    var c = {}; ["account", "bucket", "keyId", "secret", "endpoint", "region"].forEach(function(k){ var el = $("r2" + k[0].toUpperCase() + k.slice(1)); c[k] = el ? el.value.trim() : ""; });
    c.account = c.account.replace(/^https?:\/\//, "").replace(/\.r2\.cloudflarestorage\.com.*$/, ""); /* วางลิงก์ endpoint มาทั้งเส้นก็ได้ */
    R2.setCfg(c); fill(); renderState();
    if(!R2.ready()){ msg("r2Msg", "บันทึกแล้ว แต่ยังกรอกไม่ครบ (Account ID, ชื่อ bucket, Access Key ID, Secret)", "err"); return; }
    msg("r2Msg", "กำลังทดสอบ...");
    try{ await R2.test(); msg("r2Msg", "เชื่อมคลังได้แล้ว", "ok"); listCloud(); }catch(err){ tag("err", "เชื่อมไม่ได้"); msg("r2Msg", "ยังเชื่อมไม่ได้: " + err.message, "err"); }
  });

  /* ---------- คลังบนคลาวด์ (แท็บทำดัชนี) ---------- */
  function tag(kind, text){ var el = $("tagR2"); el.className = "state " + kind; el.textContent = text; }
  function renderState(){
    var on = R2.ready();
    if(!on) tag("idle", "ยังไม่ตั้ง"); else if(!objs) tag("warn", "ยังไม่ได้เช็ก");
    $("cloudBox").hidden = !on; $("cloudOff").hidden = on;
    if(!on) return;
    if(!objs){ $("cloudInfo").textContent = "กด ดูไฟล์ในคลัง เพื่อเช็กว่ามีอะไรบ้าง"; $("cloudQueue").hidden = true; $("cloudAlbums").innerHTML = ""; return; }
    var lib = U.lib(), vids = objs.filter(function(o){ return VID.test(o.key); }), byKey = {}, byNs = {};
    lib.forEach(function(c){ if(c.r2) byKey[c.r2] = c; byNs[c.name + "|" + c.size] = c; });
    var todo = vids.filter(function(o){ var c = byKey[o.key] || byNs[base(o.key) + "|" + o.size]; return !c || c.status !== "done"; });
    var size = vids.reduce(function(t, o){ return t + o.size; }, 0), alb = {};
    vids.forEach(function(o){ var a = albumOf(o.key); alb[a] = alb[a] || { n:0, todo:0, size:0 }; alb[a].n++; alb[a].size += o.size; });
    todo.forEach(function(o){ alb[albumOf(o.key)].todo++; });
    tag("ok", vids.length + " คลิป · " + gb(size));
    var local = lib.filter(function(c){ return c.status === "done" && !c.r2; }).length;
    $("cloudInfo").textContent = "ในคลัง " + vids.length + " คลิป · " + gb(size) + " · ทำดัชนีแล้ว " + (vids.length - todo.length) + " · ยังไม่ทำ " + todo.length
      + (local ? " · ดัชนีที่ไฟล์ยังไม่อยู่ในคลัง " + local + " คลิป" : "");
    var files = {}; vids.forEach(function(o){ var a = albumOf(o.key); (files[a] = files[a] || []).push(o); });
    $("cloudAlbums").innerHTML = Object.keys(alb).sort().map(function(a){ var x = alb[a], fl = files[a].sort(function(p, q){ return q.at - p.at; });
      return '<li><details><summary><b>' + U.esc(a) + "</b> · " + x.n + " คลิป · " + gb(x.size) + (x.todo ? ' · <span style="color:var(--accent)">ยังไม่ทำดัชนี ' + x.todo + "</span>" : " · " + MWIcon("check") + "ครบ") + "</summary><ul class=\"cf\">"
        + fl.slice(0, 100).map(function(o){ var c = byKey[o.key] || byNs[base(o.key) + "|" + o.size], ok = c && c.status === "done";
            return "<li><span>" + U.esc(base(o.key)) + "</span><small>" + gb(o.size) + " · " + (ok ? MWIcon("check") + "ทำดัชนีแล้ว" : '<i style="color:var(--accent);font-style:normal">ยังไม่ทำ</i>') + "</small></li>"; }).join("")
        + (fl.length > 100 ? "<li><small>…และอีก " + (fl.length - 100) + " ไฟล์</small></li>" : "") + "</ul></details></li>"; }).join("");
    $("cloudQueue").hidden = !todo.length; $("cloudQueue").textContent = "เอาคลิปที่ยังไม่ทำเข้าคิว (" + todo.length + ")";
    $("cloudQueue").onclick = function(){
      var now = Date.now();
      U.addQueue(todo.map(function(o){ var n = base(o.key);
        return { file:null, key:o.key, id:n + "|" + o.size + "|" + o.at, album:albumOf(o.key), mode:"", status:"wait", err:"", p:0,
                 info:{ name:n, type:"video/mp4", size:o.size, lastModified:o.at, picked:now } }; }));
      msg("cloudMsg", "เข้าคิวแล้ว " + todo.length + " คลิป เลื่อนขึ้นไปกด เริ่มทำดัชนี (โหลดจากคลังทีละคลิป ใช้เน็ตตามขนาดไฟล์)", "ok");
    };
  }
  async function listCloud(){
    if(!R2.ready()) return;
    $("cloudList").disabled = true; $("cloudList").textContent = "กำลังดูรายการ..."; msg("cloudMsg", "กำลังขอรายการไฟล์จากคลัง...");
    var t0 = Date.now();
    try{
      objs = await R2.list(); MWBudget.r2Stat(objs.reduce(function(t, o){ return t + o.size; }, 0));
      /* จับคู่ดัชนีเดิม (ทำจากไฟล์ในเครื่อง) กับไฟล์ในคลังด้วยชื่อ+ขนาด → ต่อไปเล่นจากคลังได้เลย */
      var link = [], m = {}, bs = {}; objs.filter(function(o){ return VID.test(o.key); }).forEach(function(o){ m[base(o.key) + "|" + o.size] = o.key; bs[o.size] = bs[o.size] === undefined ? o.key : false; });
      (await FT.store.all()).forEach(function(c){ var k = m[c.name + "|" + c.size] || (!c.r2 && bs[c.size]); if(k && c.r2 !== k){ c.r2 = k; link.push(c); } }); /* ชื่อ+ขนาด หรือขนาดอย่างเดียวถ้าในคลังมีไฟล์ขนาดนั้นไฟล์เดียว (ชื่อจากตัวเลือกรูปเป็นเลข ไม่ตรงชื่อจริง) */ /* อ่านจากฐานจริง (ดัชนีในหน้าอาจยังโหลดไม่เสร็จ) */
      if(link.length) await FT.store.putMany(link);
      var hh = new Date().toLocaleTimeString("th-TH");
      msg("cloudMsg", "อัปเดตรายการแล้ว " + hh + " · พบ " + objs.length + " ไฟล์ (" + ((Date.now() - t0) / 1000).toFixed(1) + " วิ)" + (link.length ? " · จับคู่ดัชนีกับไฟล์ในคลังได้ " + link.length + " คลิป (เล่น/ต่อฉากจากคลังได้แล้ว ไม่ต้องเลือกไฟล์)" : ""), "ok");
      if(link.length) await U.refresh();
    }catch(err){ tag("err", "เชื่อมไม่ได้"); msg("cloudMsg", "ดูคลังไม่ได้: " + err.message, "err"); }
    $("cloudList").disabled = false; $("cloudList").textContent = "รีเฟรชรายการในคลัง"; renderState();
  }
  $("cloudList").addEventListener("click", listCloud);
  fill(); renderState();
  if(R2.ready()) setTimeout(listCloud, 800); /* เปิดหน้า → เช็กคลังให้เลย (หลังดัชนีโหลด) */
})();
