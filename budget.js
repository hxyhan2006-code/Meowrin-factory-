/* budget.js — เพดานค่าใช้จ่ายของทั้งสองหน้า (แอพหลัก + ฟุตเทจ) · โหลดหลัง store.js ก่อนสคริปต์อื่น
   - เพดาน AI ต่อวัน/ต่อเดือน (USD) ถึงแล้วหยุดเรียก OpenRouter ทุกฟีเจอร์ (ทำบท/วางแผน/ค้นหา/ทำดัชนี)
   - เพดานขนาดคลัง R2 (GB) ถึงแล้วไม่อัปเพิ่ม (กันบั๊กอัปวน)
   ยอดที่ใช้ = ค่าที่มากกว่าระหว่าง (ยอดที่แอพนับเองจากทั้งสองหน้า) กับ (ยอดจริงจาก OpenRouter GET /api/v1/key ซึ่งรวมทุกการใช้ key)
   ⚠ เป็นลิมิตในแอพเท่านั้น กันบั๊ก/ใช้เพลินได้ แต่ไม่กันคีย์หลุด → ลิมิตแข็งจริงคือเครดิตเติมล่วงหน้าของ OpenRouter และ Budget Alert ของ Cloudflare
   ตั้งค่า mw_budget_v1 { aiDay, aiMonth, r2GB } (0 = ไม่จำกัด) · บัญชี mw_spend_v1 { day, d, month, m, real:{d,w,m,at}, r2:{bytes,at} } */
(function(){
  "use strict";
  var CFG = "mw_budget_v1", LEDGER = "mw_spend_v1", THB = 35, R2_FREE_GB = 10, R2_USD_GB = 0.015;
  var $ = function(id){ return document.getElementById(id); };
  function cfg(){ var c = MWStore.get(CFG, null) || {}; return { aiDay:num(c.aiDay, 5), aiMonth:num(c.aiMonth, 15), r2GB:num(c.r2GB, 150) }; }
  function num(x, d){ return typeof x === "number" && x >= 0 ? x : d; }
  function dayKey(){ var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function pad(n){ return String(n).padStart(2, "0"); }
  function ledger(){
    var l = MWStore.get(LEDGER, null) || {}, dk = dayKey(), mk = dk.slice(0, 7);
    if(l.day !== dk){ l.day = dk; l.d = 0; }
    if(l.month !== mk){ l.month = mk; l.m = 0; }
    return l;
  }
  function real(){ var r = ledger().real; return r && Date.now() - r.at < 36e5 ? r : null; } /* ยอดจริงที่ดึงมาภายใน 1 ชม. */
  function spent(){ /* ยอดจริงล่าสุด + ที่แอพใช้เพิ่มหลังดึงยอดจริง (sr) เทียบกับยอดที่แอพนับเอง เอาค่ามากกว่า (กันประเมินต่ำ) */
    var l = ledger(), r = real(), sr = r ? l.sr || 0 : 0;
    return { d:Math.max(l.d || 0, r ? r.d + sr : 0), m:Math.max(l.m || 0, r ? r.m + sr : 0), real:r };
  }
  function money(x){ return "$" + (x < 0.1 ? x.toFixed(3) : x.toFixed(2)); }

  /* ก่อนเรียก OpenRouter ทุกครั้ง: เกินเพดาน → โยน error (budget:true ให้คิวทำดัชนีพักแทนการนับเป็น error) */
  function check(){
    var c = cfg(), s = spent();
    if(c.aiDay && s.d >= c.aiDay) throw Object.assign(new Error("ถึงเพดานค่า AI วันนี้แล้ว (" + money(s.d) + " / " + money(c.aiDay) + ") ปรับได้ที่ ตั้งค่า → งบและค่าใช้จ่าย"), { budget:true });
    if(c.aiMonth && s.m >= c.aiMonth) throw Object.assign(new Error("ถึงเพดานค่า AI เดือนนี้แล้ว (" + money(s.m) + " / " + money(c.aiMonth) + ") ปรับได้ที่ ตั้งค่า → งบและค่าใช้จ่าย"), { budget:true });
  }
  function add(usd){ if(!(usd > 0)) return; var l = ledger(); l.d = (l.d || 0) + usd; l.m = (l.m || 0) + usd; l.sr = (l.sr || 0) + usd; MWStore.set(LEDGER, l); soon(); }

  /* ยอดจริงจาก OpenRouter (รวมทุกการใช้ key นี้ เวลา UTC) · ดึงไม่ได้ = ใช้ยอดที่แอพนับเอง */
  var t = 0;
  async function refresh(){
    var key = MWStore.get("mw_openrouter_key_v1", ""); if(!key) return null;
    try{
      var res = await fetch("https://openrouter.ai/api/v1/key", { headers:{ "Authorization":"Bearer " + key } });
      var d = (await res.json()).data, ok = function(x){ return typeof x === "number"; };
      if(res.ok && d && ok(d.usage_daily) && ok(d.usage_weekly) && ok(d.usage_monthly)){
        var l = ledger(); l.real = { d:d.usage_daily, w:d.usage_weekly, m:d.usage_monthly, at:Date.now() }; l.sr = 0; MWStore.set(LEDGER, l); return l.real;
      }
    }catch(err){}
    return null;
  }
  function soon(){ clearTimeout(t); t = setTimeout(refresh, 2500); } /* รอให้ OpenRouter อัปเดตยอดสักครู่ */

  /* คลัง R2 */
  function r2Stat(bytes){ var l = ledger(); l.r2 = { bytes:bytes, at:Date.now() }; MWStore.set(LEDGER, l); }
  function r2Check(totalBytes, addBytes){
    var c = cfg(); if(!c.r2GB) return;
    var after = (totalBytes + addBytes) / 1073741824;
    if(after > c.r2GB) throw Object.assign(new Error("คลังจะเกินเพดาน " + c.r2GB + " GB (ตอนนี้ " + (totalBytes / 1073741824).toFixed(1) + " GB) ไม่อัปไฟล์นี้ · ปรับเพดานได้ที่ ตั้งค่า → งบและค่าใช้จ่าย ในแอพหลัก"), { budget:true });
  }
  function r2Cost(gb){ return Math.max(0, gb - R2_FREE_GB) * R2_USD_GB; }

  /* ---------- แผงตั้งค่า (มีในหน้าไหนก็ผูกให้: #bgDay #bgMonth #bgR2 #bgInfo #bgTag) ---------- */
  function pct(a, b){ return b ? a / b : 0; }
  function kind(p){ return p >= 0.9 ? "err" : p >= 0.5 ? "warn" : "ok"; }
  function pill(k, text){ return '<span class="pill ' + k + '">' + text + "</span>"; }
  function row(label, k, text, extra){ return '<div class="strow"><span>' + label + "</span>" + pill(k, text) + (extra ? "<small>" + extra + "</small>" : "") + "</div>"; }
  function render(){
    var info = $("bgInfo"); if(!info) return;
    var c = cfg(), s = spent(), r2 = ledger().r2, gb = r2 ? r2.bytes / 1073741824 : null;
    var pd = pct(s.d, c.aiDay), pm = pct(s.m, c.aiMonth), pr = gb === null ? 0 : pct(gb, c.r2GB);
    info.innerHTML = row("ค่า AI วันนี้", c.aiDay ? kind(pd) : "idle", money(s.d) + (c.aiDay ? " / " + money(c.aiDay) : " · ไม่จำกัด"))
      + row("ค่า AI เดือนนี้", c.aiMonth ? kind(pm) : "idle", money(s.m) + (c.aiMonth ? " / " + money(c.aiMonth) : " · ไม่จำกัด"), "≈ " + Math.round(s.m * THB) + " บาท" + (s.real ? " · ยอดจริงจาก OpenRouter (รวมทุกการใช้ key)" : " · ยอดที่แอพนับเอง"))
      + row("คลัง R2", gb === null ? "idle" : c.r2GB ? kind(pr) : "idle", gb === null ? "ยังไม่ได้เช็ก" : gb.toFixed(1) + " GB" + (c.r2GB ? " / " + c.r2GB + " GB" : ""),
            gb === null ? "เปิดหน้าฟุตเทจ แล้วแอพจะเช็กให้" : "ค่าเก็บ ≈ " + money(r2Cost(gb)) + "/เดือน (≈ " + Math.round(r2Cost(gb) * THB) + " บาท) · 10 GB แรกฟรี · เช็กล่าสุด " + new Date(r2.at).toLocaleString("th-TH"));
    var worst = [c.aiDay ? kind(pd) : "ok", c.aiMonth ? kind(pm) : "ok", gb !== null && c.r2GB ? kind(pr) : "ok"].reduce(function(a, b){ var o = { ok:0, warn:1, err:2 }; return o[b] > o[a] ? b : a; }, "ok");
    var tag = $("bgTag"); if(tag){ tag.className = "state " + worst; tag.textContent = worst === "ok" ? "อยู่ในงบ" : worst === "warn" ? "ใช้ไปเกินครึ่ง" : "ใกล้/ถึงเพดาน"; }
  }
  function bind(){
    var c = cfg(), ids = { bgDay:"aiDay", bgMonth:"aiMonth", bgR2:"r2GB" };
    Object.keys(ids).forEach(function(id){
      var el = $(id); if(!el) return; el.value = c[ids[id]];
      el.addEventListener("change", function(){
        var n = Number(this.value), cur = cfg(); cur[ids[id]] = isFinite(n) && n >= 0 ? n : 0; this.value = cur[ids[id]];
        MWStore.set(CFG, cur); render();
      });
    });
  }
  MWStore.on(function(k){ if(k === CFG || k === LEDGER) render(); });
  bind(); render(); refresh();

  window.MWBudget = { cfg:cfg, check:check, add:add, spent:spent, refresh:refresh, real:real, r2Stat:r2Stat, r2Check:r2Check, money:money };
})();
