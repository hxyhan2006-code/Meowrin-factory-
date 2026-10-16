/* gdrive.js — สำรอง/กู้คืนขึ้น Google Drive ของ Han (ใช้ทั้งหน้าแอพหลักและหน้าฟุตเทจ) · โหลดหลัง store.js
   ล็อกอินด้วย Google Identity Services (token อายุ ~1 ชม. อยู่ในหน่วยความจำ ไม่เก็บลงเครื่อง) · scope drive.file = เห็นเฉพาะไฟล์ที่แอพนี้สร้าง
   โฟลเดอร์ "meowrin factory" บน Drive:
     - meowrin-data.json = ข้อมูลแอพจาก MWStore ทุก key mw_* ยกเว้น API key (สำรองเองทุกครั้งที่ข้อมูลเปลี่ยน ระหว่างที่ยังเชื่อมอยู่)
     - footage/clip_*.json = ดัชนีฟุตเทจ 1 ไฟล์ต่อคลิป (appProperties cid = แฮช id, sig = แฮชเวอร์ชัน) อัปเฉพาะคลิปใหม่/เปลี่ยน
   ตั้งค่าอยู่ใน MWStore key mw_gdrive_v1 { client, ok, last, lastFoot } */
(function(){
  "use strict";
  var KEY = "mw_gdrive_v1", SCOPE = "https://www.googleapis.com/auth/drive.file", API = "https://www.googleapis.com/drive/v3", UP = "https://www.googleapis.com/upload/drive/v3";
  var FOLDER = "meowrin factory", DATA = "meowrin-data.json", SKIP = /^mw_(key|openrouter_key|gemini_key|groq_key|eleven_key|gemini_last|gdrive|r2)_v1$/;
  var $ = function(id){ return document.getElementById(id); };
  var cfg = MWStore.get(KEY, {}) || {}, tok = null, tokExp = 0, tc = null, folders = {}, dirty = false, timer = 0, busy = false, lastErr = "";
  function saveCfg(){ MWStore.set(KEY, cfg); }

  /* ---------- ล็อกอิน ---------- */
  function gis(){
    if(window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function(ok, no){
      var s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = ok; s.onerror = function(){ no(new Error("โหลดระบบล็อกอิน Google ไม่ได้ (เน็ต?)")); }; document.head.appendChild(s);
    });
  }
  function ready(){ return !!tok && Date.now() < tokExp - 60000; }
  function connect(){ /* ต้องเรียกจากการแตะปุ่มตรงๆ (เบราว์เซอร์บล็อกป๊อปอัปถ้าไม่ใช่) */
    return new Promise(function(ok, no){
      if(!cfg.client){ no(new Error("ยังไม่ได้ใส่ Client ID (ตั้งค่าในแอพหลัก)")); return; }
      if(!(window.google && google.accounts && google.accounts.oauth2)){ gis().then(function(){ no(new Error("ระบบล็อกอินเพิ่งโหลดเสร็จ กดปุ่มอีกครั้ง")); }, no); return; }
      tc = google.accounts.oauth2.initTokenClient({ client_id:cfg.client, scope:SCOPE,
        callback:function(r){
          if(r.error){ no(new Error(r.error_description || r.error)); return; }
          tok = r.access_token; tokExp = Date.now() + (r.expires_in || 3600) * 1000; cfg.ok = true; saveCfg(); render(); ok();
          if(dirty) later();
        },
        error_callback:function(e){ no(new Error(e && e.type === "popup_closed" ? "ปิดหน้าล็อกอินไปก่อน" : (e && e.message) || "ล็อกอินไม่สำเร็จ")); }
      });
      tc.requestAccessToken({ prompt:cfg.ok ? "" : "consent" });
    });
  }

  /* ---------- Drive API ---------- */
  async function api(url, opt){
    if(!ready()) throw new Error("ยังไม่ได้เชื่อม Google Drive (หรือหมดเวลา) กด เชื่อม ใหม่");
    opt = opt || {}; opt.headers = Object.assign({ Authorization:"Bearer " + tok }, opt.headers || {});
    var r = await fetch(url, opt);
    if(r.status === 401){ tok = null; render(); throw new Error("หมดเวลาเชื่อม Drive กด เชื่อม ใหม่"); }
    if(!r.ok){ var t = ""; try{ t = (await r.json()).error.message; }catch(e){} throw new Error("Drive " + r.status + (t ? ": " + t : "")); }
    return r;
  }
  function q(s){ return encodeURIComponent(s); }
  async function folder(name, parent){ /* หา/สร้างโฟลเดอร์ (เห็นเฉพาะที่แอพสร้างเอง) */
    var k = (parent || "") + "/" + name; if(folders[k]) return folders[k];
    var w = "name='" + name.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false" + (parent ? " and '" + parent + "' in parents" : "");
    var j = await (await api(API + "/files?q=" + q(w) + "&fields=files(id)&spaces=drive")).json();
    if(j.files && j.files.length) return (folders[k] = j.files[0].id);
    var c = await (await api(API + "/files?fields=id", { method:"POST", headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ name:name, mimeType:"application/vnd.google-apps.folder", parents:parent ? [parent] : undefined }) })).json();
    return (folders[k] = c.id);
  }
  async function list(parent, extra){ /* ทุกไฟล์ในโฟลเดอร์ (ไล่หน้า) */
    var out = [], page = "";
    do{
      var j = await (await api(API + "/files?q=" + q("'" + parent + "' in parents and trashed=false" + (extra || "")) + "&pageSize=1000&fields=nextPageToken,files(id,name,appProperties,description,modifiedTime,size)" + (page ? "&pageToken=" + page : ""))).json();
      out = out.concat(j.files || []); page = j.nextPageToken || "";
    }while(page);
    return out;
  }
  async function upload(meta, body, id){ /* resumable: ไฟล์ใหญ่ก็ได้ · id = อัปทับไฟล์เดิม */
    var r = await api(UP + "/files" + (id ? "/" + id : "") + "?uploadType=resumable&fields=id", { method:id ? "PATCH" : "POST",
      headers:{ "Content-Type":"application/json; charset=UTF-8", "X-Upload-Content-Type":"application/json" }, body:JSON.stringify(meta) });
    var loc = r.headers.get("Location"); if(!loc) throw new Error("Drive ไม่ให้ที่อัปโหลด");
    var p = await fetch(loc, { method:"PUT", headers:{ "Content-Type":"application/json" }, body:body });
    if(!p.ok) throw new Error("อัปโหลดไม่สำเร็จ (" + p.status + ")");
    return (await p.json()).id;
  }
  async function download(id){ return (await api(API + "/files/" + id + "?alt=media")).text(); }

  /* ---------- ข้อมูลแอพ (MWStore) ---------- */
  async function backupData(){
    var kv = {}; MWStore.keys().forEach(function(k){ if(k.indexOf("mw_") === 0 && !SKIP.test(k)) kv[k] = MWStore.raw(k); });
    var body = JSON.stringify({ app:"meowrin", v:1, at:Date.now(), kv:kv }), root = await folder(FOLDER);
    var f = (await list(root, " and name='" + DATA + "'"))[0];
    await upload(f ? {} : { name:DATA, parents:[root] }, body, f && f.id);
    dirty = false; lastErr = ""; cfg.last = Date.now(); saveCfg(); render();
    return { keys:Object.keys(kv).length, kb:body.length / 1024 };
  }
  async function restoreData(){
    var root = await folder(FOLDER), f = (await list(root, " and name='" + DATA + "'"))[0];
    if(!f) throw new Error("ยังไม่มีไฟล์สำรองบน Drive");
    var j = JSON.parse(await download(f.id)); if(!j || j.app !== "meowrin" || !j.kv) throw new Error("ไฟล์บน Drive ไม่ใช่ไฟล์สำรองของแอพนี้");
    Object.keys(j.kv).forEach(function(k){ if(!SKIP.test(k)){ try{ MWStore.set(k, JSON.parse(j.kv[k])); }catch(e){} } });
    MWStore.flush(); dirty = false;
    return { keys:Object.keys(j.kv).length, at:j.at };
  }
  function later(){ /* สำรองเองหลังข้อมูลเปลี่ยน (รวบหลายการเปลี่ยนเป็นครั้งเดียว) */
    if(timer || !ready()) return;
    timer = setTimeout(function(){ timer = 0; if(busy || !dirty || !ready()) return; busy = true;
      backupData().catch(function(err){ lastErr = "สำรองอัตโนมัติไม่สำเร็จ: " + err.message; show(lastErr, "err"); }).then(function(){ busy = false; render(); }); }, 20000);
  }
  MWStore.on(function(k){ if(k.indexOf("mw_") === 0 && !SKIP.test(k)){ dirty = true; later(); } });

  /* ---------- ดัชนีฟุตเทจ (IndexedDB mw_footage_v1 ผ่าน window.FT) ---------- */
  function h32(s, seed){ var h = seed >>> 0; for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }
  function cid(c){ return h32(c.id, 2166136261) + h32(c.id, 3421674724); }
  var SIGF = ["อัลบั้ม", "รุ่นรูป", "จำนวนฉาก", "at", "สถานะ"];
  function comp(c){ return [c.album, c.imgV || 1, c.scenes.length, c.at || 0, c.status].join("|"); } /* ส่วนประกอบของลายเซ็น (เก็บใน description ของไฟล์บน Drive ไว้บอกสาเหตุว่าเปลี่ยนตรงไหน) */
  function sig(c){ return h32(comp(c), 2166136261); }
  function plan(lib, files, fmap){ /* คลิปไหนต้องอัป: ไม่มีบน Drive = ใหม่ · ลายเซ็นไม่ตรง = เปลี่ยน (นับสาเหตุ) · ไฟล์ซ้ำของคลิปเดียวกัน เลือกอันที่ลายเซ็นตรงก่อน */
    var byId = {}, have = {}, dups = 0, cur = {};
    lib.forEach(function(c){ cur[cid(c)] = sig(c); });
    files.forEach(function(f){ byId[f.id] = f; var a = f.appProperties || {}; if(!a.cid) return;
      var h = { id:f.id, sig:a.sig, desc:f.description || "" }, old = have[a.cid];
      if(old){ dups++; if(old.sig === cur[a.cid] || h.sig !== cur[a.cid]) return; } /* ซ้ำ: คงอันที่ตรงไว้ */
      have[a.cid] = h; });
    var fresh = 0, changed = 0, why = {}, todo = [];
    lib.forEach(function(c){ if(c.status !== "done") return; var k = cid(c), h = have[k], sg = sig(c);
      if(!h && fmap[k] && byId[fmap[k].id]) h = have[k] = { id:fmap[k].id, sig:fmap[k].sig, desc:"" }; /* Drive ไม่ส่ง appProperties กลับมา → เชื่อบันทึกในเครื่องว่าไฟล์นี้อัปด้วยลายเซ็นนี้แล้ว */
      if(h && h.sig === sg) return;
      if(!h) fresh++; else { changed++; var o = h.desc.split("|"), n = comp(c).split("|"), hit = false;
        SIGF.forEach(function(nm, i){ if(o.length === n.length && o[i] !== n[i]){ why[nm] = (why[nm] || 0) + 1; hit = true; } }); if(!hit) why["ไม่ทราบ"] = (why["ไม่ทราบ"] || 0) + 1; }
      todo.push(c); });
    return { todo:todo, have:have, fresh:fresh, changed:changed, why:why, dups:dups };
  }
  async function pool(items, n, fn){ var i = 0; await Promise.all(Array.from({ length:Math.min(n, items.length) }, async function(){ while(i < items.length){ var x = items[i++]; await fn(x); } })); }
  async function backupFootage(lib, onProg){
    var dir = await folder("footage", await folder(FOLDER)), fmap = cfg.fmap || (cfg.fmap = {});
    var p = plan(lib, await list(dir), fmap), have = p.have, todo = p.todo, done = 0;
    onProg(0, todo.length, p);
    await pool(todo, 3, async function(c){
      var k = cid(c), h = have[k], meta = { appProperties:{ cid:k, sig:sig(c) }, description:comp(c) };
      if(!h){ meta.name = "clip_" + c.name.replace(/[^\w.\-]+/g, "_").slice(0, 60) + "_" + k.slice(0, 6) + ".json"; meta.parents = [dir]; }
      fmap[k] = { id:await upload(meta, JSON.stringify(c), h && h.id), sig:sig(c) }; done++; onProg(done, todo.length, p);
      if(done % 25 === 0) saveCfg(); /* ค้างกลางทางก็ไม่ต้องเริ่มใหม่ทั้งหมด */
    });
    cfg.lastFoot = Date.now(); saveCfg(); render();
    return { up:todo.length, fresh:p.fresh, changed:p.changed, why:p.why, dups:p.dups, total:Object.keys(have).length + p.fresh };
  }
  function whyText(r){ var w = Object.keys(r.why).map(function(k){ return k + " " + r.why[k]; }).join(", "); return "ใหม่ " + r.fresh + " · เปลี่ยน " + r.changed + (w ? " (" + w + ")" : "") + (r.dups ? " · ไฟล์ซ้ำบน Drive " + r.dups : ""); }
  var footNow = async function(){
    if(!window.FT || !FT.ui) throw new Error("ดัชนียังโหลดไม่เสร็จ");
    var r = await backupFootage(FT.ui.lib(), function(d, n, p){ show("กำลังอัปดัชนี " + d + "/" + n + " คลิป · " + whyText(p)); });
    return r.up ? "อัปขึ้น Drive แล้ว " + r.up + " คลิป (" + whyText(r) + ") · บน Drive มีทั้งหมด " + r.total : "บน Drive ครบแล้ว ไม่มีคลิปใหม่";
  };
  bind("gdFootNow", footNow); bind("gdFootQuick", footNow);
  bind("gdFootRestore", async function(){
    if(!window.FT || !FT.ui) throw new Error("ดัชนียังโหลดไม่เสร็จ");
    var r = await restoreFootage(await FT.store.all(), FT.store.putMany, /* อ่านจากฐานจริง ไม่ใช่รายการที่แคชในหน้า */ function(d, n){ show("กำลังดึงดัชนีจาก Drive " + d + "/" + n + " คลิป..."); });
    if(r.n) setTimeout(function(){ location.reload(); }, 1200);
    return r.n ? "ดึงกลับมาแล้ว " + r.n + " คลิป กำลังโหลดใหม่..." : "ในเครื่องมีครบแล้ว";
  });
  if(cfg.client) gis().catch(function(){}); /* โหลดไว้ก่อน ให้ปุ่มเชื่อมเปิดป๊อปอัปได้ทันทีตอนแตะ */
  render(); setInterval(render, 60000);

  window.MWDrive = {
    ready:ready, connect:connect, backupData:backupData,
    autoFootage:function(){ /* หน้าฟุตเทจเรียกหลังทำดัชนีเสร็จ: ถ้ายังเชื่อมอยู่ อัปคลิปใหม่ให้เลย */
      if(!ready() || busy || !window.FT || !FT.ui) return;
      busy = true; render();
      backupFootage(FT.ui.lib(), function(d, n){ show("สำรองดัชนีขึ้น Drive " + d + "/" + n + "..."); })
        .then(function(r){ lastErr = ""; show(r.up ? "สำรองดัชนีขึ้น Drive แล้ว " + r.up + " คลิป" : "", "ok"); }, function(err){ lastErr = "สำรองดัชนีไม่สำเร็จ: " + err.message; show(lastErr, "err"); })
        .then(function(){ busy = false; render(); });
    }
  };
})();
