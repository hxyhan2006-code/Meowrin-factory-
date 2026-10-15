/* voicestore.js (window.MWVoice) — เก็บเทคเสียงพากย์ล่าสุดไว้ใน IndexedDB `mw_voice_v1` store `takes` ให้หน้าฟุตเทจ (แท็บผู้กำกับ) ใช้ต่อ
   + สำรองขึ้นคลัง R2 (ถ้าตั้งค่าคลังไว้ ใช้ r2.js): voice/<id>.mp3 + voice/<id>.json {text,name,align} เก็บ CKEEP เทคล่าสุดในคลัง · ดึงกลับมาเครื่องได้ (pull)
   แยกจาก MWStore เพราะเป็นไฟล์เสียง (Blob) ไม่ควรเข้าไฟล์สำรอง Drive · tts.js เขียนหลังสร้างเสียงทุกเทค · เก็บแค่ KEEP เทคล่าสุด
   record = { id, at, text, name, blob (mp3), align?:{ chars, st[], en[] } } · align = เวลาเริ่ม/จบของทุกตัวอักษร (ไม่รวมช่องว่าง) ของ "บท" เทียบกับต้นไฟล์ blob */
(function(){
  "use strict";
  var DB = "mw_voice_v1", ST = "takes", KEEP = 50, CKEEP = 50, PFX = "voice/", dbp = null;
  function open(){
    if(!dbp) dbp = new Promise(function(ok, no){
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function(){ r.result.createObjectStore(ST, { keyPath:"id" }); };
      r.onsuccess = function(){ ok(r.result); }; r.onerror = function(){ no(r.error); };
    });
    return dbp;
  }
  function run(mode, fn){ /* fn(store) → IDBRequest ที่ผลลัพธ์จะถูกคืน */
    return open().then(function(db){ return new Promise(function(ok, no){
      var t = db.transaction(ST, mode), req = fn(t.objectStore(ST));
      t.oncomplete = function(){ ok(req ? req.result : undefined); }; t.onerror = t.onabort = function(){ no(t.error); };
    }); });
  }
  function list(){ return run("readonly", function(s){ return s.getAll(); }).then(function(a){ return (a || []).sort(function(x, y){ return y.id - x.id; }); }); }
  function get(id){ return run("readonly", function(s){ return s.get(id); }); }
  function put(rec){
    rec.id = rec.id || Date.now();
    return run("readwrite", function(s){ return s.put(rec); }).then(list).then(function(a){
      return run("readwrite", function(s){ a.slice(KEEP).forEach(function(r){ if(r.id !== rec.id) s.delete(r.id); }); return null; }); /* เทคที่เพิ่งเขียน/ดึงมาไม่ถูกตัดทิ้ง */
    }).then(function(){ return rec.id; });
  }
  /* ---------- สำรองบนคลัง R2 ---------- */
  function cloudOn(){ return !!(window.R2 && R2.ready()); }
  function ck(id, ext){ return PFX + id + "." + ext; }
  async function cloudList(){ /* [{ id, size }] ในคลัง ใหม่สุดก่อน */
    var by = {}; (await R2.list(PFX)).forEach(function(o){ var m = /^voice\/(\d+)\.(mp3|json)$/.exec(o.key); if(m && m[2] === "mp3") by[m[1]] = { id:+m[1], size:o.size }; });
    return Object.keys(by).map(function(k){ return by[k]; }).sort(function(a, b){ return b.id - a.id; });
  }
  async function cloudDel(id){ await Promise.all(["mp3", "json"].map(function(e){ return R2.del(ck(id, e)).catch(function(){}); })); }
  async function cloudPut(rec){ /* อัป mp3 + ข้อมูล (บท/ชื่อ/เวลาตัวอักษร) แล้วทำเครื่องหมาย rec.cloud · เกิน CKEEP ลบตัวเก่าในคลัง */
    if(!cloudOn()) return false;
    await R2.put(ck(rec.id, "mp3"), new File([rec.blob], rec.id + ".mp3", { type:"audio/mpeg" }));
    await R2.put(ck(rec.id, "json"), new File([JSON.stringify({ id:rec.id, text:rec.text, name:rec.name, align:rec.align || null })], rec.id + ".json", { type:"application/json" }));
    rec.cloud = true; await run("readwrite", function(s){ return s.put(rec); });
    cloudList().then(function(a){ return Promise.all(a.slice(CKEEP).map(function(x){ return cloudDel(x.id); })); }).catch(function(){});
    return true;
  }
  async function pull(id){ /* ดึงจากคลังมาเก็บในเครื่อง */
    var mp3 = await R2.get(ck(id, "mp3")), meta = {};
    try{ meta = JSON.parse(await (await R2.get(ck(id, "json"))).text()); }catch(err){}
    var rec = { id:+id, text:meta.text || "", name:meta.name || id + ".mp3", blob:new Blob([mp3], { type:"audio/mpeg" }), align:meta.align || null, cloud:true };
    await put(rec); return rec;
  }
  function del(id){ return run("readwrite", function(s){ return s.delete(id); }); }
  window.MWVoice = { list:list, get:get, put:put, del:del, cloudOn:cloudOn, cloudList:cloudList, cloudPut:cloudPut, cloudDel:cloudDel, pull:pull };
})();
