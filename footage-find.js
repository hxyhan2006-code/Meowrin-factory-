/* footage-find.js — แท็บ "คลัง" ของหน้าฟุตเทจ: ค้นในเครื่อง (ชื่อตัวละคร/คำเหมือน/ตัดคำ) · ชิปตัวละคร/จำนวนคน · การ์ดฉาก · รูปใหญ่ + เล่นฉาก (ไฟล์ในเครื่อง/คลัง)
   โหลดหลัง footage.js (ใช้ FT.ui) ก่อน footage-cloud.js/footage-plan.js · เพิ่ม terms/hay/card/chars/charKey/hasSrc/srcUrl/openFiles/search เข้า FT.ui */
(function(){
  "use strict";
  var FT = window.FT, U = FT && FT.ui; if(!U) return;
  var esc = U.esc, tm = U.tm, capDur = U.capDur;
  var $ = function(id){ return document.getElementById(id); };
  function day(ms){ return new Date(ms).toLocaleDateString("th-TH", { day:"numeric", month:"short", year:"2-digit" }); }

  /* ---------- ค้นหา (ในเครื่อง ไม่เรียก AI) ---------- */
  var NAMES = [ /* ชื่อไทย/อังกฤษที่สะกดได้หลายแบบ — เจอในคำค้น/ป้ายของ AI จะนับเป็นตัวเดียวกัน (ตัวแรก = key) */
    ["luffy","ลูฟี่","ลูฟี","ลูฟฟี่","ลูฟี้","monkey d"],["zoro","โซโร","โซโล","โซโร่","zorro","roronoa"],["nami","นามิ"],["usopp","อุซป","อุซปป์","อุซบ","อุซป์","อุสป","อุซ๊ป","อุซอป","usop","sogeking","ซุปเปอร์ซอกกิ้ง","ซอกกิ้ง"],["sanji","ซันจิ","ซานจิ","sanchi"],
    ["chopper","ช็อปเปอร์","ชอปเปอร์","ช๊อปเปอร์","ช็อปเปอ","tony tony"],["robin","โรบิน","nico"],["franky","แฟรงกี้","แฟรงค์กี้","แฟรงกี","frankie","แฟรงกี้"],["brook","บรู๊ค","บรูค","บรุ๊ค","บรู๊ก"],["jinbe","จินเบ","จินเบอิ","jinbei","jimbei","จิมเบ"],
    ["ace","เอส","portgas"],["sabo","ซาโบ้","ซาโบ"],["shanks","แชงคูส","แชงค์","แชงค์ส"],["garp","การ์ป","การ์ฟ"],["buggy","บากี้"],["hancock","ฮันค็อก","แฮนค็อก","ฮันค๊อก"],
    ["law","ลอว์","ลอ","trafalgar"],["kid","คิด"],["yamato","ยามาโตะ"],["kaido","ไคโด"],["big mom","บิ๊กมัม","บิ๊กมอม"],["blackbeard","หนวดดำ","ทีช","teach","marshall d"],
    ["whitebeard","หนวดขาว","newgate"],["vivi","วีวี่","วิวี่"],["shirahoshi","ชิราโฮชิ"],["mihawk","มิฮอว์ค","มิฮอว์ก","dracule"],["dragon","ดราก้อน"],["koby","โคบี้","โคบี"],["smoker","สโมกเกอร์"],
    ["crocodile","ครอคโคไดล์","ครอกโคไดล์","โครโคไดล์","เซอร์ ครอคโคไดล์"],["arlong","อาร์ลอง"],["enel","เอเนล","เอเนลล์"],["lucci","ลูชชี่","ลุชชี่","ลูชี่","rob lucci"],["doflamingo","โดฟลามิงโก้","โดฟลามิงโก","โดฟี่"],["akainu","อาคาอินุ","อากาอินุ","sakazuki"],["aokiji","อาโอคิจิ","คุซัน","kuzan"],["kizaru","คิซารุ","borsalino"],["rebecca","รีเบคก้า","รีเบกก้า"]
  ];
  var SYN = [ /* อารมณ์/การกระทำที่ AI อาจใช้คำต่างกัน (ไทย+อังกฤษ) → ค้นคำไหนก็เจอทุกคำในกลุ่ม */
    ["ตกใจ","ตกตะลึง","ช็อก","ช็อค","อึ้ง","สะดุ้ง","shock","surprise","startle","astonish"],["โกรธ","โมโห","เดือด","angry","anger","furious","rage"],
    ["ร้องไห้","น้ำตา","เสียใจ","cry","sad","tear"],["หัวเราะ","ขำ","ตลก","laugh","funny","smile"],["งง","สับสน","confus","puzzl"],
    ["กลัว","หวาดกลัว","scare","afraid","fear","terrif"],["ดีใจ","มีความสุข","ยินดี","happy","joy","excite"],["ต่อสู้","ต่อย","โจมตี","สู้","fight","battle","attack","punch"],
    ["ฟันดาบ","ดาบ","sword","slash"],["กิน","อาหาร","หิว","eat","food","hungry"],["วิ่ง","หนี","run","flee","chase"],["เท่","เจ๋ง","cool","badass"]
  ];
  SYN.push(["ชูสองนิ้ว","ชู 2 นิ้ว","ชูนิ้ว","ท่าสันติภาพ","สองนิ้ว","2 นิ้ว","peace sign","v sign","victory sign","two fingers"]); /* ตัวตัดคำของเบราว์เซอร์ตัด "ชูสองนิ้ว" เป็น ชูส/อง/นิ้ว → กันไว้เป็นวลีเดียว */
  SYN.push(["เศร้า","หดหู่","ซึม","เสียใจ","ร้องไห้","sad","sorrow","gloom"],["ยิ้ม","ยิ้มกว้าง","หัวเราะ","grin","smile"],["เตะ","กระทืบ","kick","stomp"],["กระโดด","โดด","พุ่ง","jump","leap","dash"],
    ["บิน","ลอย","fly","float","soar"],["ตาย","เสียชีวิต","จากไป","death","dead","die"],["ช่วย","ช่วยเหลือ","ช่วยชีวิต","help","rescue","save"],["ปกป้อง","คุ้มกัน","ขวาง","protect","guard","shield"],
    ["ระเบิด","ปะทุ","explode","explosion","blast"],["เผชิญหน้า","ประจันหน้า","จ้องหน้า","confront","stare","face-off","glare"],["ว่ายน้ำ","จมน้ำ","swim","drown"],["ดื่ม","เหล้า","เบียร์","drink","sake","beer"],
    ["สัญญา","สาบาน","ปฏิญาณ","promise","vow","swear"],["ฝัน","ความฝัน","dream"],["ย้อนอดีต","อดีต","ความทรงจำ","flashback","memory","past"],["เขิน","อาย","เขินอาย","blush","shy","embarrass"],
    ["ภูมิใจ","เท่ห์","proud","triumph"],["ชนะ","ชัยชนะ","win","victory"],["แพ้","พ่ายแพ้","lose","defeat","beaten"],["จับ","คว้า","รัด","grab","grip","hold"],["ดึง","ลาก","ยืด","pull","drag","stretch"],
    ["คิด","ครุ่นคิด","นิ่งคิด","think","ponder","thought"],["นั่ง","พักผ่อน","sit","rest","relax"],["เดิน","ก้าวเดิน","walk","stroll"],["จ้อง","มอง","เหลือบมอง","look","gaze","watch"]);
  SYN.push(["พายเรือ","ล่องเรือ","แล่นเรือ","เรือ","พาย","boat","ship","row","sail","raft"],["ทะเล","มหาสมุทร","คลื่น","sea","ocean","wave"],["ป่า","ต้นไม้","forest","jungle"],
    ["เมือง","หมู่บ้าน","ชาวบ้าน","town","village"],["นอน","หลับ","เตียง","sleep","bed"],["พูด","คุย","บอก","talk","speak","say"],["ร้อง","ตะโกน","scream","shout","yell"],["ร้องเพลง","เพลง","sing","song"],
    ["ซ่อน","แอบ","hide","sneak"],["กอด","hug","embrace"],["วิ่ง","หนี","run","flee","chase"]);
  var STOP = ["ฉาก","ฉากที่","ที่","ซึ่ง","อยู่","กับ","และ","ของ","ใน","ตอน","ตอนที่","แบบ","มี","เป็น","ให้","ไป","มา","คือ","หา","อยาก","ได้","เวลา","เจอ","ครับ","ค่ะ","หน่อย","ด้วย","แล้ว","จะ","ก็","ไหม","มั้ย","อะ","นะ","เมื่อ","กำลัง","แต่","หรือ","กัน","เรื่อง","ภาพ","คลิป","ช่วง","ที"];
  var seg = null; try{ seg = new Intl.Segmenter("th", { granularity:"word" }); }catch(e){}
  /* ปรับข้อความให้เทียบกันได้แม้สะกดต่าง: ตัดวรรณยุกต์/ไม้ยมก · เลขไทย→อารบิก · สอง/สาม/หนึ่ง→2/3/1 · compact = ตัดช่องว่างด้วย (ภาษาไทยไม่เว้นวรรคสม่ำเสมอ) */
  var NZC = {};
  function nzk(s){
    return String(s || "").toLowerCase().replace(/[๐-๙]/g, function(d){ return d.charCodeAt(0) - 0xE50; }).replace(/[\u0e48-\u0e4c\u0e46]/g, "")
      .replace(/สอง/g, "2").replace(/สาม/g, "3").replace(/หนึง/g, "1");
  }
  function nzc(s){ var k = String(s); return NZC[k] || (NZC[k] = nzk(k).replace(/\s+/g, "")); }
  var SKC = {};
  function skel(s){ return SKC[s] || (SKC[s] = s.replace(/[\u0e31\u0e34-\u0e3a\u0e47]/g, "")); }
  function fuzzyHas(h, w){ /* เจอคำเกือบครบ: มีช่วงยาว ≥70% ของคำอยู่ในข้อความ (ทนพิมพ์ตกหล่น/สะกดต่างหนึ่งตัว) */
    var L = w.length; if(L < 4) return false;
    var m = Math.max(3, Math.ceil(L * 0.7));
    for(var i = 0; i + m <= L; i++) if(h.indexOf(w.substr(i, m)) >= 0) return true;
    return false;
  }
  function terms(q){ /* คืนกลุ่มคำ [[คำที่ความหมายเดียวกัน...]] แต่ละกลุ่ม = 1 เงื่อนไขที่ต้องตรง · เงื่อนไขคำธรรมดามี .chunk = ก้อนที่พิมพ์ติดกัน (ใช้กู้เมื่อตัวตัดคำตัดผิด) */
    var out = [], rest = nzk(q);
    NAMES.concat(SYN).forEach(function(v){ if(v.some(function(n){ return rest.indexOf(nzk(n)) >= 0; })){ out.push(v); v.forEach(function(n){ rest = rest.split(nzk(n)).join(" "); }); } });
    rest.split(/[\s,]+/).filter(Boolean).forEach(function(p){
      if(/[฀-๿]/.test(p) && seg){
        var ws = Array.from(seg.segment(p)).filter(function(x){ return x.isWordLike && x.segment.length >= 2; }).map(function(x){ return x.segment; }).filter(function(w){ return STOP.indexOf(w) < 0; });
        var chunk = ws.join("");
        (ws.length || STOP.indexOf(p) >= 0 ? ws : [p]).forEach(function(w){ var g = [w]; g.chunk = chunk; out.push(g); });
      } else if(p.length >= 2 && STOP.indexOf(p) < 0) out.push([p]);
    });
    return out;
  }
  /* เงื่อนไขหนึ่งตรงกับข้อความระดับไหน: คืน index ในอาเรย์ hay (0 ตัวละคร · 1 แท็ก · 2 สรุป) หรือ -1 · hn = hayN() */
  function matchIdx(v, hn){
    var k, i;
    for(k = 0; k < hn.length; k++) for(i = 0; i < v.length; i++) if(hn[k].indexOf(nzc(v[i])) >= 0) return k;
    if(v.chunk && v.chunk.length >= 4){ /* ตัวตัดคำอาจตัดผิด (ชู|ส|อง) → ลองทั้งก้อนที่พิมพ์ติดกัน */
      for(k = 0; k < hn.length; k++) if(fuzzyHas(hn[k], v.chunk)) return k;
    }
    var w = v[0]; /* พิมพ์ตกสระ (ศตรู ↔ ศัตรู): เทียบโครงพยัญชนะ ไม่นับสระบน/ล่าง */
    if(w.length >= 3){ var sk = skel(w); if(sk.length >= 3) for(k = 0; k < hn.length; k++) if(skel(hn[k]).indexOf(sk) >= 0) return k; }
    return -1;
  }
  function hay(c, sc){
    var a = sc.ai || {};
    return [ (a.characters || []).concat(a.characters_th || []).join(" "),
             (a.tags_en || []).concat(a.tags_th || [], [a.action, a.emotion, a.mood], a.objects || []).join(" "),
             [a.summary_th, a.location, a.arc, a.event, a.text].concat((a.fr || []).map(function(f){ return f.d; })).join(" ") ].map(nzc); /* mood/arc/event มีเฉพาะดัชนีรุ่นละเอียด */ /* ระดับฉากเท่านั้น: ไม่รวมสรุปทั้งคลิป (ไม่งั้นทุกฉากในคลิปที่มีลูฟี่ตรงหมด) และไม่รวมชื่ออัลบั้ม */
  }
  /* "ลูฟี่ตกใจ" ต้องหมายถึงลูฟี่เป็นคนตกใจ ไม่ใช่แค่มีลูฟี่อยู่ในฉากแล้วคนอื่นตกใจ → ดูว่าชื่อตัวละครตามด้วยคำอารมณ์ติดกันในสรุปของฉาก (ไม่เกิน NEAR ตัวอักษร) */
  var NEAR = 24;
  function near(sum, nameGrp, emoGrp){
    return nameGrp.some(function(n){
      for(var i = sum.indexOf(n); i >= 0; i = sum.indexOf(n, i + 1)){
        var w = sum.slice(i + n.length, i + n.length + NEAR);
        if(emoGrp.some(function(e){ return w.indexOf(e) >= 0; })) return true;
      }
      return false;
    });
  }
  /* ---------- อัลบั้มอัตโนมัติ: ชิปตัวละครสร้างจากป้ายของแต่ละฉากจริงๆ (ฉากเดียวอยู่ได้หลายชิป ไม่ย้ายไฟล์) ----------
     ชื่อใน NAMES รวมสะกดต่างให้เป็นคนเดียวกัน · ตัวละครอื่นที่ AI เห็น ≥ MINSC ฉากได้ชิปเอง · เลือกหลายชิป = ต้องมีทุกคน · ชิปจำนวนคน = เดี่ยว/คู่/กลุ่ม/หมู่ */
  var NAMEX = NAMES.map(function(g){ var en = g.filter(function(n){ return /^[a-z ]+$/.test(n); }); /* ชื่ออังกฤษทุกแบบในกลุ่ม · ที่เหลือเป็นชื่อไทย */
    return { key:g[0], th:g[1], en:new RegExp("(^|[^a-z])(" + en.join("|") + ")([^a-z]|$)"), ths:g.filter(function(n){ return !/^[a-z ]+$/.test(n); }) }; });
  var MINSC = 3, SKIPN = /^(unknown|none|n\/a|na|-|unnamed)$/;
  var chipCache = new WeakMap(), labelOf = {}, sel = [], only = false, sizeSel = "", albumSel = ""; /* albumSel = อัลบั้มที่ Han จัดไว้ (ชื่อตอนอัป) */
  NAMEX.forEach(function(n){ labelOf[n.key] = n.th; });
  function sceneChars(sc){ /* คืนรายการ key ตัวละครในฉากนี้ (จากป้าย AI) */
    var r = chipCache.get(sc); if(r) return r;
    var a = sc.ai || {}, en = a.characters || [], th = a.characters_th || []; r = [];
    var add = function(k, lab){ if(k && r.indexOf(k) < 0){ r.push(k); if(!labelOf[k] && lab) labelOf[k] = lab; } };
    en.forEach(function(raw, i){
      var low = String(raw).toLowerCase().replace(/\s+/g, " ").trim(); if(!low || SKIPN.test(low)) return;
      var n = NAMEX.find(function(x){ return x.en.test(low); }); add(n ? n.key : low, th.length === en.length ? th[i] : raw);
    });
    var jt = th.join(" | "); NAMEX.forEach(function(n){ if(r.indexOf(n.key) < 0 && n.ths.some(function(t){ return jt.indexOf(t) >= 0; })) add(n.key); }); /* ป้ายอังกฤษไม่มี/สะกดต่าง → ดูชื่อไทย */
    chipCache.set(sc, r); return r;
  }
  function sizeOf(n){ return n >= 5 ? "5" : n >= 3 ? "3" : String(n); }
  function passSc(sc){ /* ฉากนี้ผ่านตัวกรองชิปที่เลือกไหม */
    var cs = sceneChars(sc);
    if(sel.length && !sel.every(function(k){ return k === "?" ? !cs.length : cs.indexOf(k) >= 0; })) return false;
    if(only && sel.length && sel.indexOf("?") < 0 && cs.length !== sel.length) return false;
    return !sizeSel || (cs.length && sizeOf(cs.length) === sizeSel);
  }
  function filtering(){ return sel.length > 0 || !!sizeSel; }
  var dat = null; /* ข้อมูลล่าสุดของตัวกรอง (renderChips คำนวณใหม่ทุกครั้งที่ค้นหา · ชีตอ่านจากนี่) */
  function enName(k){ return /^[\x20-\x7e]+$/.test(k) ? k.replace(/(^| )\w/g, function(m){ return m.toUpperCase(); }) : (labelOf[k] || k); } /* ชื่อ canon อังกฤษ */
  var SIZES = [["", "ทุกจำนวนคน"], ["1", "เดี่ยว"], ["2", "คู่"], ["3", "กลุ่ม 3-4"], ["5", "หมู่ 5+"]];
  function renderChips(){
    var cnt = {}, none = 0, total = 0, sz = { "1":0, "2":0, "3":0, "5":0 }, al = {};
    U.lib().forEach(function(c){ if(c.status !== "done" || c.hide) return; al[c.album] = (al[c.album] || 0) + 1; /* อัลบั้มที่จัดเอง: นับเป็นคลิป */
      c.scenes.forEach(function(sc){ total++; var cs = sceneChars(sc); if(!cs.length) none++; else sz[sizeOf(cs.length)]++; cs.forEach(function(k){ cnt[k] = (cnt[k] || 0) + 1; }); }); });
    if(!total){ $("chips").innerHTML = ""; $("onlyRow").hidden = true; return; }
    var ks = Object.keys(cnt).filter(function(k){ return cnt[k] >= MINSC || labelOf[k] && NAMEX.some(function(n){ return n.key === k; }) || sel.indexOf(k) >= 0; }).sort(function(x, y){ return enName(x).localeCompare(enName(y)); });
    dat = { ks:ks, cnt:cnt, none:none, sz:sz, al:al };
    var btn = function(w, icon, lab, on){ return '<button class="chip fbtn' + (on ? " on" : "") + '" data-open="' + w + '">' + MWIcon(icon) + "<span>" + esc(lab) + "</span></button>"; };
    var albs = Object.keys(al).length > 1;
    $("chips").innerHTML = (albs ? btn("a", "folder", albumSel || "อัลบั้ม", albumSel) : "")
      + btn("c", "user", !sel.length ? "ตัวละคร" : sel.map(function(k){ return k === "?" ? "ไม่ระบุตัวละคร" : enName(k); }).join(", "), sel.length)
      + btn("z", "sliders", sizeSel ? SIZES.find(function(x){ return x[0] === sizeSel; })[1] : "จำนวนคน", sizeSel)
      + (albumSel || sel.length || sizeSel ? '<button class="chip" data-clr="1">ล้างทั้งหมด</button>' : "");
    $("onlyRow").hidden = !sel.length || sel.indexOf("?") >= 0; $("onlySel").checked = only;
  }
  function matchCount(){ /* จำนวนฉากที่ผ่านตัวกรองอัลบั้ม/ตัวละคร/จำนวนคนตอนนี้ (ยังไม่นับคำค้นในช่องค้นหา) */
    var n = 0; U.lib().forEach(function(c){ if(c.status !== "done" || c.hide || albumSel && c.album !== albumSel) return; c.scenes.forEach(function(sc){ if(passSc(sc)) n++; }); }); return n;
  }
  function pickAlbum(){
    FT.pick.open({ title:"เลือกอัลบั้ม", placeholder:"พิมพ์ชื่ออัลบั้มเพื่อหา", icon:"folder", count:matchCount,
      items:function(q){ var r = [{ k:"", name:"ทุกอัลบั้ม", sub:"", on:!albumSel }].concat(Object.keys(dat.al).sort().map(function(a){ return { k:a, name:a, sub:dat.al[a] + " คลิป", on:albumSel === a }; })); return r.filter(function(x){ return !q || x.name.toLowerCase().indexOf(q) >= 0; }); },
      onPick:function(k){ albumSel = k === albumSel ? "" : k; chipMax = 40; search(); } }); /* แตะตัวที่เลือกอยู่ซ้ำ = ยกเลิก (กลับเป็นทั้งหมด) */
  }
  function pickChars(){ /* เลือกหลายคนได้ = ฉากต้องมีทุกคนที่เลือก · "ไม่ระบุตัวละคร" เลือกร่วมกับตัวอื่นไม่ได้ */
    FT.pick.open({ title:"เลือกตัวละคร", placeholder:"พิมพ์ชื่อเพื่อหา เช่น Zoro หรือ โซโร", icon:"user", multi:true, count:matchCount,
      items:function(q){
        var rows = dat.ks.filter(function(k){ var nx = NAMEX.find(function(x){ return x.key === k; }); return !q || (enName(k) + " " + k + " " + (labelOf[k] || "") + " " + (nx ? nx.ths.join(" ") : "")).toLowerCase().indexOf(q) >= 0; })
          .map(function(k){ return { k:k, name:enName(k), sub:dat.cnt[k] + " ฉาก", on:sel.indexOf(k) >= 0 }; });
        if(dat.none && (!q || "ไม่ระบุตัวละคร unknown".indexOf(q) >= 0)) rows.unshift({ k:"?", name:"ไม่ระบุตัวละคร", sub:dat.none + " ฉาก", on:sel.indexOf("?") >= 0 });
        return rows; },
      onPick:function(k){ var i = sel.indexOf(k);
        if(k === "?") sel = i >= 0 ? [] : ["?"]; else { sel = sel.filter(function(x){ return x !== "?"; }); if(i >= 0) sel.splice(i, 1); else sel.push(k); }
        chipMax = 40; search(); },
      onClear:function(){ sel = []; chipMax = 40; search(); } });
  }
  function pickSize(){
    FT.pick.open({ title:"จำนวนคนในฉาก", placeholder:"พิมพ์เพื่อหา เช่น คู่", icon:"user", count:matchCount,
      items:function(q){ return SIZES.filter(function(x){ return !q || x[1].toLowerCase().indexOf(q) >= 0; }).map(function(x){ return { k:x[0], name:x[1], sub:x[0] ? dat.sz[x[0]] + " ฉาก" : "", on:sizeSel === x[0] }; }); },
      onPick:function(k){ sizeSel = k === sizeSel ? "" : k; chipMax = 40; search(); } });
  }
  $("chips").addEventListener("click", function(e){
    if(e.target.closest("[data-clr]")){ albumSel = sizeSel = ""; sel = []; chipMax = 40; search(); return; }
    var b = e.target.closest("[data-open]"); if(!b) return;
    ({ a:pickAlbum, c:pickChars, z:pickSize })[b.dataset.open]();
  });
  $("onlySel").addEventListener("change", function(){ only = this.checked; chipMax = 40; search(); });
  var sT = 0, shown = [], lastQ = "", showPartial = false, chipMax = 40; /* shown = รายการที่โชว์อยู่ (ให้ปุ่มดูรูปใหญ่อ้างถึง) */
  $("q").addEventListener("input", function(){ clearTimeout(sT); sT = setTimeout(search, 250); });
  function search(){
    var q = $("q").value.trim();
    var clips = U.lib().filter(function(c){ return c.status === "done" && !c.hide && (!albumSel || c.album === albumSel); }); /* c.hide = ซ่อนเพราะซ้ำ (footage-dup.js) */
    renderChips();
    if(!q){ return browse(clips); }
    var ts = terms(q), hits = [];
    var names = ts.filter(function(v){ return NAMES.indexOf(v) >= 0; }), emos = ts.filter(function(v){ return SYN.indexOf(v) >= 0; });
    clips.forEach(function(c){ c.scenes.forEach(function(sc){
      if(!passSc(sc)) return;
      var h = hay(c, sc), hit = 0, score = 0;
      ts.forEach(function(v){
        var k = matchIdx(v, h);
        if(k >= 0){ hit++; score += [4, 2, 1][k]; }
      });
      var exact = false, sm = (sc.ai && sc.ai.summary_th || "").toLowerCase();
      names.forEach(function(ng){ emos.forEach(function(eg){ if(near(sm, ng, eg)) exact = true; }); });
      if(exact) score += 20;
      if(hit) hits.push({ c:c, sc:sc, hit:hit, score:score, exact:exact });
    }); });
    hits.sort(function(a, b){ return b.hit - a.hit || b.score - a.score; }); /* ตรงเป๊ะ (ตัวละครเป็นคนมีอารมณ์นั้น) ได้คะแนนพิเศษ จึงขึ้นก่อน */
    var full = hits.filter(function(h){ return h.hit === ts.length; }), part = hits.filter(function(h){ return h.hit < ts.length; });
    if(q !== lastQ){ lastQ = q; showPartial = !full.length; } /* คำค้นใหม่ = ซ่อนที่ตรงบางส่วนไว้ก่อน (ถ้ามีตรงครบ) */
    var list = full.slice(0, 60), html = full.length ? '<p class="hint">ตรงครบทุกคำ ' + full.length + " ฉาก" + (full.length > 60 ? " (โชว์ 60 อันดับแรก)" : "") + "</p>" : "";
    var out = list.map(function(h){ return card(h.c, h.sc, h.exact); }).join("");
    if(part.length){
      if(showPartial) out += '<p class="hint">ตรงบางส่วน (มีแค่บางคำ) ' + part.length + " ฉาก</p>" + part.slice(0, 40).map(function(h){ return card(h.c, h.sc, false); }).join("");
      out += '<button class="btn ghost small" id="partialBtn" style="width:100%">' + (showPartial ? "ซ่อน" : "ดู") + "ที่ตรงบางส่วน (" + part.length + ")</button>";
    }
    $("findInfo").textContent = "คำค้น: " + ts.map(function(v){ return v[0]; }).join(" + ") + " · ตรงครบ " + full.length + " ฉาก · ตรงบางส่วน " + part.length + " ฉาก";
    $("results").innerHTML = (html + out) || '<p class="empty">ไม่เจอฉากที่ตรง ลองคำอื่น หรือแตะชิปตัวละคร</p>';
  }
  $("results").addEventListener("click", function(e){
    if(e.target.closest("#partialBtn")){ showPartial = !showPartial; search(); }
    if(e.target.closest("#moreBtn")){ chipMax += 40; search(); }
  });
  function browse(clips){ /* ไม่พิมพ์คำค้น = โชว์ทุกคลิปพร้อมสรุป · เลือกชิป = โชว์เป็นฉาก (ใหม่สุดก่อน) */
    if(filtering() || albumSel){
      if(!filtering()){ /* เลือกอัลบั้มอย่างเดียว = โชว์เป็นคลิป */
        $("findInfo").textContent = "อัลบั้ม " + albumSel + " · " + clips.length + " คลิป · พิมพ์คำค้นหรือแตะชิปตัวละครเพื่อกรองฉาก";
        $("results").innerHTML = clips.slice().sort(function(a, b){ return b.lastModified - a.lastModified; }).map(function(c){ return card(c, null); }).join("") || '<p class="empty">ไม่มีคลิป</p>';
        return;
      }
      var sc = []; clips.forEach(function(c){ c.scenes.forEach(function(s){ if(passSc(s)) sc.push({ c:c, sc:s }); }); });
      sc.sort(function(a, b){ return (b.c.lastModified || 0) - (a.c.lastModified || 0) || a.sc.s - b.sc.s; });
      $("findInfo").textContent = sc.length + " ฉากตามชิปที่เลือก (จากป้ายตัวละครที่ AI ติดให้) · พิมพ์คำค้นเพื่อกรองต่อ" + (sc.length > chipMax ? " · โชว์ " + chipMax + " ฉากแรก" : "");
      $("results").innerHTML = sc.slice(0, chipMax).map(function(h){ return card(h.c, h.sc); }).join("")
        + (sc.length > chipMax ? '<button class="btn ghost small" id="moreBtn" style="width:100%">ดูเพิ่ม 40 ฉาก</button>' : "") || '<p class="empty">ไม่มีฉาก</p>';
      return;
    }
    clips = clips.slice().sort(function(a, b){ return a.album.localeCompare(b.album) || b.lastModified - a.lastModified; });
    $("findInfo").textContent = clips.length + " คลิปในดัชนี · พิมพ์คำค้นเพื่อหาฉาก";
    $("results").innerHTML = clips.length ? clips.map(function(c){ return card(c, null); }).join("") : '<p class="empty">ยังไม่มีคลิปในดัชนี ไปที่แท็บ อัปโหลด ก่อน</p>';
  }
  function strip(c){
    return '<div class="strip">' + c.scenes.map(function(s){
      var k = shown.push({ c:c, sc:s }) - 1;
      return '<div class="st" data-k="' + k + '"><img src="' + s.thumb + '" alt="ฉาก"><em>' + tm(s.s) + "</em></div>";
    }).join("") + "</div>";
  }
  var SHOT = { close:"ภาพใกล้", medium:"ภาพกลาง", wide:"ภาพไกล" };
  function card(c, sc, exact, why){
    var a = sc && sc.ai || {}, who = (sc ? sceneChars(sc) : []).map(enName).join(", "); /* ชื่ออังกฤษ canon เหมือนตัวกรอง */
    var kc = shown.push({ c:c, cover:true }) - 1, k = sc ? shown.push({ c:c, sc:sc }) - 1 : kc; /* แตะปก = ดูปกใหญ่ · แตะรูปฉาก = ดูรูปฉากใหญ่ */
    return '<div class="card"><div class="shots"><div class="cover" data-k="' + kc + '"><img src="' + (c.cover || "") + '" alt="ปกคลิป"><em>' + capDur(c.duration) + "</em></div>"
      + (sc ? '<img class="scene" src="' + sc.thumb + '" alt="ฉาก" data-k="' + k + '">' : "") + '</div><div class="t">'
      + "<b>" + esc(c.album) + "</b>" + (sc ? ' · <span class="when">ฉาก ' + tm(sc.s) + "–" + tm(sc.e) + "</span>" : " · " + c.scenes.length + " ฉาก")
      + "<p>" + (exact ? '<span class="tag ok">' + MWIcon("star") + 'ตรงเป๊ะ</span> ' : "") + (why ? '<span class="tag run">AI: ' + esc(why) + "</span> " : "") + esc(sc ? (a.summary_th || "(AI ไม่ได้อธิบายฉากนี้)") : (c.summary_th || "")) + "</p>"
      + (who ? "<p>" + MWIcon("user") + esc(who) + "</p>" : "")
      + (sc && (a.shot || a.intensity || a.event || a.multi) ? '<p class="meta">' + MWIcon("film") + esc([SHOT[a.shot], a.intensity ? "แรง " + a.intensity + "/5" : "", a.event || a.arc, (a.issues || []).length ? "ปัญหาภาพ: " + a.issues.join(", ") : "", a.multi ? "หลายช็อตปน" : "", a.usable && a.usable <= 2 ? "คุณภาพต่ำ" : ""].filter(Boolean).join(" · ")) + "</p>" : "") /* ป้ายดัชนีรุ่นละเอียด */
      + (sc ? "" : strip(c)) /* โหมดดูทั้งคลิป: แถบรูปทุกฉาก แตะดูรูปใหญ่ + คำอธิบายฉากนั้น */
      + '<p>' + day(c.lastModified) + '</p><div class="fname">' + esc(c.name) + "</div></div></div>";
  }
  document.querySelector("main").addEventListener("click", function(e){ /* การ์ดในทุกหน้า (ค้นหา/ผลที่ AI เลือก/วางแผนฉาก) */
    var el = e.target.closest("[data-k]"), h = el && shown[+el.dataset.k], c = h && h.c, sc = h && h.sc;
    if(h && h.cover){ openBig(c, null, c.cover, c.album + " · ปกคลิป (เฟรมแรก) · " + capDur(c.duration)); return; }
    if(!sc) return;
    openBig(c, sc, sc.img || sc.thumb, c.album + " · " + capDur(c.duration) + " · ฉาก " + tm(sc.s) + "–" + tm(sc.e) + (sc.ai && sc.ai.summary_th ? " · " + sc.ai.summary_th : ""));
  });
  /* ---------- ดูฉากนี้ (เล่นจากไฟล์จริงในเครื่อง ไม่อัปโหลด) ---------- */
  var pf = {}, bySize = {}, bigCur = null; /* pf = ไฟล์ที่เปิดไว้ในรอบนี้ (ชื่อ|ขนาด → File) หายเมื่อปิดหน้า · bySize = สำรองจับด้วยขนาดอย่างเดียว (แอพไฟล์กับแกลเลอรีอาจตั้งชื่อไม่ตรงกัน) false = ขนาดชนกัน · bigCur = ฉากที่เปิดอยู่ */
  function pfKey(name, size){ return name + "|" + size; }
  function fileOf(c){ return c && (pf[pfKey(c.name, c.size)] || bySize[c.size]) || null; }
  function hasSrc(c){ return !!fileOf(c) || !!(c && c.r2 && FT.cloud && FT.cloud.ready()); } /* ไฟล์ที่เปิดไว้ในเครื่อง หรืออยู่ในคลัง */
  async function srcUrl(c){ /* { url, done() } · ในเครื่องก่อน (เร็ว ไม่เปลืองเน็ต) ไม่มีค่อยสตรีมจากคลัง */
    var f = fileOf(c); if(f){ var u = URL.createObjectURL(f); return { url:u, cloud:false, done:function(){ URL.revokeObjectURL(u); } }; }
    if(c && c.r2 && FT.cloud && FT.cloud.ready()) return { url:await R2.url(c.r2), cloud:true, done:function(){} };
    return null;
  }
  /* ---------- แก้ตัวละครของฉากเอง (AI ติดป้ายพลาด/ขาด) · แตะชิป = เพิ่ม/เอาออก · เก็บ ai.fixed ไว้ ไม่ให้การอัปเกรดดัชนีทับ ---------- */
  function renderBigChars(){
    var el = $("bigChars"); el.hidden = !(bigCur && bigCur.sc); $("bigCharsHint").hidden = el.hidden; if(el.hidden) return;
    var cur = sceneChars(bigCur.sc), keys = cur.concat(NAMEX.map(function(n){ return n.key; }).filter(function(k){ return cur.indexOf(k) < 0; }));
    el.innerHTML = keys.map(function(k){ return '<button class="chip' + (cur.indexOf(k) >= 0 ? " on" : "") + '" data-bc="' + esc(k) + '">' + esc(enName(k)) + "</button>"; }).join("");
  }
  $("bigChars").addEventListener("click", async function(e){
    var b = e.target.closest("[data-bc]"); if(!b || !bigCur) return; var k = b.dataset.bc, sc = bigCur.sc, a = sc.ai = sc.ai || {}, nx = NAMEX.find(function(n){ return n.key === k; });
    var en = (a.characters || []).slice(), th = (a.characters_th || []).slice(), has = sceneChars(sc).indexOf(k) >= 0;
    var keep = function(arr){ return arr.filter(function(n){ return charKey(n) !== k; }); };
    if(has){ en = keep(en); th = keep(th); }
    else { en.push(nx ? nx.key.replace(/(^| )\w/g, function(m){ return m.toUpperCase(); }) : k); th.push(labelOf[k] || k); }
    a.characters = en; a.characters_th = th; a.fixed = true; chipCache.delete(sc);
    try{ await FT.store.put(bigCur.c); }catch(err){ await MWDialog.alert("บันทึกไม่ได้: " + err.message); }
    renderBigChars(); search();
  });
  function openBig(c, sc, src, text){
    bigCur = { c:c, sc:sc }; stopPlay(); renderBigChars();
    $("bigImg").src = src; $("bigTxt").textContent = text; $("playMsg").textContent = ""; $("big").hidden = false; renderPlayBtn();
  }
  function renderPlayBtn(){ var has = bigCur && hasSrc(bigCur.c); $("playBtn").innerHTML = MWIcon("play") + (has ? "ดูฉากนี้" : "ดูฉากนี้ (เลือกไฟล์)"); $("loopSc").parentNode.hidden = !(bigCur && bigCur.sc); }
  var playDone = null;
  function stopPlay(){ var v = $("bigVid"); v.pause(); if(playDone){ playDone(); playDone = null; } if(v.src){ v.removeAttribute("src"); v.load(); } v.hidden = true; $("bigImg").hidden = false; v.ontimeupdate = v.onloadedmetadata = null; }
  async function playScene(){
    if(!bigCur || !hasSrc(bigCur.c)){ $("playFiles").click(); return; } /* ไม่มีในเครื่องและไม่อยู่ในคลัง → ให้เลือกไฟล์ (ต้องเรียกตอนแตะ ก่อน await) */
    var cur = bigCur, v = $("bigVid"), s = cur.sc ? cur.sc.s : 0, e = cur.sc ? cur.sc.e : Infinity;
    stopPlay(); $("playMsg").textContent = "กำลังเปิด...";
    var src; try{ src = await srcUrl(cur.c); }catch(err){ $("playMsg").textContent = err.message; return; }
    if(bigCur !== cur){ src.done(); return; } /* ปิด/เปลี่ยนฉากไประหว่างรอ */
    playDone = src.done; v.src = src.url; v.hidden = false; $("bigImg").hidden = true; $("playMsg").textContent = src.cloud ? "เล่นจากคลัง" : "";
    v.onloadedmetadata = function(){ v.currentTime = Math.min(s, Math.max(0, v.duration - 0.1)); v.play().catch(function(){ $("playMsg").textContent = "กดปุ่มเล่นที่ตัวเล่นเพื่อเริ่ม"; }); };
    v.ontimeupdate = function(){ if(v.currentTime >= e - 0.05){ if($("loopSc").checked && bigCur.sc) v.currentTime = s; else v.pause(); } }; /* ฉากนี้เท่านั้น ไม่เล่นเลยไปฉากอื่น */
    v.onerror = function(){ $("playMsg").textContent = "เบราว์เซอร์เล่นไฟล์นี้ไม่ได้ (รูปแบบไฟล์ไม่รองรับ?)"; };
  }
  function addPlayFiles(files){
    var lib = U.lib(), sizes = {}; lib.forEach(function(c){ sizes[c.size] = 1; }); /* เก็บเฉพาะไฟล์ที่ขนาดตรงกับคลิปในดัชนี (เลือกทั้งโฟลเดอร์มาเป็นร้อยก็ไม่เปลือง) */
    Array.prototype.forEach.call(files, function(f){
      if(!sizes[f.size]) return;
      pf[pfKey(f.name, f.size)] = f;
      var o = bySize[f.size]; bySize[f.size] = o === undefined || (o && o.name === f.name) ? f : false;
    });
    var n = lib.filter(fileOf).length;
    document.dispatchEvent(new CustomEvent("ft:files", { detail:files.length })); /* แท็บผู้กำกับอัปเดตสถานะไฟล์ที่พร้อมใช้ */
    if(!$("big").hidden && bigCur){
      renderPlayBtn();
      if(fileOf(bigCur.c)) playScene(); else $("playMsg").textContent = "ไม่เจอไฟล์ " + bigCur.c.name + " ในที่เลือก (ชื่อและขนาดไฟล์ต้องตรงกับตอนทำดัชนี) ลองเลือกไฟล์จากอัลบั้ม “" + bigCur.c.album + "”";
    }
  }
  $("playBtn").addEventListener("click", playScene);
  $("playFiles").addEventListener("change", function(){ addPlayFiles(this.files); this.value = ""; });
  $("pickDocs").addEventListener("change", function(){ addPlayFiles(this.files); this.value = ""; });
  $("bigX").addEventListener("click", closeBig);
  $("big").addEventListener("click", function(e){ if(e.target === this) closeBig(); }); /* แตะพื้นหลังปิด ไม่ปิดเมื่อแตะวิดีโอ/ปุ่ม */
  function closeBig(){ stopPlay(); $("big").hidden = true; bigCur = null; }

  function charKey(name){ var low = String(name).toLowerCase().trim(), n = NAMEX.find(function(x){ return x.en.test(low) || x.ths.indexOf(name) >= 0; }); return n ? n.key : low; } /* ชื่อที่ AI ตอบ → key เดียวกับ sceneChars */
  function addChars(sc, keys){ /* เติมตัวละครที่ตรวจซ้ำเจอ (ไม่ลบของเดิม · ฉากที่ Han แก้เอง ai.fixed ไม่แตะ) คืนจำนวนที่เติม */
    var a = sc.ai = sc.ai || {}; if(a.fixed) return 0; var cur = sceneChars(sc), n = 0;
    keys.forEach(function(k){ if(cur.indexOf(k) >= 0) return; var nx = NAMEX.find(function(x){ return x.key === k; });
      a.characters = (a.characters || []).concat(nx ? nx.key.replace(/(^| )\w/g, function(m){ return m.toUpperCase(); }) : k); a.characters_th = (a.characters_th || []).concat(nx ? nx.th : k); n++; });
    if(n){ a.rc = 1; chipCache.delete(sc); } return n;
  }
  Object.assign(U, { addChars:addChars, show:function(c, sc){ return shown.push({ c:c, sc:sc }) - 1; }, terms:terms, hay:hay, matchIdx:matchIdx, card:card, chars:sceneChars, charKey:charKey, fileFor:fileOf, hasSrc:hasSrc, srcUrl:srcUrl, search:search,
                     openFiles:function(docs){ $(docs ? "pickDocs" : "playFiles").click(); } });
  if($("p-find").classList.contains("on")) search();
})();
