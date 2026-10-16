(function(){
  "use strict";
  var KEY_STORE = "mw_key_v1", DATA_STORE = "mw_data_v1", CACHE_STORE = "mw_cache_v1";
  var $ = function(id){ return document.getElementById(id); };

  function load(k, d){ return MWStore.get(k, d); } /* store.js: IndexedDB + แคช */
  function save(k, v){ return MWStore.set(k, v); }
  var data = load(DATA_STORE, { channels: [], made: {}, picked: null });
  data.saved = data.saved || {}; data.cols = data.cols || 2; /* saved = เก็บไว้ทำทีหลัง · cols = จำนวนคอลัมน์การ์ด */
  var cache = load(CACHE_STORE, { at: 0, clips: [] });
  var clips = cache.clips || [];

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  var getKey = MWSync.getKey, yt = MWSync.yt; /* เรียก YouTube API อยู่ใน sync.js */
  function persist(){ save(DATA_STORE, data); }
  function msg(el, text, err){ $(el).innerHTML = text ? '<div class="msg'+(err?' err':'')+'">'+esc(text)+'</div>' : ""; }
  function fmtNumTh(n){ n = Number(n)||0; if(n>=1e6) return (n/1e6).toFixed(1)+" ล้าน"; if(n>=1e5) return Math.round(n/1e5)/10+" แสน"; if(n>=1e4) return Math.round(n/1e3)/10+" หมื่น"; if(n>=1e3) return Math.round(n/100)/10+" พัน"; return String(n); }
  function ago(iso){ var d = Math.floor((Date.now()-new Date(iso).getTime())/864e5); if(d<1) return "วันนี้"; if(d<30) return d+" วันก่อน"; if(d<365) return Math.floor(d/30)+" เดือนก่อน"; return Math.floor(d/365)+" ปีก่อน"; }

  function videoId(url){
    var m = String(url).trim().match(/(?:youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  /* ---------- tabs ---------- */
  function showTab(name){
    document.querySelectorAll("nav button").forEach(function(x){ x.setAttribute("aria-selected", x.dataset.tab === name ? "true":"false"); });
    document.querySelectorAll("section").forEach(function(s){ s.classList.toggle("on", s.id === "tab-"+name); });
    renderPick(); /* แถบคลิปที่เลือกโชว์เฉพาะแท็บ คลิป */
    $("chanBtn").hidden = name !== "clips"; /* ปุ่มจัดการช่องอยู่มุมขวาบนของแท็บคลิป */
    document.dispatchEvent(new CustomEvent("mw:tab", { detail: name }));
  }
  document.querySelectorAll("nav button").forEach(function(b){
    b.addEventListener("click", function(){ showTab(b.dataset.tab); });
  });
  $("chanBtn").addEventListener("click", function(){ showTab("channels"); });
  $("chanBack").addEventListener("click", function(){ showTab("clips"); });

  /* ---------- clip list ---------- */
  var chanFilter = ""; /* id ช่องที่กรองอยู่ ("" = ทุกช่อง) */
  function thumbUrl(id, q){ return "https://i.ytimg.com/vi/"+id+"/"+(q||"hq720")+".jpg"; } /* hq720 = 1280×720 คมกว่า mqdefault (320×180) ที่โดนซูมจนเบลอ */
  var THUMB_FALLBACK = { "hq720.jpg":"hqdefault.jpg", "hqdefault.jpg":"mqdefault.jpg" }; /* คลิปที่ไม่มี hq720 ถอยไปขนาดเล็กลง */
  document.addEventListener("error", function(e){
    var img = e.target; if(!img || img.tagName !== "IMG") return;
    var f = img.src.replace(/[^/]+$/, function(n){ return THUMB_FALLBACK[n] || n; });
    if(f !== img.src) img.src = f;
  }, true);
  function saveClips(){ if(!save(CACHE_STORE, { at: cache.at, clips: clips })) toast("พื้นที่เก็บในเครื่องเต็ม บันทึกคลิปไม่ได้ ลองพักบางช่อง", true); }
  function isChan(c, ch){ return c.chId === ch.id || (!c.chId && c.channel === ch.title); }

  var PAGE = 40; /* แสดงทีละกี่คลิป */
  var RANGES = [{ d:30, t:"30 วัน" }, { d:90, t:"90 วัน" }, { d:365, t:"1 ปี" }, { d:0, t:"ทั้งหมด" }];
  var ui = { range:30, only:"", q:"", shown:PAGE }; /* only = "saved" ★ เก็บไว้ทำทีหลัง | "made" ทำแล้ว | "" ปกติ (สองโหมดแรกไม่สนช่วงเวลา) */
  function ageDays(c){ return (Date.now() - new Date(c.published).getTime()) / 864e5; }
  function vpd(c){ return c.views / Math.max(ageDays(c), 1); } /* วิวต่อวัน (คลิปอายุไม่ถึงวันนับเป็น 1 วัน) */
  function inRange(c, d){ return !d || ageDays(c) <= d; }
  function resetShown(){ ui.shown = PAGE; }

  function chipsHtml(items, cur, attr){
    return items.map(function(x){
      return '<button class="fchip'+(x.id===cur?' on':'')+'" data-'+attr+'="'+esc(x.id)+'">'+esc(x.t)+' <i>'+x.n+'</i></button>';
    }).join("");
  }
  $("rangeChips").addEventListener("click", function(e){
    var b = e.target.closest("button[data-range]"); if(!b) return;
    ui.only = ""; ui.range = +b.dataset.range; resetShown(); render();
  });
  $("chanChips").addEventListener("click", function(e){
    var b = e.target.closest("button[data-chan]"); if(!b) return;
    chanFilter = b.dataset.chan; resetShown(); render();
  });
  $("qInput").addEventListener("input", function(){ ui.q = this.value; resetShown(); render(); });
  $("sortSel").addEventListener("change", function(){ resetShown(); render(); });
  $("hideMade").addEventListener("change", function(){ resetShown(); render(); });

  var VIEW_ICON = {
    2: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/></svg>',
    3: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="5.5" height="16" rx="1.2"/><rect x="9.25" y="4" width="5.5" height="16" rx="1.2"/><rect x="16" y="4" width="5.5" height="16" rx="1.2"/></svg>'
  };
  function toggleOnly(k){ ui.only = ui.only === k ? "" : k; resetShown(); render(); }
  $("savedBtn").addEventListener("click", function(){ toggleOnly("saved"); });
  $("madeBtn").addEventListener("click", function(){ toggleOnly("made"); });
  $("viewBtn").addEventListener("click", function(){ data.cols = data.cols === 3 ? 2 : 3; persist(); render(); });

  function metricChip(c, sort){
    if(sort === "vpd") return '<span class="chip hot">'+MWIcon("flame")+fmtNumTh(Math.round(vpd(c)))+'/วัน</span>';
    if(sort === "score" && c.score) return '<span class="chip hot">'+MWIcon("flame")+c.score.toFixed(1)+'×</span>';
    return "";
  }

  function render(){
    var act = data.channels.filter(function(ch){ return !ch.paused; }); /* ช่องที่พักไว้ไม่โผล่ในลิสต์ */
    var fch = act.find(function(ch){ return ch.id === chanFilter; });
    if(chanFilter && !fch) chanFilter = "";
    var q = ui.q.trim().toLowerCase();
    var base = clips.filter(function(c){
      return act.some(function(ch){ return isChan(c, ch); }) && (!q || c.title.toLowerCase().indexOf(q) >= 0);
    });
    var byChan = fch ? base.filter(function(c){ return isChan(c, fch); }) : base;
    $("rangeChips").innerHTML = chipsHtml(RANGES.map(function(r){
      return { id:r.d, t:r.t, n: byChan.filter(function(c){ return inRange(c, r.d); }).length };
    }), ui.only ? null : ui.range, "range"); /* เปิดดู ★/ทำแล้ว อยู่ = ไม่ไฮไลต์ช่วงเวลา */
    var savedN = byChan.filter(function(c){ return data.saved[c.id]; }).length;
    var madeN = byChan.filter(function(c){ return data.made[c.id]; }).length;
    $("savedBtn").innerHTML = MWIcon("star") + savedN; $("savedBtn").classList.toggle("on", ui.only === "saved");
    $("madeBtn").innerHTML = MWIcon("check") + madeN; $("madeBtn").classList.toggle("on", ui.only === "made");
    function inView(c){ return ui.only === "saved" ? data.saved[c.id] : ui.only === "made" ? data.made[c.id] : inRange(c, ui.range); }
    var byRange = base.filter(inView);
    $("chanChips").innerHTML = act.length < 2 ? "" : chipsHtml([{ id:"", t:"ทุกช่อง", n:byRange.length }].concat(act.map(function(ch){
      return { id:ch.id, t:ch.title, n: byRange.filter(function(c){ return isChan(c, ch); }).length };
    })), chanFilter, "chan");

    var list = byChan.filter(inView);
    var matched = list.length;
    if($("hideMade").checked && ui.only !== "made") list = list.filter(function(c){ return !data.made[c.id]; });
    var s = $("sortSel").value;
    list.sort(function(a,b){
      if(s==="views") return b.views - a.views;
      if(s==="new") return new Date(b.published) - new Date(a.published);
      if(s==="score") return b.score - a.score;
      return vpd(b) - vpd(a);
    });
    $("list").classList.toggle("cols3", data.cols === 3);
    $("list").classList.toggle("onlymade", ui.only === "made");
    $("viewBtn").innerHTML = VIEW_ICON[data.cols === 3 ? 2 : 3]; /* โชว์ไอคอนของมุมมองที่จะสลับไป */
    var shown = list.slice(0, ui.shown);
    $("listInfo").textContent = clips.length ? "แสดง "+shown.length+" จาก "+list.length+" คลิป"+(matched > list.length ? " (ซ่อนทำแล้ว "+(matched-list.length)+")" : "")+(cache.at ? " · อัปเดต "+ago(new Date(cache.at).toISOString()) : "") : "";
    if(!list.length){
      var why = !data.channels.length ? "ยังไม่มีช่อง ไปแท็บ ช่อง เพื่อเพิ่มช่องก่อน"
        : !act.length ? "ช่องทั้งหมดพักอยู่ ไปเปิดช่องในแท็บ ช่อง"
        : !clips.length ? "ยังไม่ได้ดึงคลิป กดปุ่ม ดึงคลิป ด้านบน"
        : q ? "ไม่เจอคลิปที่ชื่อมีคำว่า \""+ui.q.trim()+"\""
        : matched ? "ไม่มีคลิปที่ยังไม่ได้ทำในช่วงนี้"
        : ui.only === "saved" ? "ยังไม่ได้เก็บคลิปไว้ กดดาวมุมล่างขวาของรูปคลิป"
        : ui.only === "made" ? "ยังไม่มีคลิปที่ทำแล้ว"
        : "ไม่มีคลิปในช่วงเวลานี้ ลองกดช่วงที่ยาวขึ้น";
      $("list").innerHTML = '<div class="empty"><div class="empty-ico">'+MWIcon("film")+'</div>'+esc(why)+'</div>';
      return;
    }
    $("list").innerHTML = shown.map(function(c){
      var made = !!data.made[c.id], sv = !!data.saved[c.id];
      return '<article class="card'+(made?' made':'')+'">'
        + '<div class="tbox"><button class="tplay" data-play="'+c.id+'" aria-label="ดูตัวอย่างคลิป"><img class="thumb" loading="lazy" decoding="async" src="'+thumbUrl(c.id)+'" alt=""><span class="pbtn">'+MWIcon("play")+'</span></button>'
        + metricChip(c, s)
        + (made ? '<span class="chip done">'+MWIcon("check")+'ทำแล้ว</span>' : '')
        + '<span class="chip views">'+fmtNumTh(c.views)+' วิว</span>'
        + '<button class="bm'+(sv?' on':'')+'" data-save="'+c.id+'" aria-label="'+(sv?'เลิกเก็บไว้':'เก็บไว้ทำทีหลัง')+'">'+MWIcon("star")+'</button></div>'
        + '<div class="cbody">'
        + '<div class="ctitle">'+esc(c.title)+'</div>'
        + '<div class="meta"><span>'+esc(c.channel)+'</span><span>'+ago(c.published)+'</span></div>'
        + '<div class="actions">'
        + '<button class="btn small" data-pick="'+c.id+'">เลือก</button>'
        + '<button class="btn small ghost ico" data-play="'+c.id+'" aria-label="ดูตัวอย่างคลิป" title="ดูตัวอย่าง">'+MWIcon("play")+'</button>'
        + '<button class="btn small ghost ico'+(made?' on':'')+'" data-made="'+c.id+'" aria-label="'+(made?'ยกเลิกทำแล้ว':'ทำเครื่องหมายว่าทำแล้ว')+'" title="'+(made?'ยกเลิกทำแล้ว':'ทำแล้ว')+'">'+MWIcon("check")+'</button>'
        + '</div></div></article>';
    }).join("") + (list.length > shown.length ? '<button class="btn ghost more" id="moreBtn">โหลดเพิ่ม (อีก '+(list.length - shown.length)+' คลิป)</button>' : "");
  }
  $("list").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    if(b.id === "moreBtn"){ ui.shown += PAGE; render(); return; }
    if(b.dataset.save){ if(data.saved[b.dataset.save]) delete data.saved[b.dataset.save]; else data.saved[b.dataset.save] = true; persist(); render(); }
    if(b.dataset.made){ data.made[b.dataset.made] = !data.made[b.dataset.made]; if(!data.made[b.dataset.made]) delete data.made[b.dataset.made]; persist(); render(); }
    if(b.dataset.pick){ var c = clips.find(function(x){ return x.id === b.dataset.pick; }); if(c) setPick(c); }
    if(b.dataset.play){ var p = clips.find(function(x){ return x.id === b.dataset.play; }); if(p) openPlayer(p); }
  });

  /* ---------- โมดัลกลาง (ตัวเล่นคลิป / ชีตเลือก / ประวัติ) ---------- */
  function openModal(id){ $(id).hidden = false; document.body.classList.add("noscroll"); }
  function closeModal(id){ $(id).hidden = true; if(!document.querySelector(".modal:not([hidden])")) document.body.classList.remove("noscroll"); }
  /* ปุ่มที่ต้องกดซ้ำเพื่อยืนยัน (ลบ) — กดครั้งแรกเปลี่ยนเป็น "แน่ใจนะ?" 3 วิ */
  function confirmTap(b, idle, onOk){
    if(!b.classList.contains("armed")){
      b.classList.add("armed"); b.textContent = "แน่ใจนะ?";
      setTimeout(function(){ b.classList.remove("armed"); b.textContent = idle; }, 3000);
      return;
    }
    b.classList.remove("armed"); b.textContent = idle; onOk();
  }

  /* ---------- ตัวเล่นในแอพ (embed ไม่ต้องออกไปหน้า YouTube) ---------- */
  var playing = null;
  function openPlayer(c){
    playing = c;
    $("pTitle").textContent = c.title;
    $("pFrame").innerHTML = '<iframe src="https://www.youtube.com/embed/'+c.id+'?autoplay=1&playsinline=1&rel=0&modestbranding=1" title="'+esc(c.title)+'" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    $("pOpen").href = "https://youtube.com/shorts/" + c.id;
    $("pMade").textContent = data.made[c.id] ? "ยกเลิกทำแล้ว" : "ทำแล้ว";
    openModal("player");
  }
  function closePlayer(){ $("pFrame").innerHTML = ""; closeModal("player"); playing = null; } /* ล้าง iframe เพื่อหยุดเสียง */
  $("pClose").addEventListener("click", closePlayer);
  $("player").addEventListener("click", function(e){ if(e.target === this) closePlayer(); });
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if(!$("vSheet").hidden) closeModal("vSheet"); else if(!$("selSheet").hidden) closeSheet(); else if(playing) closePlayer();
  });
  $("pPick").addEventListener("click", function(){ var c = playing; closePlayer(); if(c) setPick(c); });
  $("pCopy").addEventListener("click", function(){
    var url = $("pOpen").href;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){ toast("คัดลอกลิงก์แล้ว"); })
      .catch(function(){ MWDialog.copy(url); });
  });
  $("pMade").addEventListener("click", function(){
    var id = playing.id; if(data.made[id]) delete data.made[id]; else data.made[id] = true;
    persist(); render(); $("pMade").textContent = data.made[id] ? "ยกเลิกทำแล้ว" : "ทำแล้ว";
  });
  /* ---------- ดึง/อัปเดตคลิป ---------- */
  var syncing = false, AUTO_MS = 6 * 36e5; /* เปิดแอพแล้วเกิน 6 ชม. จากครั้งล่าสุด → อัปเดตคลิปใหม่ให้เอง */
  function setStatus(text, done, total){
    $("status").innerHTML = '<div class="msg"><span>'+esc(text)+'</span>'
      + (total ? '<div class="prog"><i style="width:'+Math.round(done/total*100)+'%"></i></div>' : '') + '</div>';
  }
  /* ดึงช่องเดียว แล้วรวมเข้า clips (แทนที่คลิปเดิมที่ id ซ้ำ = ยอดวิวใหม่) */
  async function syncOne(ch, onProgress){
    var known = {}; clips.forEach(function(c){ if(isChan(c, ch)) known[c.id] = c; });
    if(!Object.keys(known).length) ch.full = false; /* ไม่มีคลิปของช่องนี้ในเครื่อง (เช่นเพิ่งนำเข้า) → ย้อนหลังใหม่ */
    var r = await MWSync.syncChannel(ch, known, onProgress);
    var fresh = {}; r.clips.forEach(function(n){ fresh[n.id] = n; });
    clips = clips.map(function(c){ return fresh[c.id] || c; }).concat(r.clips.filter(function(n){ return !known[n.id]; }));
    clips.forEach(function(c){
      if(isChan(c, ch)){ c.chId = ch.id; c.channel = ch.title; c.score = c.views / Math.max(ch.subs || 0, 1000); } /* ผู้ติดตามเปลี่ยน → คำนวณใหม่ */
    });
    persist(); saveClips(); renderChannels();
  }
  function needSync(){ /* มีช่องที่ยังไม่ได้ดึงย้อนหลัง หรือครั้งล่าสุดเกิน 6 ชม. */
    return !!getKey() && data.channels.some(function(c){ return !c.paused && (!c.full || Date.now() - (cache.at || 0) > AUTO_MS); });
  }
  async function syncAll(auto){
    var chs = data.channels.filter(function(c){ return !c.paused; });
    if(syncing) return;
    if(!chs.length){ if(!auto) msg("status", data.channels.length ? "ช่องทั้งหมดพักอยู่ เปิดช่องในแท็บ ช่อง ก่อน" : "เพิ่มช่องในแท็บ ช่อง ก่อน", true); return; }
    syncing = true; $("fetchBtn").disabled = true;
    var failed = [];
    try{
      for(var i=0;i<chs.length;i++){
        var ch = chs[i], label = ch.title + (chs.length > 1 ? " ("+(i+1)+"/"+chs.length+")" : "");
        setStatus((auto ? "อัปเดตคลิปใหม่ · " : "กำลังดึง ")+label+(ch.full ? "" : " · ย้อนหลังทั้งช่อง (ครั้งแรกใช้เวลาหน่อย)"));
        try{ await syncOne(ch, function(done, total){ setStatus("กำลังดึง "+label+" "+done+"/"+total, done, total); }); }
        catch(err){ if(MWSync.fatal(err)) throw err; failed.push(ch.title); }
      }
      if(!failed.length) cache.at = Date.now();
      saveClips();
      msg("status", failed.length ? "ดึงไม่ได้: "+failed.join(", ") : "", !!failed.length);
    }catch(err){ msg("status", err.message, true); render(); renderChannels(); }
    syncing = false; $("fetchBtn").disabled = false;
    render(); renderChannels();
  }
  $("fetchBtn").addEventListener("click", function(){ syncAll(false); });

  /* ---------- manual link ---------- */
  /* ช่องว่าง = ปุ่ม "วาง" (ดึงจากคลิปบอร์ด) · มีลิงก์แล้ว = ปุ่ม "ใช้ลิงก์นี้" */
  function syncLinkBtn(){ $("linkBtn").textContent = $("linkInput").value.trim() ? "ใช้ลิงก์นี้" : "วาง"; }
  $("linkInput").addEventListener("input", syncLinkBtn);
  $("linkBtn").addEventListener("click", async function(){
    if(!$("linkInput").value.trim()){
      try{
        var t = (await navigator.clipboard.readText()).trim();
        if(!t){ toast("คลิปบอร์ดว่างอยู่ คัดลอกลิงก์ก่อน", true); return; }
        $("linkInput").value = t; syncLinkBtn(); msg("linkMsg","");
      }catch(err){ toast("วางไม่ได้ อนุญาตให้เข้าถึงคลิปบอร์ด หรือกดค้างที่ช่องแล้ววางเอง", true); $("linkInput").focus(); }
      return;
    }
    var id = videoId($("linkInput").value);
    if(!id){ msg("linkMsg","ลิงก์ไม่ถูกต้อง ต้องเป็นลิงก์ YouTube หรือ Shorts",true); return; }
    var made = !!data.made[id];
    var c = clips.find(function(x){ return x.id === id; });
    if(!c){
      try{
        var v = await yt("videos", { part:"snippet,statistics", id:id });
        var it = v.items && v.items[0];
        if(it) c = { id:id, title:it.snippet.title, channel:it.snippet.channelTitle, views:Number(it.statistics.viewCount)||0, published:it.snippet.publishedAt, score:0 };
      }catch(err){ /* ไม่มี key ก็ยังใช้ลิงก์ได้ */ }
    }
    if(!c) c = { id:id, title:"คลิป "+id, channel:"", views:0, published:new Date().toISOString(), score:0 };
    msg("linkMsg", made ? "คลิปนี้เคยทำแล้ว" : "", made);
    setPick(c);
  });

  /* ---------- pick bar ---------- */
  function setPick(c){ data.picked = c; persist(); renderPick(); }
  function renderPick(){
    var c = data.picked, bar = $("pickBar");
    if(!c || !$("tab-clips").classList.contains("on")){ bar.classList.remove("on"); return; }
    $("pickImg").src = thumbUrl(c.id);
    $("pickTitle").textContent = c.title;
    $("pickSub").textContent = (c.channel||"") + (data.made[c.id] ? " · เคยทำแล้ว" : "");
    bar.classList.add("on");
  }
  $("pickClear").addEventListener("click", function(){ data.picked = null; persist(); renderPick(); });
  $("pickGo").addEventListener("click", function(){ if(data.picked) showTab("script"); });
  $("pickBar").querySelector(".inner").addEventListener("click", function(e){ /* แตะแถบ (ไม่ใช่ปุ่ม) = เปิดตัวอย่างคลิปที่เลือก */
    if(data.picked && !e.target.closest("button")) openPlayer(data.picked);
  });

  /* ---------- ชีตเลือกตัวเลือก (แทน dropdown ของระบบที่แก้หน้าตาไม่ได้) ---------- */
  var sheetSel = null;
  function selTitle(sel){
    var l = document.querySelector('label[for="'+sel.id+'"]');
    return l ? l.textContent : (sel.getAttribute("aria-label") || "");
  }
  function syncSel(sel){
    var o = sel.options[sel.selectedIndex];
    sel._btn.innerHTML = '<span class="sel-main">'+esc(o ? o.textContent : "")+'</span>' + (o && o.dataset.tag ? '<span class="sel-tag">'+esc(o.dataset.tag)+'</span>' : "");
  }
  function openSheet(sel){
    sheetSel = sel; $("selTitle").textContent = selTitle(sel);
    var html = "";
    function row(o){
      return '<button class="opt'+(o.value === sel.value ? ' on' : '')+'" data-v="'+esc(o.value)+'"><span class="on-t"><b>'+esc(o.textContent)+'</b>'
        + (o.dataset.desc ? '<small>'+esc(o.dataset.desc)+'</small>' : '') + '</span>'
        + (o.dataset.tag ? '<span class="sel-tag">'+esc(o.dataset.tag)+'</span>' : '') + '</button>';
    }
    Array.prototype.forEach.call(sel.children, function(n){
      if(n.tagName === "OPTGROUP"){ html += '<div class="sel-group">'+esc(n.label)+'</div>' + Array.prototype.map.call(n.children, row).join(""); }
      else html += row(n);
    });
    $("selList").innerHTML = html;
    openModal("selSheet");
  }
  function closeSheet(){ closeModal("selSheet"); sheetSel = null; }
  $("selClose").addEventListener("click", closeSheet);
  $("selSheet").addEventListener("click", function(e){ if(e.target === this) closeSheet(); });
  $("selList").addEventListener("click", function(e){
    var b = e.target.closest("button[data-v]"); if(!b || !sheetSel) return;
    var sel = sheetSel; closeSheet();
    if(sel.value !== b.dataset.v){ sel.value = b.dataset.v; sel.dispatchEvent(new Event("change", { bubbles:true })); }
    syncSel(sel);
  });
  var sheetSels = Array.prototype.slice.call(document.querySelectorAll("select[data-sheet]"));
  sheetSels.forEach(function(sel){
    var b = document.createElement("button"); b.type = "button"; b.className = "sel-btn"; b.setAttribute("aria-haspopup","dialog");
    sel._btn = b; sel.after(b); b.addEventListener("click", function(){ openSheet(sel); }); syncSel(sel);
  });
  /* ai.js ตั้งค่า select ด้วยโค้ดหลังโหลด → อัปเดตข้อความบนปุ่มทุกครั้งที่เปลี่ยนแท็บ */
  document.addEventListener("mw:tab", function(){ sheetSels.forEach(syncSel); });

  /* ---------- toast ---------- */
  var toastT;
  function toast(text, err, ms){
    var t = $("toast"); t.textContent = text; t.classList.toggle("err", !!err); t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove("on"); }, ms || 2200);
  }

  /* ---------- channels ---------- */
  function renderChannels(){
    $("chanList").innerHTML = data.channels.length ? data.channels.map(function(c,i){
      var n = clips.filter(function(x){ return isChan(x, c); }).length;
      return '<div class="chan'+(c.paused?' paused':'')+'"><div><b>'+esc(c.title)+'</b><small>'+esc(c.handle)+(c.subs?' · '+fmtNumTh(c.subs)+' ผู้ติดตาม':'')+' · '+n+' คลิป'+(c.paused?' · พักอยู่':'')+'</small></div>'
        + '<div class="chan-act"><button class="btn small ghost" data-pause="'+i+'">'+(c.paused?'เปิด':'พัก')+'</button><button class="btn small ghost" data-del="'+i+'">ลบ</button></div></div>';
    }).join("") : '<div class="empty">ยังไม่มีช่อง</div>';
  }
  $("chanList").addEventListener("click", function(e){
    var b = e.target.closest("button[data-del], button[data-pause]"); if(!b) return;
    if(b.dataset.pause){
      var ch = data.channels[+b.dataset.pause]; ch.paused = !ch.paused; persist(); renderChannels(); render();
      toast(ch.paused ? "พัก "+ch.title+" แล้ว (ไม่ดึง ไม่โชว์ในลิสต์)" : "เปิด "+ch.title+" แล้ว กด ดึงคลิป เพื่ออัปเดต");
      return;
    }
    confirmTap(b, "ลบ", function(){
      var gone = data.channels.splice(+b.dataset.del, 1)[0];
      clips = clips.filter(function(c){ return !isChan(c, gone); }); saveClips(); /* ลบช่อง = เอาคลิปของช่องนั้นออกจากหน้าคลิปด้วย */
      persist(); renderChannels(); render();
    });
  });
  $("addChanBtn").addEventListener("click", async function(){
    var h = $("handleInput").value.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//,"").replace(/\/.*$/,"");
    if(!h){ return; }
    if(h[0] !== "@") h = "@" + h;
    if(data.channels.some(function(c){ return c.handle.toLowerCase() === h.toLowerCase(); })){ msg("chanMsg","เพิ่มช่องนี้ไปแล้ว",true); return; }
    if(syncing){ msg("chanMsg","กำลังดึงคลิปอยู่ รอให้เสร็จก่อน",true); return; }
    $("addChanBtn").disabled = true; msg("chanMsg","กำลังหาช่อง...");
    try{
      var r = await yt("channels", { part:"snippet,contentDetails,statistics", forHandle:h });
      var it = r.items && r.items[0];
      if(!it){ msg("chanMsg","ไม่เจอช่อง "+h+" เช็กตัวสะกด",true); }
      else{
        var ch = { handle:h, id:it.id, title:it.snippet.title, uploads:it.contentDetails.relatedPlaylists.uploads, subs:Number(it.statistics.subscriberCount)||0 };
        data.channels.push(ch); persist(); renderChannels(); $("handleInput").value = "";
        syncing = true;
        try{ await syncOne(ch, function(done, total){ msg("chanMsg","เพิ่มแล้ว กำลังดึงคลิปย้อนหลังของ "+ch.title+" "+done+"/"+total); }); }
        finally{ syncing = false; }
        var n = clips.filter(function(c){ return isChan(c, ch); }).length;
        renderChannels(); render(); msg("chanMsg","เพิ่ม "+ch.title+" แล้ว · ได้ "+n+" คลิป");
      }
    }catch(err){ msg("chanMsg", err.message, true); renderChannels(); render(); }
    $("addChanBtn").disabled = false;
  });

  /* ---------- settings ---------- */
  function keyState(){ $("ytState").innerHTML = getKey() ? MWIcon("check") + "ตั้งแล้ว" : "ยังไม่ได้ตั้ง"; $("ytState").classList.toggle("ok", !!getKey()); }
  $("ytKey").value = getKey(); keyState();
  function saveYt(){
    MWStore.set(KEY_STORE, $("ytKey").value.trim()); msg("setMsg","บันทึก key แล้ว"); keyState();
  }
  $("saveKey").addEventListener("click", saveYt);
  $("ytKey").addEventListener("change", saveYt); /* วาง/ลบ ผ่านปุ่มแล้วบันทึกให้เลย */

  /* ปุ่ม วาง / ลบ ของช่องกรอกในตั้งค่า (key, prompt) — ลบต้องกดซ้ำเพื่อยืนยัน กันพลาด prompt ยาวๆ หาย */
  function fireChange(el){ el.dispatchEvent(new Event("input", { bubbles:true })); el.dispatchEvent(new Event("change", { bubbles:true })); }
  $("tab-settings").addEventListener("click", async function(e){
    var b = e.target.closest("button[data-paste], button[data-clear]"); if(!b) return;
    var el = $(b.dataset.paste || b.dataset.clear);
    if(b.dataset.paste){
      try{
        var t = await navigator.clipboard.readText();
        if(!t){ toast("คลิปบอร์ดว่างอยู่", true); return; }
        el.value = "trim" in b.dataset ? t.trim() : t; fireChange(el); toast("วางแล้ว");
      }catch(err){ toast("วางไม่ได้ อนุญาตให้เข้าถึงคลิปบอร์ด หรือกดค้างที่ช่องแล้ววางเอง", true); }
      return;
    }
    if(!el.value){ toast("ช่องนี้ว่างอยู่แล้ว", true); return; }
    confirmTap(b, b.textContent, function(){ el.value = ""; fireChange(el); toast("ลบแล้ว"); });
  });
  $("exportBtn").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify({ v:3, channels:data.channels, made:data.made, saved:data.saved, history: MW.history ? MW.history.all() : [],
                                    ai: MW.aiCfg ? MW.aiCfg.get() : null, tts: MW.ttsCfg ? MW.ttsCfg.get() : null }, null, 2)], { type:"application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "meowrin-factory-backup.json"; a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  });
  $("importBtn").addEventListener("click", function(){ $("importFile").click(); });
  $("importFile").addEventListener("change", function(){
    var f = this.files[0]; if(!f) return;
    var r = new FileReader();
    r.onload = async function(){
      try{
        var j = JSON.parse(r.result);
        if(!Array.isArray(j.channels) || typeof j.made !== "object") throw 0;
        /* prompt/เสียงในไฟล์จะทับของที่มีในเครื่อง → ถามก่อนถ้าของเดิมมีเนื้อหาและต่างจากในไฟล์ */
        var clash = (j.ai && MW.aiCfg && MW.aiCfg.differs(j.ai)) || (j.tts && MW.ttsCfg && MW.ttsCfg.differs(j.tts));
        if(clash && !await MWDialog.confirm("ไฟล์สำรองมี prompt/เสียง ที่ต่างจากในเครื่อง นำเข้าแล้วจะทับของในเครื่อง ตกลงไหม?")){ msg("setMsg","ยกเลิกการนำเข้า ไม่มีอะไรเปลี่ยน"); return; }
        data.channels = j.channels.map(function(ch){ ch.full = false; return ch; }); /* คลิปไม่อยู่ในไฟล์สำรอง → ให้ดึงย้อนหลังใหม่ */
        data.made = j.made; if(j.saved && typeof j.saved === "object") data.saved = j.saved; persist();
        if(Array.isArray(j.history) && MW.history) MW.history.merge(j.history);
        if(j.ai && MW.aiCfg) MW.aiCfg.set(j.ai);
        if(j.tts && MW.ttsCfg) MW.ttsCfg.set(j.tts);
        renderChannels(); render();
        msg("setMsg","นำเข้าแล้ว" + (j.ai ? " (รวม prompt" + (j.tts ? "และเสียง" : "") + ")" : "") + " กด ดึงคลิป เพื่อโหลดคลิปของช่องกลับมา · key ไม่อยู่ในไฟล์สำรอง ใส่ใหม่เองในตั้งค่า");
      }catch(e){ msg("setMsg","ไฟล์ไม่ถูกต้อง",true); }
    };
    r.readAsText(f);
  });

  window.MW = { syncSelects: function(){ sheetSels.forEach(syncSel); }, toast: toast, data: data, persist: persist, esc: esc, showTab: showTab, videoId: videoId, onMadeChange: render,
                setPick: setPick, ago: ago, thumbUrl: thumbUrl, openModal: openModal, closeModal: closeModal, confirmTap: confirmTap, openPlayer: openPlayer };
  /* ป้ายสถานะบนหัวข้อที่พับอยู่ในตั้งค่า (อ่านจาก MWStore เปลี่ยนเมื่อไหร่อัปเดตเอง ไม่ต้องให้แต่ละไฟล์ตั้งเอง) */
  function stTag(id, kind, text){ var el = $(id); if(el){ el.className = "state " + kind; el.textContent = text; } }
  function settingsTags(){
    var yt = !!getKey(), or = !!load("mw_openrouter_key_v1", ""), ai = load("mw_ai_cfg_v1", {}) || {}, tt = load("mw_tts_cfg_v1", {}) || {};
    var miss = []; if(!yt) miss.push("YouTube"); if(!or) miss.push("OpenRouter");
    stTag("tagKeys", miss.length ? "warn" : "ok", miss.length ? "ขาด " + miss.join(", ") : "ครบ");
    stTag("tagAi", or ? "ok" : "warn", or ? String(ai.model || "").replace(/^.*\//, "") || "ค่าเริ่มต้น" : "ไม่มี OpenRouter key");
    var el = !!load("mw_eleven_key_v1", ""), n = (tt.voices || []).length;
    stTag("tagVoice", el && n ? "ok" : el || n ? "warn" : "idle", el && n ? n + " เสียง" : !el ? "ยังไม่มี key" : "ยังไม่มีเสียง");
    stTag("tagPrompts", "idle", (ai.prompts || []).length + " อัน");
  }
  MWStore.on(settingsTags); settingsTags();
  render(); renderChannels(); renderPick();
  /* เปิดแอพ: ถ้ามี key และ (เกิน 6 ชม. หรือมีช่องที่ยังไม่ได้ดึงย้อนหลัง) → อัปเดตให้เอง */
  if(needSync()) syncAll(true);
  /* มือถือพักแท็บเบื้องหลังแล้วการดึงค้าง → กลับมาเปิดแอพแล้วดึงต่อให้ (ข้ามคลิปที่มีแล้ว) */
  document.addEventListener("visibilitychange", function(){ if(!document.hidden && !syncing && needSync()) syncAll(true); });
})();

/* ---------- PWA: service worker ---------- */
if ("serviceWorker" in navigator) {
  /* app.js ถูกโหลดโดย store.js หลังข้อมูลพร้อม อาจหลัง window load ไปแล้ว */
  var regSw = function(){ navigator.serviceWorker.register("sw.js").catch(function(){ /* ไม่ลงทะเบียนก็ยังใช้แอพได้ */ }); };
  if(document.readyState === "complete") regSw(); else window.addEventListener("load", regSw);
}
