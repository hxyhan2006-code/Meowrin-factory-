/* ชั้น YouTube Data API: เรียก API + ดึง Shorts ของช่อง (ย้อนหลังทั้งหมด / เฉพาะคลิปใหม่)
   โหลดก่อน app.js — ไม่แตะ DOM ไม่แตะ data ของแอพ ส่งออกเป็น window.MWSync */
(function(){
  "use strict";
  var KEY_STORE = "mw_key_v1";
  var API = "https://www.googleapis.com/youtube/v3/";
  var PAGE = 50;           /* เพดานของ YouTube ต่อหนึ่งคำขอ */
  var MAX_PER_CHANNEL = 1000;
  var MAX_SECS = 180;      /* เก็บเฉพาะคลิปสั้น */

  function getKey(){ return MWStore.get(KEY_STORE, "") || ""; }
  function secs(iso){ var m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso||""); if(!m) return 0; return (+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0); }
  function fatal(err){ return /โควต้า|API key/.test(err.message); } /* error ที่ลองช่องอื่นต่อไปก็ไม่มีประโยชน์ */

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

  function playlistPage(listId, token){
    var p = { part:"contentDetails", playlistId: listId, maxResults: PAGE };
    if(token) p.pageToken = token;
    return yt("playlistItems", p);
  }

  /* หน้าแรกของ playlist: ลองอันที่เคยใช้ได้ก่อน → playlist Shorts ล้วน (UC… → UUSH…) → playlist อัปโหลดทั้งหมด
     (ถ้าใช้อัปโหลดทั้งหมด ช่องที่ลงวิดีโอยาวเยอะจะได้ Shorts น้อยหรือ 0) */
  async function firstPage(ch){
    var lists = [];
    if(ch.pl) lists.push(ch.pl);
    if(/^UC/.test(ch.id)) lists.push("UUSH" + ch.id.slice(2));
    lists.push(ch.uploads);
    for(var i=0;i<lists.length;i++){
      if(lists.indexOf(lists[i]) !== i) continue; /* ข้ามตัวซ้ำ */
      try{
        var res = await playlistPage(lists[i]);
        if((res.items||[]).length) return { list: lists[i], res: res };
      }catch(err){ if(fatal(err)) throw err; }
    }
    return null;
  }

  async function details(ch, ids){
    var vs = await yt("videos", { part:"snippet,contentDetails,statistics", id: ids.join(",") });
    var out = [];
    (vs.items||[]).forEach(function(v){
      var d = secs(v.contentDetails.duration);
      if(d === 0 || d > MAX_SECS) return;
      out.push({ id:v.id, title:v.snippet.title, channel:ch.title, chId:ch.id,
                 views:Number(v.statistics.viewCount)||0, published:v.snippet.publishedAt });
    });
    return out;
  }

  /* ดึงคลิปของช่องเดียว
     known = { videoId: clip } ของคลิปที่มีอยู่แล้วในช่องนี้
     ch.full ยังไม่จริง → ย้อนหลังทั้งหมด (ข้ามคลิปที่มีแล้ว ไม่เสียโควต้าซ้ำ) แล้วตั้ง ch.full = true
     ch.full จริง      → ดูหน้าใหม่ล่าสุด อัปเดตยอดวิว และเดินต่อเฉพาะตอนที่ยังเจอคลิปใหม่
     คืน { clips: [คลิปใหม่/ที่อัปเดตยอดวิว] } และอัปเดต ch.subs, ch.pl, ch.full */
  async function syncChannel(ch, known, onProgress){
    var cs = await yt("channels", { part:"statistics", id: ch.id });
    ch.subs = Number(cs.items && cs.items[0] && cs.items[0].statistics.subscriberCount) || 0;
    var first = await firstPage(ch);
    if(!first){ ch.full = true; return { clips: [] }; }
    ch.pl = first.list;
    var res = first.res, backfill = !ch.full, out = [], seen = 0;
    var total = Math.min((res.pageInfo && res.pageInfo.totalResults) || 0, MAX_PER_CHANNEL);
    for(;;){
      var ids = (res.items||[]).map(function(it){ return it.contentDetails.videoId; });
      seen += ids.length;
      var anyNew = ids.some(function(id){ return !known[id]; });
      var need = backfill ? ids.filter(function(id){ return !known[id]; }) : ids; /* ปกติรีเฟรชยอดวิวทั้งหน้าด้วย */
      if(need.length) out = out.concat(await details(ch, need));
      if(onProgress) onProgress(Math.min(seen, total || seen), total || seen);
      var next = res.nextPageToken;
      if(!next || seen >= MAX_PER_CHANNEL || (!backfill && !anyNew)) break;
      res = await playlistPage(first.list, next);
    }
    if(backfill) ch.full = true; /* ถ้าระหว่างทางมี error จะข้ามบรรทัดนี้ ครั้งหน้าเริ่มย้อนหลังต่อ (ข้ามของเดิมให้) */
    return { clips: out };
  }

  window.MWSync = { yt: yt, getKey: getKey, syncChannel: syncChannel, fatal: fatal };
})();
