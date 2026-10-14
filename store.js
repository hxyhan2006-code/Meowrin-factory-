/* store.js — ที่เก็บข้อมูลแอพ (ใช้ทั้งหน้าแอพหลักและหน้าฟุตเทจ) · โหลดเป็นสคริปต์แรก
   ของจริงอยู่ใน IndexedDB "mw_store_v1" (store "kv": key = ชื่อเดิม เช่น mw_history_v1, ค่า = ข้อความ JSON) จุได้หลาย GB ไม่ตันแบบ localStorage (~5 MB)
   อ่าน/เขียนแบบทันที (sync) ผ่านแคชในหน่วยความจำ แล้วเขียนลง IndexedDB ตามหลัง · เขียนสำเนาลง localStorage ด้วยถ้ายังพอ (เผื่อย้อนโค้ด)
   ครั้งแรก: คัดลอกทุก key mw_* จาก localStorage เข้ามา (ไม่ลบของเดิม) · ขอ storage.persist() กันเบราว์เซอร์ลบเองตอนเครื่องเต็ม
   หลายแท็บ (แอพหลัก + หน้าฟุตเทจ) อัปเดตกันผ่าน BroadcastChannel
   โหลดเสร็จค่อยโหลดสคริปต์ที่เหลือตามลำดับใน data-boot (สคริปต์อื่นเลยใช้ MWStore.get ได้ทันทีตอนเริ่ม) */
(function(){
  "use strict";
  var DB = "mw_store_v1", ST = "kv", MIG = "__migrated", mem = {}, db = null, dirty = {}, timer = 0, listeners = [];
  var bc = window.BroadcastChannel ? new BroadcastChannel("mw_store") : null;

  function idb(){
    return new Promise(function(ok, no){
      if(!window.indexedDB){ no(new Error("ไม่มี IndexedDB")); return; }
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore(ST); };
      r.onsuccess = function(){ ok(r.result); };
      r.onerror = function(){ no(r.error); };
    });
  }
  function readAll(d){
    return new Promise(function(ok, no){
      var out = {}, t = d.transaction(ST, "readonly"), c = t.objectStore(ST).openCursor();
      c.onsuccess = function(){ var x = c.result; if(x){ out[x.key] = x.value; x.continue(); } };
      t.oncomplete = function(){ ok(out); }; t.onerror = function(){ no(t.error); };
    });
  }
  function fromLocal(){ var o = {}; for(var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if(k && k.indexOf("mw_") === 0) o[k] = localStorage.getItem(k); } return o; }
  function flush(){
    timer = 0; if(!db) return;
    var keys = Object.keys(dirty); dirty = {}; if(!keys.length) return;
    try{
      var t = db.transaction(ST, "readwrite"), s = t.objectStore(ST);
      keys.forEach(function(k){ if(mem[k] == null) s.delete(k); else s.put(mem[k], k); });
      t.onerror = function(){ keys.forEach(function(k){ dirty[k] = 1; }); }; /* เขียนไม่ได้ (เครื่องเต็ม?) → ลองใหม่รอบหน้า */
    }catch(e){ keys.forEach(function(k){ dirty[k] = 1; }); }
  }
  function mark(k){ dirty[k] = 1; if(!timer) timer = setTimeout(flush, 0); }
  function local(k, s){ try{ if(s == null) localStorage.removeItem(k); else localStorage.setItem(k, s); }catch(e){ /* localStorage เต็ม: ไม่เป็นไร ของจริงอยู่ใน IndexedDB */ } }
  function emit(k){ listeners.forEach(function(fn){ try{ fn(k); }catch(e){} }); }

  var S = window.MWStore = {
    /* อ่านค่า (ได้สำเนาใหม่ทุกครั้งเหมือน JSON.parse(localStorage) เดิม) */
    get:function(k, d){ var s = mem[k]; if(s == null) return d; try{ return JSON.parse(s); }catch(e){ return d; } },
    set:function(k, v){ var s = JSON.stringify(v); if(s === undefined) return S.del(k); mem[k] = s; mark(k); local(k, s); if(bc) bc.postMessage({ k:k, s:s }); emit(k); return true; },
    del:function(k){ delete mem[k]; mark(k); local(k, null); if(bc) bc.postMessage({ k:k, s:null }); emit(k); return true; },
    keys:function(){ return Object.keys(mem); },
    raw:function(k){ return mem[k]; },              /* ข้อความ JSON ดิบ (ใช้ตอนสำรอง) */
    on:function(fn){ listeners.push(fn); },          /* มีค่าเปลี่ยน (ทั้งในแท็บนี้และแท็บอื่น) */
    flush:flush,
    mode:"local",                                    /* "idb" = ใช้ IndexedDB ได้ · "local" = ถอยไปใช้ localStorage อย่างเดียว */
    persisted:null,                                  /* true = เบราว์เซอร์สัญญาว่าจะไม่ลบเอง */
    info:function(){                                 /* { used, quota, persisted, mode } */
      var est = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({});
      return est.then(function(e){ return { used:e.usage || 0, quota:e.quota || 0, persisted:S.persisted, mode:S.mode }; });
    },
    persist:function(){
      if(!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
      return navigator.storage.persisted().then(function(p){ return p || navigator.storage.persist(); })
        .then(function(p){ S.persisted = !!p; return S.persisted; }).catch(function(){ return false; });
    }
  };
  if(bc) bc.onmessage = function(e){ var m = e.data || {}; if(!m.k) return; if(m.s == null) delete mem[m.k]; else mem[m.k] = m.s; emit(m.k); };
  function now(){ if(timer){ clearTimeout(timer); flush(); } }
  document.addEventListener("visibilitychange", function(){ if(document.hidden) now(); });
  window.addEventListener("pagehide", now); /* ปิด/รีโหลดหน้าก่อนครบรอบเขียน → เขียนทันที */

  S.ready = idb().then(function(d){
    db = d; S.mode = "idb";
    return readAll(d).then(function(all){
      if(!all[MIG]){ /* ครั้งแรก: ย้ายจาก localStorage */
        var loc = fromLocal(), t = d.transaction(ST, "readwrite"), s = t.objectStore(ST);
        Object.keys(loc).forEach(function(k){ all[k] = loc[k]; s.put(loc[k], k); });
        s.put(String(Date.now()), MIG);
        return new Promise(function(ok){ t.oncomplete = t.onerror = function(){ ok(all); }; });
      }
      return all;
    });
  }).then(function(all){ delete all[MIG]; mem = all; })
    .catch(function(){ S.mode = "local"; mem = fromLocal(); }) /* IndexedDB ใช้ไม่ได้ (โหมดส่วนตัว?) → ใช้ localStorage แบบเดิม */
    .then(function(){ S.persist(); });

  /* โหลดสคริปต์ที่เหลือตามลำดับหลังข้อมูลพร้อม */
  var me = document.currentScript, boot = me && me.dataset.boot ? me.dataset.boot.split(/\s+/).filter(Boolean) : [];
  S.ready.then(function(){
    boot.forEach(function(src){ var el = document.createElement("script"); el.src = src; el.async = false; document.body.appendChild(el); });
  });
})();
