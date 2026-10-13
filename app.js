(function(){
  "use strict";
  var KEY_STORE = "mw_key_v1", DATA_STORE = "mw_data_v1", CACHE_STORE = "mw_cache_v1";
  var API = "https://www.googleapis.com/youtube/v3/";
  var $ = function(id){ return document.getElementById(id); };

  function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
  function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  var data = load(DATA_STORE, { channels: [], made: {}, picked: null });
  var cache = load(CACHE_STORE, { at: 0, clips: [] });
  var clips = cache.clips || [];

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function getKey(){ try{ return JSON.parse(localStorage.getItem(KEY_STORE) || '""'); }catch(e){ return ""; } }
  function persist(){ save(DATA_STORE, data); }
  function msg(el, text, err){ $(el).innerHTML = text ? '<div class="msg'+(err?' err':'')+'">'+esc(text)+'</div>' : ""; }
  function fmtNumTh(n){ n = Number(n)||0; if(n>=1e6) return (n/1e6).toFixed(1)+" ล้าน"; if(n>=1e5) return Math.round(n/1e5)/10+" แสน"; if(n>=1e4) return Math.round(n/1e3)/10+" หมื่น"; if(n>=1e3) return Math.round(n/100)/10+" พัน"; return String(n); }
  function ago(iso){ var d = Math.floor((Date.now()-new Date(iso).getTime())/864e5); if(d<1) return "วันนี้"; if(d<30) return d+" วันก่อน"; if(d<365) return Math.floor(d/30)+" เดือนก่อน"; return Math.floor(d/365)+" ปีก่อน"; }
  function secs(iso){ var m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso||""); if(!m) return 0; return (+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0); }

  function videoId(url){
    var m = String(url).trim().match(/(?:youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  async function yt(path, params){
    var key = getKey();
    if(!key) throw new Error("ยังไม่ได้ใส่ API key (แท็บตั้งค่า)");
    var q = new URLSearchParams(Object.assign({ key: key }, params));
    var res = await fetch(API + path + "?" + q.toString());
    var j = await res.json().catch(function(){ return {}; });
    if(!res.ok){
      var reason = j && j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
      if(reason === "quotaExceeded") throw new Error("โควต้า YouTube API วันนี้หมดแล้ว ลองใหม่พรุ่งนี้");
      if(res.status === 400 || res.status === 403) throw new Error("API key ใช้ไม่ได้ (เช็ก key และการจำกัดโดเมน): " + (reason||res.status));
      throw new Error("YouTube API error " + res.status);
    }
    return j;
  }

  /* ---------- tabs ---------- */
  function showTab(name){
    document.querySelectorAll("nav button").forEach(function(x){ x.setAttribute("aria-selected", x.dataset.tab === name ? "true":"false"); });
    document.querySelectorAll("section").forEach(function(s){ s.classList.toggle("on", s.id === "tab-"+name); });
    renderPick(); /* แถบคลิปที่เลือกโชว์เฉพาะแท็บ คลิป */
    document.dispatchEvent(new CustomEvent("mw:tab", { detail: name }));
  }
  document.querySelectorAll("nav button").forEach(function(b){
    b.addEventListener("click", function(){ showTab(b.dataset.tab); });
  });

  /* ---------- clip list ---------- */
  var chanFilter = ""; /* id ช่องที่กรองอยู่ ("" = ทุกช่อง) */
  function thumbUrl(id, q){ return "https://i.ytimg.com/vi/"+id+"/"+(q||"hq720")+".jpg"; } /* hq720 = 1280×720 คมกว่า mqdefault (320×180) ที่โดนซูมจนเบลอ */
  var THUMB_FALLBACK = { "hq720.jpg":"hqdefault.jpg", "hqdefault.jpg":"mqdefault.jpg" }; /* คลิปที่ไม่มี hq720 ถอยไปขนาดเล็กลง */
  document.addEventListener("error", function(e){
    var img = e.target; if(!img || img.tagName !== "IMG") return;
    var f = img.src.replace(/[^/]+$/, function(n){ return THUMB_FALLBACK[n] || n; });
    if(f !== img.src) img.src = f;
  }, true);
  function saveClips(){ save(CACHE_STORE, { at: Date.now(), clips: clips }); cache.at = Date.now(); }
  function isChan(c, ch){ return c.chId === ch.id || (!c.chId && c.channel === ch.title); }

  function renderChips(){
    var box = $("chanChips");
    if(data.channels.length < 2){ box.innerHTML = ""; return; }
    var chips = [{ id:"", title:"ทุกช่อง", n:clips.length }].concat(data.channels.map(function(ch){
      return { id:ch.id, title:ch.title, n:clips.filter(function(c){ return isChan(c, ch); }).length };
    }));
    box.innerHTML = chips.map(function(x){
      return '<button class="fchip'+(x.id===chanFilter?' on':'')+'" data-chan="'+esc(x.id)+'">'+esc(x.title)+' <i>'+x.n+'</i></button>';
    }).join("");
  }
  $("chanChips").addEventListener("click", function(e){
    var b = e.target.closest("button[data-chan]"); if(!b) return;
    chanFilter = b.dataset.chan; render();
  });

  function render(){
    if(chanFilter && !data.channels.some(function(ch){ return ch.id === chanFilter; })) chanFilter = "";
    renderChips();
    var list = clips.slice();
    var fch = data.channels.find(function(ch){ return ch.id === chanFilter; });
    if(fch) list = list.filter(function(c){ return isChan(c, fch); });
    var total = list.length;
    if($("hideMade").checked) list = list.filter(function(c){ return !data.made[c.id]; });
    var s = $("sortSel").value;
    list.sort(function(a,b){
      if(s==="views") return b.views - a.views;
      if(s==="new") return new Date(b.published) - new Date(a.published);
      return b.score - a.score;
    });
    $("listInfo").textContent = clips.length ? "แสดง "+list.length+" จาก "+total+" คลิป" + (cache.at ? " · อัปเดต "+ago(new Date(cache.at).toISOString()) : "") : "";
    if(!list.length){
      $("list").innerHTML = '<div class="empty"><div class="empty-ico">🎬</div>'+(clips.length ? "ไม่มีคลิปที่ยังไม่ได้ทำ" : data.channels.length ? "ยังไม่ได้ดึงคลิป กดปุ่ม ดึงคลิป ด้านบน" : "ยังไม่มีช่อง ไปแท็บ ช่อง เพื่อเพิ่มช่องก่อน")+'</div>';
      return;
    }
    $("list").innerHTML = list.map(function(c){
      var made = !!data.made[c.id];
      return '<article class="card'+(made?' made':'')+'">'
        + '<div class="tbox"><button class="tplay" data-play="'+c.id+'" aria-label="ดูตัวอย่างคลิป"><img class="thumb" loading="lazy" decoding="async" src="'+thumbUrl(c.id)+'" alt=""><span class="pbtn">▶</span></button>'
        + (c.score ? '<span class="chip hot">🔥 '+c.score.toFixed(1)+'×</span>' : '')
        + (made ? '<span class="chip done">✓ ทำแล้ว</span>' : '')
        + '<span class="chip views">'+fmtNumTh(c.views)+' วิว</span></div>'
        + '<div class="cbody">'
        + '<div class="ctitle">'+esc(c.title)+'</div>'
        + '<div class="meta"><span>'+esc(c.channel)+'</span><span>'+ago(c.published)+'</span></div>'
        + '<div class="actions">'
        + '<button class="btn small" data-pick="'+c.id+'">เลือก</button>'
        + '<button class="btn small ghost ico" data-play="'+c.id+'" aria-label="ดูตัวอย่างคลิป" title="ดูตัวอย่าง">▶</button>'
        + '<button class="btn small ghost ico'+(made?' on':'')+'" data-made="'+c.id+'" aria-label="'+(made?'ยกเลิกทำแล้ว':'ทำเครื่องหมายว่าทำแล้ว')+'" title="'+(made?'ยกเลิกทำแล้ว':'ทำแล้ว')+'">✓</button>'
        + '</div></div></article>';
    }).join("");
  }
  $("list").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    if(b.dataset.made){ data.made[b.dataset.made] = !data.made[b.dataset.made]; if(!data.made[b.dataset.made]) delete data.made[b.dataset.made]; persist(); render(); }
    if(b.dataset.pick){ var c = clips.find(function(x){ return x.id === b.dataset.pick; }); if(c) setPick(c); }
    if(b.dataset.play){ var p = clips.find(function(x){ return x.id === b.dataset.play; }); if(p) openPlayer(p); }
  });

  /* ---------- ตัวเล่นในแอพ (embed ไม่ต้องออกไปหน้า YouTube) ---------- */
  var playing = null;
  function openPlayer(c){
    playing = c;
    $("pTitle").textContent = c.title;
    $("pFrame").innerHTML = '<iframe src="https://www.youtube.com/embed/'+c.id+'?autoplay=1&playsinline=1&rel=0&modestbranding=1" title="'+esc(c.title)+'" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    $("pOpen").href = "https://youtube.com/shorts/" + c.id;
    $("pMade").textContent = data.made[c.id] ? "ยกเลิกทำแล้ว" : "ทำแล้ว";
    $("player").hidden = false; document.body.classList.add("noscroll");
  }
  function closePlayer(){ $("pFrame").innerHTML = ""; $("player").hidden = true; document.body.classList.remove("noscroll"); playing = null; } /* ล้าง iframe เพื่อหยุดเสียง */
  $("pClose").addEventListener("click", closePlayer);
  $("player").addEventListener("click", function(e){ if(e.target === this) closePlayer(); });
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if(!$("selSheet").hidden) closeSheet(); else if(playing) closePlayer();
  });
  $("pPick").addEventListener("click", function(){ var c = playing; closePlayer(); if(c) setPick(c); });
  $("pMade").addEventListener("click", function(){
    var id = playing.id; if(data.made[id]) delete data.made[id]; else data.made[id] = true;
    persist(); render(); $("pMade").textContent = data.made[id] ? "ยกเลิกทำแล้ว" : "ทำแล้ว";
  });
  $("sortSel").addEventListener("change", render);
  $("hideMade").addEventListener("change", render);

  /* ดึง Shorts ล่าสุดของช่องเดียว (ใช้ทั้งตอนกด ดึงคลิป และตอนเพิ่มช่องใหม่) */
  var PER_CHANNEL = 50; /* เพดานของ YouTube ต่อหนึ่งคำขอ */
  async function channelVideoIds(ch){
    /* playlist Shorts ล้วนของช่อง (UC… → UUSH…) ไม่งั้นช่องที่ลงวิดีโอยาวเยอะจะได้ Shorts น้อยหรือ 0
       ถ้าช่องไม่มี playlist นี้ ถอยไปใช้ playlist อัปโหลดทั้งหมด */
    var lists = [ch.uploads];
    if(/^UC/.test(ch.id)) lists.unshift("UUSH" + ch.id.slice(2));
    for(var i=0;i<lists.length;i++){
      try{
        var pl = await yt("playlistItems", { part:"contentDetails", playlistId: lists[i], maxResults: PER_CHANNEL });
        var ids = (pl.items||[]).map(function(it){ return it.contentDetails.videoId; });
        if(ids.length) return ids;
      }catch(err){ if(/โควต้า|API key/.test(err.message)) throw err; }
    }
    return [];
  }
  async function fetchChannel(ch){
    var ids = await channelVideoIds(ch);
    if(!ids.length) return [];
    var vs = await yt("videos", { part:"snippet,contentDetails,statistics", id: ids.join(",") });
    var cs = await yt("channels", { part:"statistics", id: ch.id });
    var subs = Number(cs.items && cs.items[0] && cs.items[0].statistics.subscriberCount) || 0;
    ch.subs = subs;
    var out = [];
    (vs.items||[]).forEach(function(v){
      var d = secs(v.contentDetails.duration);
      if(d === 0 || d > 180) return; /* เก็บเฉพาะคลิปสั้น */
      var views = Number(v.statistics.viewCount)||0;
      out.push({ id:v.id, title:v.snippet.title, channel:ch.title, chId:ch.id, views:views,
                 published:v.snippet.publishedAt, score: views / Math.max(subs, 1000) });
    });
    return out;
  }

  async function fetchClips(){
    if(!data.channels.length){ msg("status","เพิ่มช่องในแท็บ ช่อง ก่อน",true); return; }
    $("fetchBtn").disabled = true; msg("status","กำลังดึงคลิป...");
    try{
      var out = [], failed = [];
      for(var i=0;i<data.channels.length;i++){
        var ch = data.channels[i];
        try{ out = out.concat(await fetchChannel(ch)); }
        catch(err){ if(/โควต้า|API key/.test(err.message)) throw err; failed.push(ch.title); }
      }
      clips = out; saveClips(); persist();
      msg("status", failed.length ? "ดึงไม่ได้: "+failed.join(", ") : "", !!failed.length);
      render(); renderChannels();
    }catch(err){ msg("status", err.message, true); }
    $("fetchBtn").disabled = false;
  }
  $("fetchBtn").addEventListener("click", fetchClips);

  /* ---------- manual link ---------- */
  $("linkBtn").addEventListener("click", async function(){
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
    $("selSheet").hidden = false; document.body.classList.add("noscroll");
  }
  function closeSheet(){ $("selSheet").hidden = true; document.body.classList.remove("noscroll"); sheetSel = null; }
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
  function toast(text, err){
    var t = $("toast"); t.textContent = text; t.classList.toggle("err", !!err); t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove("on"); }, 2200);
  }

  /* ---------- channels ---------- */
  function renderChannels(){
    $("chanList").innerHTML = data.channels.length ? data.channels.map(function(c,i){
      var n = clips.filter(function(x){ return isChan(x, c); }).length;
      return '<div class="chan"><div><b>'+esc(c.title)+'</b><small>'+esc(c.handle)+(c.subs?' · '+fmtNumTh(c.subs)+' ผู้ติดตาม':'')+' · '+n+' คลิป</small></div><button class="btn small ghost" data-del="'+i+'">ลบ</button></div>';
    }).join("") : '<div class="empty">ยังไม่มีช่อง</div>';
  }
  $("chanList").addEventListener("click", function(e){
    var b = e.target.closest("button[data-del]"); if(!b) return;
    var gone = data.channels.splice(+b.dataset.del, 1)[0];
    clips = clips.filter(function(c){ return !isChan(c, gone); }); saveClips(); /* ลบช่อง = เอาคลิปของช่องนั้นออกจากหน้าคลิปด้วย */
    persist(); renderChannels(); render();
  });
  $("addChanBtn").addEventListener("click", async function(){
    var h = $("handleInput").value.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//,"").replace(/\/.*$/,"");
    if(!h){ return; }
    if(h[0] !== "@") h = "@" + h;
    if(data.channels.some(function(c){ return c.handle.toLowerCase() === h.toLowerCase(); })){ msg("chanMsg","เพิ่มช่องนี้ไปแล้ว",true); return; }
    $("addChanBtn").disabled = true; msg("chanMsg","กำลังหาช่อง...");
    try{
      var r = await yt("channels", { part:"snippet,contentDetails,statistics", forHandle:h });
      var it = r.items && r.items[0];
      if(!it){ msg("chanMsg","ไม่เจอช่อง "+h+" เช็กตัวสะกด",true); }
      else{
        var ch = { handle:h, id:it.id, title:it.snippet.title, uploads:it.contentDetails.relatedPlaylists.uploads, subs:Number(it.statistics.subscriberCount)||0 };
        data.channels.push(ch); persist(); renderChannels(); $("handleInput").value = "";
        msg("chanMsg","เพิ่มแล้ว กำลังดึงคลิปของ "+ch.title+"...");
        var got = await fetchChannel(ch); /* ดึงคลิปของช่องใหม่ทันที ไม่ต้องกดดึงคลิปเอง */
        clips = clips.filter(function(c){ return !isChan(c, ch); }).concat(got); saveClips(); persist();
        renderChannels(); render(); msg("chanMsg","เพิ่ม "+ch.title+" แล้ว · ได้ "+got.length+" คลิป");
      }
    }catch(err){ msg("chanMsg", err.message, true); }
    $("addChanBtn").disabled = false;
  });

  /* ---------- settings ---------- */
  function keyState(){ $("ytState").textContent = getKey() ? "✓ ตั้งแล้ว" : "ยังไม่ได้ตั้ง"; $("ytState").classList.toggle("ok", !!getKey()); }
  $("ytKey").value = getKey(); keyState();
  function saveYt(){
    try{ localStorage.setItem(KEY_STORE, JSON.stringify($("ytKey").value.trim())); msg("setMsg","บันทึก key แล้ว"); keyState(); }catch(e){ msg("setMsg","บันทึกไม่ได้",true); }
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
    if(!b.classList.contains("armed")){
      b.classList.add("armed"); b.textContent = "แน่ใจนะ?";
      setTimeout(function(){ b.classList.remove("armed"); b.textContent = "ลบ"; }, 3000);
      return;
    }
    b.classList.remove("armed"); b.textContent = "ลบ";
    el.value = ""; fireChange(el); toast("ลบแล้ว");
  });
  $("exportBtn").addEventListener("click", function(){
    var blob = new Blob([JSON.stringify({ channels:data.channels, made:data.made }, null, 2)], { type:"application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "meowrin-factory-backup.json"; a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  });
  $("importBtn").addEventListener("click", function(){ $("importFile").click(); });
  $("importFile").addEventListener("change", function(){
    var f = this.files[0]; if(!f) return;
    var r = new FileReader();
    r.onload = function(){
      try{
        var j = JSON.parse(r.result);
        if(!Array.isArray(j.channels) || typeof j.made !== "object") throw 0;
        data.channels = j.channels; data.made = j.made; persist(); renderChannels(); render(); msg("setMsg","นำเข้าแล้ว");
      }catch(e){ msg("setMsg","ไฟล์ไม่ถูกต้อง",true); }
    };
    r.readAsText(f);
  });

  window.MW = { toast: toast, data: data, persist: persist, esc: esc, showTab: showTab, videoId: videoId, onMadeChange: render };
  render(); renderChannels(); renderPick();
})();

/* ---------- PWA: service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("sw.js").catch(function(){ /* ไม่ลงทะเบียนก็ยังใช้แอพได้ */ });
  });
}
