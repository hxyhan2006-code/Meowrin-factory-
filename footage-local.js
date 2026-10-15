/* footage-local.js — เก็บสำเนาคลิปไว้ในแอพ (OPFS = พื้นที่ส่วนตัวของเบราว์เซอร์ในมือถือ) ใช้พื้นที่ว่างของเครื่องแทนการสตรีมจากคลัง R2
   FT.local: ok/file(c)/put(c, blob)/pull(c)/clear/stat · footage-find fileOf() ใช้ file(c) ต่อจากไฟล์ที่ Han เลือกเอง → ดูฉาก/ตัดต่อ/ตรวจขั้นเทพอ่านจากเครื่อง
   ไฟล์ = ต้นฉบับเดิมทุกไบต์ (ไม่ลดขนาด) · ชื่อไฟล์ใน OPFS = v_<ขนาด>_<ชื่อ> · โหลดหลัง footage-cloud.js */
(function(){
  var $ = function(id){ return document.getElementById(id); }, U = FT.ui, cfg = FT.cfg;
  var can = !!(navigator.storage && navigator.storage.getDirectory && window.FileSystemFileHandle && FileSystemFileHandle.prototype.createWritable);
  var dir = null, map = {}, bySize = {}, total = 0, scanned = false, running = false, stop = false, msg = "";
  var CH = 8 * 1024 * 1024, SPARE = 2 * 1024 * 1024 * 1024; /* เขียนทีละ 8 MB · เผื่อที่ว่างไว้ 2 GB (หรือ 5% ถ้าโควตาน้อย) */
  function nm(c){ return "v_" + c.size + "_" + String(c.name || "clip").replace(/[^\w.\-฀-๿]/g, "_").slice(-80); }
  function gb(n){ return n < 1073741824 ? Math.round(n / 1048576) + " MB" : (n / 1073741824).toFixed(n < 10737418240 ? 2 : 1) + " GB"; }
  async function root(){ if(!dir) dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("clips", { create:true }); return dir; }
  async function scan(){
    map = {}; bySize = {}; total = 0;
    if(can){
      try{
        var d = await root(), bad = [];
        for await (var h of d.values()){
          if(h.kind !== "file") continue;
          var f = await h.getFile(), want = Number((/^v_(\d+)_/.exec(h.name) || [])[1]);
          if(f.size !== want){ bad.push(h.name); continue; } /* เขียนไม่จบ (ปิดแอพกลางคัน) → ลบทิ้ง */
          map[h.name] = f; bySize[f.size] = f; total += f.size;
        }
        for(var i = 0; i < bad.length; i++) await d.removeEntry(bad[i]).catch(function(){});
      }catch(e){ can = false; msg = "เปิดพื้นที่เก็บในแอพไม่ได้: " + (e.message || e); }
    }
    scanned = true;
  }
  function file(c){ return c && (map[nm(c)] || bySize[c.size]) || null; }
  async function room(){ try{ var e = await navigator.storage.estimate(); return { used:e.usage || 0, quota:e.quota || 0, free:Math.max(0, (e.quota || 0) - (e.usage || 0)) }; }catch(e){ return { used:0, quota:0, free:0 }; } }
  async function fits(size){ var r = await room(); if(r.quota && r.free < size + Math.min(SPARE, r.quota * 0.05)) throw new Error("พื้นที่ที่เบราว์เซอร์ให้เหลือไม่พอ (เหลือ " + gb(r.free) + ")"); }
  async function write(c, size, next, onP){ /* next() คืนก้อนถัดไป (Blob/Uint8Array) หรือ null เมื่อจบ */
    await fits(size);
    var d = await root(), name = nm(c), h = await d.getFileHandle(name, { create:true }), w = await h.createWritable(), done = 0, part;
    try{
      while((part = await next())){
        if(stop) throw new Error("หยุดแล้ว");
        await w.write(part); done += part.size !== undefined ? part.size : part.byteLength; if(onP) onP(done / size);
      }
      await w.close();
    }catch(err){ try{ await w.abort(); }catch(e){} await d.removeEntry(name).catch(function(){}); throw err; }
    var f = await h.getFile();
    if(f.size !== size){ await d.removeEntry(name).catch(function(){}); throw new Error("ไฟล์ไม่ครบ (" + f.size + "/" + size + ")"); }
    map[name] = f; bySize[f.size] = f; total += f.size;
    document.dispatchEvent(new CustomEvent("ft:files", { detail:0 })); /* แท็บผู้กำกับอัปเดตว่าไฟล์พร้อม */
    return f;
  }
  function put(c, blob, onP){ var o = 0; return write(c, blob.size, function(){ if(o >= blob.size) return null; var p = blob.slice(o, o + CH); o += CH; return p; }, onP); }
  async function pull(c, onP){ /* ดึงจากคลัง R2 (ขาออกจาก R2 ไม่คิดเงิน) เขียนลงเครื่องทีละก้อน ไม่กินแรม */
    await fits(c.size); /* เช็กก่อนโหลด ไม่เปลืองเน็ต */
    var res = await fetch(await R2.url(c.r2)); if(!res.ok) throw new Error("โหลดจากคลังไม่ได้ (" + res.status + ")");
    var rd = res.body.getReader();
    return write(c, c.size, async function(){ var x = await rd.read(); return x.done ? null : x.value; }, onP);
  }
  async function clear(){ var d = await root(); for(var k in map) await d.removeEntry(k).catch(function(){}); await scan(); }

  /* ---------- แผงในแท็บตั้งค่า ---------- */
  function todo(){ return U.lib().filter(function(c){ return c.status === "done" && !c.hide && c.r2 && !file(c); }); }
  async function render(){
    if(!can){ $("locInfo").textContent = msg || "เบราว์เซอร์นี้ยังไม่รองรับการเก็บไฟล์ในแอพ"; ["locPull", "locClear", "locKeep"].forEach(function(id){ $(id).disabled = true; }); $("locTag").textContent = "ใช้ไม่ได้"; return; }
    var r = await room(), done = U.lib().filter(function(c){ return c.status === "done" && !c.hide; }), have = done.filter(function(c){ return !!file(c); }).length;
    var per = false; try{ per = await navigator.storage.persisted(); }catch(e){}
    var t = todo(), need = t.reduce(function(s, c){ return s + (c.size || 0); }, 0);
    $("locInfo").textContent = "เก็บในเครื่องแล้ว " + have + "/" + done.length + " คลิป · ใช้ " + gb(total) + " · เบราว์เซอร์ให้ใช้ได้อีก " + (r.quota ? gb(r.free) : "ไม่ทราบ")
      + (per ? " · เก็บถาวร ✓" : " · ⚠ ยังไม่ได้สิทธิ์เก็บถาวร (เบราว์เซอร์อาจลบเองตอนเครื่องเต็ม แต่ไฟล์ในคลังยังอยู่)");
    $("locTag").className = "state " + (have ? "ok" : "idle"); $("locTag").textContent = have ? have + " คลิป · " + gb(total) : "ปิด";
    $("locKeep").checked = !!cfg.keepLocal;
    $("locPull").disabled = !running && !t.length;
    $("locPull").textContent = running ? "⏹ หยุด" : t.length ? "📥 ดึงจากคลังมาเก็บในเครื่อง " + t.length + " คลิป (" + gb(need) + ")" : "📥 คลิปในคลังอยู่ในเครื่องครบแล้ว";
    $("locClear").disabled = running || !Object.keys(map).length;
    if(!running) $("locMsg").textContent = msg;
  }
  $("locKeep").addEventListener("change", function(){ cfg.keepLocal = this.checked; FT.saveCfg(); });
  $("locPull").addEventListener("click", async function(){
    if(running){ stop = true; return; }
    if(!(FT.cloud && FT.cloud.ready())){ msg = "ยังไม่ได้ตั้งค่าคลัง R2"; render(); return; }
    var t = todo(), need = t.reduce(function(s, c){ return s + (c.size || 0); }, 0); if(!t.length) return;
    if(!window.confirm("ดึง " + t.length + " คลิป (" + gb(need) + ") จากคลังมาเก็บในมือถือ\nใช้ Wi-Fi นะ (โหลดจาก R2 ไม่เสียเงิน) · เปิดหน้านี้ค้างไว้ · หยุดแล้วกดใหม่ทำต่อได้")) return;
    running = true; stop = false; msg = ""; var ok = 0, fail = 0, got = 0, wl = null;
    try{ if("wakeLock" in navigator) wl = await navigator.wakeLock.request("screen"); }catch(e){}
    render();
    for(var i = 0; i < t.length && !stop; i++){
      var c = t[i];
      try{ await pull(c, function(p){ $("locMsg").textContent = "คลิป " + (i + 1) + "/" + t.length + " · " + c.name + " " + Math.round(p * 100) + "% · เสร็จแล้ว " + gb(got); }); ok++; got += c.size; }
      catch(err){ if(stop) break; fail++; msg = c.name + ": " + (err.message || err); if(/พื้นที่/.test(msg)) break; }
    }
    try{ if(wl) await wl.release(); }catch(e){}
    msg = (stop ? "หยุดแล้ว" : "เสร็จรอบนี้") + ": เก็บเพิ่ม " + ok + " คลิป (" + gb(got) + ")" + (fail ? " · ไม่สำเร็จ " + fail + " (" + msg + ")" : "");
    running = false; stop = false; render();
  });
  $("locClear").addEventListener("click", async function(){
    if(!window.confirm("ลบสำเนาคลิปในแอพทั้งหมด " + gb(total) + "?\nไฟล์ในคลัง R2 และไฟล์ในแกลเลอรี่ไม่โดนลบ")) return;
    await clear(); msg = "ลบสำเนาในเครื่องแล้ว"; document.dispatchEvent(new CustomEvent("ft:files", { detail:0 })); render();
  });
  $("locFold").addEventListener("toggle", function(){ if(this.open) render(); });

  FT.local = { ok:function(){ return can; }, file:file, put:put, pull:pull, clear:clear, stat:function(){ return { n:Object.keys(map).length, bytes:total, scanned:scanned }; } };
  scan().then(function(){ render(); if(total) document.dispatchEvent(new CustomEvent("ft:files", { detail:0 })); });
})();
