/* version.js — เลขรุ่นของทั้งระบบ (หน้าหลัก + ฟุตเทจ + ซับ) ที่เดียว แสดงที่ท้ายแท็บตั้งค่า (#appVersion)
   แก้ด้วย `node bump-version.mjs X.Y` เท่านั้น (บวก ?v= ของทุกไฟล์ให้ตรงกันด้วย) · ไม่ต้องแสดงเลขรุ่นที่อื่นอีก */
(function(){
  "use strict";
  var VERSION = "5.4";
  var el = document.getElementById("appVersion");
  if(el) el.textContent = "Meowrin factory v" + VERSION;
})();
