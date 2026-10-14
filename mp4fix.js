/* mp4fix.js — แปลง fragmented MP4 (ที่ MediaRecorder ของ Chrome/Brave สร้าง) เป็น MP4 ปกติ (moov ครบ มีความยาว/ตารางตัวอย่าง)
   เพราะ CapCut ฯลฯ มักไม่รับ fMP4 ("ไม่รองรับไฟล์") · ไม่เข้ารหัสใหม่ แค่จัดกล่องใหม่ เร็วและไม่เสียคุณภาพ
   ใช้: MP4Fix.remux(blob) → Promise<Blob> (ไม่ใช่ fMP4 หรืออ่านไม่ได้ → คืนไฟล์เดิม) */
(function(){
  "use strict";
  var CONT = { moov:1, trak:1, mdia:1, minf:1, stbl:1, mvex:1, moof:1, traf:1 };
  function u32(b, o){ return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function i32(b, o){ return u32(b, o) | 0; }
  function typ(b, o){ return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
  function boxes(b, s, e){ /* อ่านกล่องระดับเดียวระหว่าง s..e (ลงลูกเมื่อเป็น container) */
    var out = [];
    while(s + 8 <= e){
      var sz = u32(b, s), t = typ(b, s + 4), h = 8;
      if(sz === 1){ sz = u32(b, s + 8) * 4294967296 + u32(b, s + 12); h = 16; } else if(sz === 0) sz = e - s;
      if(sz < h || s + sz > e) break;
      var bx = { t:t, s:s, e:s + sz, h:h };
      if(CONT[t]) bx.k = boxes(b, s + h, s + sz);
      out.push(bx); s += sz;
    }
    return out;
  }
  function find(list, t){ return (list || []).filter(function(x){ return x.t === t; }); }
  function w32(n){ return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function mk(t, payload){ var n = 8 + payload.length, o = new Uint8Array(n); o.set(w32(n), 0); o.set([t.charCodeAt(0), t.charCodeAt(1), t.charCodeAt(2), t.charCodeAt(3)], 4); o.set(payload, 8); return o; }
  function cat(list){ var n = 0, o, p = 0; list.forEach(function(x){ n += x.length; }); o = new Uint8Array(n); list.forEach(function(x){ o.set(x, p); p += x.length; }); return o; }
  function full(ver, flags, words){ return cat([[ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], cat(words.map(function(w){ return new Uint8Array(w32(w >>> 0)); }))]); }
  function put(buf, o, v, big){ if(big){ var hi = Math.floor(v / 4294967296), lo = v >>> 0; buf.set(w32(hi), o); buf.set(w32(lo), o + 4); } else buf.set(w32(v >>> 0), o); }

  async function remux(blob){
    try{
      var b = new Uint8Array(await blob.arrayBuffer()), top = boxes(b, 0, b.length);
      var moov = find(top, "moov")[0], moofs = find(top, "moof");
      if(!moov || !moofs.length) return blob;
      var trex = {}; find(find(moov.k, "mvex")[0] && find(moov.k, "mvex")[0].k, "trex").forEach(function(x){
        trex[u32(b, x.s + 12)] = { dur:u32(b, x.s + 20), size:u32(b, x.s + 24), flags:u32(b, x.s + 28) };
      });
      /* 1) เก็บตัวอย่างทั้งหมดจากทุก moof: ต่อ track = [{d, sz, f(sync), c(cts offset)}] และรายการ run ตามลำดับไฟล์ */
      var tr = {}, runs = [];
      moofs.forEach(function(mf){
        find(mf.k, "traf").forEach(function(tf){
          var th = find(tf.k, "tfhd")[0]; if(!th) return;
          var fl = u32(b, th.s + 8) & 0xffffff, id = u32(b, th.s + 12), p = th.s + 16, base = mf.s, def = trex[id] || { dur:0, size:0, flags:0 };
          if(fl & 1){ base = u32(b, p) * 4294967296 + u32(b, p + 4); p += 8; }
          if(fl & 2) p += 4;
          var dd = def.dur, ds = def.size, df = def.flags;
          if(fl & 8){ dd = u32(b, p); p += 4; } if(fl & 0x10){ ds = u32(b, p); p += 4; } if(fl & 0x20){ df = u32(b, p); p += 4; }
          var ptr = mf.e + 8, T = tr[id] || (tr[id] = []);
          find(tf.k, "trun").forEach(function(tn){
            var ver = b[tn.s + 8], tfl = u32(b, tn.s + 8) & 0xffffff, n = u32(b, tn.s + 12), q = tn.s + 16, first = null;
            if(tfl & 1){ ptr = base + i32(b, q); q += 4; }
            if(tfl & 4){ first = u32(b, q); q += 4; }
            var start = ptr, cnt = 0;
            for(var i = 0; i < n; i++){
              var d = dd, sz = ds, f = df, c = 0;
              if(tfl & 0x100){ d = u32(b, q); q += 4; } if(tfl & 0x200){ sz = u32(b, q); q += 4; }
              if(tfl & 0x400){ f = u32(b, q); q += 4; } else if(i === 0 && first !== null) f = first;
              if(tfl & 0x800){ c = ver ? i32(b, q) : u32(b, q); q += 4; }
              T.push({ d:d, sz:sz, sync:!(f & 0x10000), c:c }); ptr += sz; cnt++;
            }
            runs.push({ id:id, from:start, to:ptr, n:cnt });
          });
        });
      });
      if(!runs.length) return blob;

      /* 2) สร้าง moov ใหม่ (ต้องรู้ขนาดก่อนถึงคำนวณ offset ของ chunk → สร้าง 2 รอบ) */
      var mvhd = find(moov.k, "mvhd")[0], mvBig = b[mvhd.s + 8] === 1, mvTs = u32(b, mvhd.s + (mvBig ? 28 : 20));
      function build(dataStart){
        var pos = dataStart, off = {}, chunkOf = {}; /* off[id] = [chunk offsets] */
        runs.forEach(function(r){ (off[r.id] = off[r.id] || []).push(pos); (chunkOf[r.id] = chunkOf[r.id] || []).push(r.n); pos += r.to - r.from; });
        var maxDur = 0, traks = [];
        find(moov.k, "trak").forEach(function(tk){
          var tkhd = find(tk.k, "tkhd")[0], id = u32(b, tkhd.s + (b[tkhd.s + 8] === 1 ? 28 : 20)), S = tr[id] || [];
          var mdia = find(tk.k, "mdia")[0], mdhd = find(mdia.k, "mdhd")[0], big = b[mdhd.s + 8] === 1, ts = u32(b, mdhd.s + (big ? 28 : 20));
          var minf = find(mdia.k, "minf")[0], stbl = find(minf.k, "stbl")[0], stsd = find(stbl.k, "stsd")[0];
          var dur = S.reduce(function(t, x){ return t + x.d; }, 0);
          maxDur = Math.max(maxDur, Math.round(dur / ts * mvTs));
          /* ตาราง stts/ctts/stss/stsc/stsz/stco */
          var stts = [], r;
          S.forEach(function(x){ var l = stts[stts.length - 1]; if(l && l[1] === x.d) l[0]++; else stts.push([1, x.d]); });
          var hasC = S.some(function(x){ return x.c; }), ctts = [];
          S.forEach(function(x){ var l = ctts[ctts.length - 1]; if(l && l[1] === x.c) l[0]++; else ctts.push([1, x.c]); });
          var sync = [], allSync = true; S.forEach(function(x, i){ if(x.sync) sync.push(i + 1); else allSync = false; });
          var stsc = [], ch = chunkOf[id] || [];
          ch.forEach(function(n, i){ var l = stsc[stsc.length - 1]; if(!l || l[1] !== n) stsc.push([i + 1, n, 1]); });
          var parts = [mk("stsd", b.subarray(stsd.s + 8, stsd.e)),
            mk("stts", full(0, 0, [stts.length].concat(stts.reduce(function(a, x){ return a.concat(x); }, [])))),
            mk("stsc", full(0, 0, [stsc.length].concat(stsc.reduce(function(a, x){ return a.concat(x); }, [])))),
            mk("stsz", full(0, 0, [0, S.length].concat(S.map(function(x){ return x.sz; })))),
            mk("stco", full(0, 0, [(off[id] || []).length].concat(off[id] || [])))];
          if(hasC) parts.splice(1, 0, mk("ctts", full(1, 0, [ctts.length].concat(ctts.reduce(function(a, x){ return a.concat(x); }, [])))));
          if(!allSync) parts.splice(1, 0, mk("stss", full(0, 0, [sync.length].concat(sync))));
          var newStbl = mk("stbl", cat(parts));
          /* ประกอบ trak ใหม่ โดยคัดลอกกล่องเดิมแล้วแก้ความยาว */
          var tkBytes = b.slice(tkhd.s, tkhd.e); put(tkBytes, b[tkhd.s + 8] === 1 ? 36 : 28, Math.round(dur / ts * mvTs), b[tkhd.s + 8] === 1);
          var mdBytes = b.slice(mdhd.s, mdhd.e); put(mdBytes, big ? 32 : 24, dur, big);
          var mdiaKids = find(mdia.k, "hdlr").map(function(x){ return b.slice(x.s, x.e); });
          var minfKids = minf.k.filter(function(x){ return x.t !== "stbl"; }).map(function(x){ return b.slice(x.s, x.e); }).concat([newStbl]);
          traks.push(mk("trak", cat([tkBytes, mk("mdia", cat([mdBytes].concat(mdiaKids, [mk("minf", cat(minfKids))])))])));
        });
        var mvBytes = b.slice(mvhd.s, mvhd.e); put(mvBytes, mvBig ? 32 : 24, maxDur, mvBig);
        return mk("moov", cat([mvBytes].concat(traks)));
      }
      var ftyp = mk("ftyp", cat([[105, 115, 111, 109], w32(512), [105, 115, 111, 109, 105, 115, 111, 50, 97, 118, 99, 49, 109, 112, 52, 49]]));
      var total = runs.reduce(function(t, r){ return t + r.to - r.from; }, 0);
      var m1 = build(0), m2 = build(ftyp.length + m1.length + 8);
      if(m2.length !== m1.length) return blob;
      var data = runs.map(function(r){ return blob.slice(r.from, r.to); });
      return new Blob([ftyp, m2, new Uint8Array(w32(8 + total).concat([109, 100, 97, 116]))].concat(data), { type:"video/mp4" });
    }catch(err){ return blob; }
  }
  window.MP4Fix = { remux:remux };
})();
