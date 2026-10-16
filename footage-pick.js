/* footage-pick.js — ชีตเลือกของแอพเอง (FT.pick.open) ใช้ร่วมกัน: ตัวกรองอัลบั้ม/ตัวละคร/จำนวนคนในแท็บคลัง + เลือกอัลบั้มตอนเปลี่ยนชื่อ
   หน้าตา: ชีตเลื่อนขึ้นจากล่าง · ช่องพิมพ์ค้นหาบนสุด · รายการแถวใหญ่ (ติ๊กเขียวเมื่อเลือก) · ปุ่มล้าง/เสร็จ · ไม่ใช้ select/datalist ของเบราว์เซอร์
   open({ title, placeholder, icon, multi, search:false = ซ่อนช่องค้นหา, items(q) → [{k,name,sub,desc,on,icon}] (desc = บรรทัดเล็กใต้ชื่อ), onPick(k), onClear? }) — ผู้เรียกกรองตามคำค้น q เอง (ภาษาไทย/ชื่อพ้อง) */
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
  var cur = null;
  function render(){
    if(!cur) return;
    var list = $("pkList"), top = list.scrollTop, items = cur.items($("pkQ").value.trim().toLowerCase());
    list.innerHTML = items.map(function(it){ return '<button type="button" class="alrow' + (it.on ? " on" : "") + '" data-k="' + esc(it.k) + '">' + MWIcon(it.on ? "check" : it.icon || cur.icon || "folder") + (it.desc ? '<span class="tx"><b>' + esc(it.name) + "</b><small>" + esc(it.desc) + "</small></span>" : "<b>" + esc(it.name) + "</b>") + (it.sub ? "<i>" + esc(it.sub) + "</i>" : "") + "</button>"; }).join("") || '<p class="hint">ไม่เจอที่ค้นหา</p>';
    list.scrollTop = top;
    var n = cur.count ? cur.count() : -1; $("pkInfo").textContent = n < 0 ? "" : "เจอ " + n + " ฉาก"; $("pkInfo").classList.toggle("zero", n === 0); /* ผลลัพธ์สดตามที่เลือกอยู่ */
  }
  function close(){ $("pkSheet").hidden = true; cur = null; }
  function open(opt){
    cur = opt; $("pkTitle").textContent = opt.title; $("pkQ").placeholder = opt.placeholder || "พิมพ์เพื่อค้นหา"; $("pkQ").value = ""; $("pkQ").hidden = opt.search === false;
    $("pkClear").hidden = !opt.onClear; $("pkDone").textContent = opt.multi ? "เสร็จ" : "ปิด";
    render(); $("pkSheet").hidden = false; $("pkList").scrollTop = 0;
  }
  $("pkList").addEventListener("click", function(e){ var b = e.target.closest("[data-k]"); if(!b || !cur) return; var c = cur; c.onPick(b.dataset.k); if(!c.multi) close(); else render(); });
  $("pkQ").addEventListener("input", render);
  $("pkClear").addEventListener("click", function(){ if(cur && cur.onClear){ cur.onClear(); render(); } });
  $("pkDone").addEventListener("click", close);
  $("pkSheet").addEventListener("click", function(e){ if(e.target === this) close(); });
  window.FT.pick = { open:open, refresh:render };
})();
