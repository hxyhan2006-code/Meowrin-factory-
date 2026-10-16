/* dialog.js (window.MWDialog) — กล่องโต้ตอบของแอพเอง แทน confirm/alert/prompt ของเบราว์เซอร์ (ใช้ทั้งหน้าหลักและหน้าฟุตเทจ)
   confirm(ข้อความ, {ok, cancel}) → Promise<true/false> · alert(ข้อความ) → Promise · copy(ข้อความ) = ช่องให้กดค้างคัดลอกเอง (ใช้ตอนคัดลอกอัตโนมัติไม่ได้)
   สไตล์ใส่เองในไฟล์นี้ (ใช้ตัวแปรสีจาก :root ของทั้งสองหน้า) · Esc หรือแตะพื้นหลัง = ยกเลิก */
(function(){
  "use strict";
  var css = ".mwd{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.72)}"
    + ".mwd[hidden]{display:none}"
    + ".mwd-box{width:100%;max-width:420px;background:var(--surface,#141417);border:1px solid var(--line-strong,rgba(255,255,255,.14));border-radius:16px;padding:18px;color:var(--text,#f4f4f5);font:15px/1.55 'IBM Plex Sans Thai',system-ui,sans-serif}"
    + ".mwd-msg{margin:0 0 16px;white-space:pre-line;overflow-wrap:anywhere}"
    + ".mwd-txt{display:block;width:100%;box-sizing:border-box;min-height:140px;margin:0 0 16px;padding:10px;border-radius:10px;border:1px solid var(--line,rgba(255,255,255,.08));background:var(--field,#1c1c21);color:inherit;font:inherit;resize:vertical}"
    + ".mwd-row{display:flex;gap:10px}"
    + ".mwd-btn{flex:1;min-height:46px;border-radius:12px;border:1px solid var(--line-strong,rgba(255,255,255,.14));background:var(--field,#1c1c21);color:inherit;font:inherit;font-weight:500;cursor:pointer}"
    + ".mwd-btn.ok{background:var(--accent,#39d98a);border-color:var(--accent,#39d98a);color:var(--accent-ink,#06120b);font-weight:600}";
  var root = null, msg, txt, row, done = null;
  function build(){
    if(root) return;
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    root = document.createElement("div"); root.className = "mwd"; root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
    root.innerHTML = '<div class="mwd-box"><p class="mwd-msg"></p><textarea class="mwd-txt" readonly hidden></textarea><div class="mwd-row"></div></div>';
    document.body.appendChild(root);
    msg = root.querySelector(".mwd-msg"); txt = root.querySelector(".mwd-txt"); row = root.querySelector(".mwd-row");
    root.addEventListener("click", function(e){ if(e.target === root) close(false); });
    document.addEventListener("keydown", function(e){ if(e.key === "Escape" && done) close(false); });
  }
  function close(v){ var f = done; done = null; root.hidden = true; if(f) f(v); }
  function open(message, buttons, text){
    build(); if(done) close(false); /* ซ้อนกันไม่ได้: อันเก่าถือว่ายกเลิก */
    return new Promise(function(res){
      done = res; msg.textContent = message; txt.hidden = text == null; if(text != null) txt.value = text;
      row.innerHTML = ""; buttons.forEach(function(b){
        var el = document.createElement("button"); el.type = "button"; el.className = "mwd-btn" + (b.ok ? " ok" : ""); el.textContent = b.t;
        el.addEventListener("click", function(){ close(b.ok); }); row.appendChild(el);
      });
      root.hidden = false;
      if(text != null){ txt.focus(); txt.select(); } else row.lastChild.focus();
    });
  }
  window.MWDialog = {
    confirm: function(message, o){ o = o || {}; return open(message, [{ t:o.cancel || "ยกเลิก", ok:false }, { t:o.ok || "ตกลง", ok:true }]); },
    alert: function(message){ return open(message, [{ t:"ตกลง", ok:true }]); },
    copy: function(text){ return open("คัดลอกอัตโนมัติไม่ได้ กดค้างที่ช่องแล้วเลือกคัดลอกเอง", [{ t:"ปิด", ok:true }], text); }
  };
})();
