/* voicestore.js (window.MWVoice) — เก็บเทคเสียงพากย์ล่าสุดไว้ใน IndexedDB `mw_voice_v1` store `takes` ให้หน้าฟุตเทจ (แท็บผู้กำกับ) ใช้ต่อ
   แยกจาก MWStore เพราะเป็นไฟล์เสียง (Blob) ไม่ควรเข้าไฟล์สำรอง Drive · tts.js เขียนหลังสร้างเสียงทุกเทค · เก็บแค่ KEEP เทคล่าสุด
   record = { id, at, text, name, blob (mp3), align?:{ chars, st[], en[] } } · align = เวลาเริ่ม/จบของทุกตัวอักษร (ไม่รวมช่องว่าง) ของ "บท" เทียบกับต้นไฟล์ blob */
(function(){
  "use strict";
  var DB = "mw_voice_v1", ST = "takes", KEEP = 6, dbp = null;
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
      return run("readwrite", function(s){ a.slice(KEEP).forEach(function(r){ s.delete(r.id); }); return null; });
    }).then(function(){ return rec.id; });
  }
  window.MWVoice = { list:list, get:get, put:put };
})();
