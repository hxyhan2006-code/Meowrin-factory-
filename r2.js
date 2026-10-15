/* r2.js — คลังวิดีโอบน Cloudflare R2 (S3-compatible) เรียกตรงจากเบราว์เซอร์ ไม่มีเซิร์ฟเวอร์
   เซ็นลิงก์แบบ AWS SigV4 (presigned URL) ด้วย WebCrypto → <video> สตรีม/กรอได้เอง, อัปโหลดทีละชิ้น (multipart) หยุดแล้วลองใหม่ได้
   ตั้งค่าใน MWStore key mw_r2_v1 { account, bucket, keyId, secret } (secret = คีย์ลับ ห้ามขึ้น Drive/GitHub)
   ต้องตั้ง CORS ใน R2 ให้โดเมนแอพ (GET/PUT/POST/DELETE/HEAD, AllowedHeaders *, ExposeHeaders ETag) */
(function(){
  "use strict";
  var KEY = "mw_r2_v1", PART = 10 * 1024 * 1024, PAR = 3, enc = new TextEncoder();
  var cfg = MWStore.get(KEY, {}) || {};
  function hex(b){ return Array.prototype.map.call(new Uint8Array(b), function(x){ return ("0" + x.toString(16)).slice(-2); }).join(""); }
  async function sha256(s){ return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
  async function hmac(key, s){
    var k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
  }
  function rfc(s){ return encodeURIComponent(s).replace(/[!'()*]/g, function(c){ return "%" + c.charCodeAt(0).toString(16).toUpperCase(); }); }
  /* ลิงก์เซ็นแล้ว (query auth) · o = { method, host, path, query, keyId, secret, region, expires, date } */
  async function presign(o){
    var d = o.date || new Date(), ad = d.toISOString().replace(/[:-]|\.\d{3}/g, ""), ds = ad.slice(0, 8), scope = ds + "/" + o.region + "/s3/aws4_request";
    var q = Object.assign({}, o.query || {}, { "X-Amz-Algorithm":"AWS4-HMAC-SHA256", "X-Amz-Credential":o.keyId + "/" + scope, "X-Amz-Date":ad, "X-Amz-Expires":String(o.expires || 3600), "X-Amz-SignedHeaders":"host" });
    var cq = Object.keys(q).map(function(k){ return [rfc(k), rfc(q[k])]; }).sort(function(a, b){ return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }).map(function(p){ return p[0] + "=" + p[1]; }).join("&");
    var cp = o.path.split("/").map(rfc).join("/");
    var creq = [o.method, cp, cq, "host:" + o.host, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
    var sts = ["AWS4-HMAC-SHA256", ad, scope, await sha256(creq)].join("\n");
    var k = await hmac("AWS4" + o.secret, ds); k = await hmac(k, o.region); k = await hmac(k, "s3"); k = await hmac(k, "aws4_request");
    return (o.scheme || "https") + "://" + o.host + cp + "?" + cq + "&X-Amz-Signature=" + hex(await hmac(k, sts));
  }
  function ready(){ return !!((cfg.account || cfg.endpoint) && cfg.bucket && cfg.keyId && cfg.secret); }
  function sign(method, key, query, expires){
    if(!ready()) return Promise.reject(new Error("ยังไม่ได้ตั้งค่าคลัง R2 (แท็บตั้งค่า)"));
    /* endpoint/region ไม่บังคับ: ว่าง = Cloudflare R2 · ใส่เองได้สำหรับที่เก็บแบบ S3 อื่น (เช่น Backblaze B2) */
    var ep = /^(https?):\/\/([^\/]+)/.exec(cfg.endpoint || "") || [0, "https", cfg.account + ".r2.cloudflarestorage.com"];
    return presign({ method:method, scheme:ep[1], host:ep[2], path:"/" + cfg.bucket + (key ? "/" + key : ""), query:query,
      keyId:cfg.keyId, secret:cfg.secret, region:cfg.region || "auto", expires:expires || 3600 });
  }
  async function req(method, key, query, body, headers, ms){ /* ms = เวลารอสูงสุด (ค่าเริ่มต้น 30 วิ ชิ้นอัปโหลดใหญ่ใช้นานกว่า) */
    var url = await sign(method, key, query), r, ac = new AbortController(), to = setTimeout(function(){ ac.abort(); }, ms || 30000);
    try{ r = await fetch(url, { method:method, body:body, headers:headers || {}, signal:ac.signal }); }
    catch(e){ throw new Error(e && e.name === "AbortError" ? "คลังไม่ตอบ (รอเกิน " + Math.round((ms || 30000) / 1000) + " วิ) เน็ตช้าหรือหลุด" : "ต่อคลังไม่ได้ (เน็ตหลุด หรือยังไม่ได้ตั้ง CORS ใน R2)"); }
    finally{ clearTimeout(to); }
    if(!r.ok){
      var t = await r.text().catch(function(){ return ""; }), m = /<Message>([^<]*)/.exec(t), c = /<Code>([^<]*)/.exec(t);
      throw new Error("คลัง " + r.status + (c ? " " + c[1] : "") + (m ? ": " + m[1] : ""));
    }
    return r;
  }
  function xml(t){ return new DOMParser().parseFromString(t, "application/xml"); }
  function tag(n, t){ var e = n.getElementsByTagName(t)[0]; return e ? e.textContent : ""; }

  /* รายการไฟล์ทั้งหมด [{ key, size, at }] */
  async function list(prefix){
    var out = [], token = "";
    do{
      var q = { "list-type":"2", "max-keys":"1000" }; if(prefix) q.prefix = prefix; if(token) q["continuation-token"] = token;
      var d = xml(await (await req("GET", "", q)).text());
      Array.prototype.forEach.call(d.getElementsByTagName("Contents"), function(c){ out.push({ key:tag(c, "Key"), size:Number(tag(c, "Size")), at:Date.parse(tag(c, "LastModified")) || 0 }); });
      token = tag(d, "IsTruncated") === "true" ? tag(d, "NextContinuationToken") : "";
    }while(token);
    return out;
  }
  /* ลิงก์ให้ <video> เล่น/กรอได้ (อายุ 6 ชม.) */
  function url(key){ return sign("GET", key, null, 21600); }
  /* โหลดทั้งไฟล์ (ใช้ตอนทำดัชนี: อ่านเฟรมจากไฟล์ในเครื่องเร็วกว่ากรอผ่านเน็ตมาก) */
  async function get(key, onProg){
    var r = await req("GET", key), n = Number(r.headers.get("Content-Length")) || 0, got = 0, parts = [];
    if(!r.body || !n) return r.blob();
    var rd = r.body.getReader();
    for(;;){ var x = await rd.read(); if(x.done) break; parts.push(x.value); got += x.value.length; if(onProg) onProg(got / n); }
    return new Blob(parts, { type:r.headers.get("Content-Type") || "video/mp4" });
  }
  async function retry(fn){ for(var i = 0; ; i++){ try{ return await fn(); }catch(e){ if(i >= 2) throw e; await new Promise(function(r){ setTimeout(r, 1500 * (i + 1)); }); } } }
  /* อัปโหลด (เล็ก = ครั้งเดียว · ใหญ่ = ทีละ 10 MB พร้อมกัน 3 ชิ้น) */
  async function put(key, file, onProg){
    var type = file.type || "video/mp4";
    if(file.size <= PART){ await retry(function(){ return req("PUT", key, null, file, { "Content-Type":type }, 300000); }); if(onProg) onProg(1); return; }
    var id = tag(xml(await (await req("POST", key, { uploads:"" }, null, { "Content-Type":type })).text()), "UploadId");
    if(!id) throw new Error("คลังไม่ให้เริ่มอัปโหลด");
    var n = Math.ceil(file.size / PART), etags = [], next = 0, done = 0;
    try{
      await Promise.all(Array.from({ length:Math.min(PAR, n) }, async function(){
        while(next < n){
          var i = next++, blob = file.slice(i * PART, Math.min(file.size, (i + 1) * PART));
          var r = await retry(function(){ return req("PUT", key, { partNumber:String(i + 1), uploadId:id }, blob, null, 300000); });
          etags[i] = r.headers.get("ETag"); if(!etags[i]) throw new Error("อ่าน ETag ไม่ได้ (CORS ต้อง ExposeHeaders ETag)");
          done++; if(onProg) onProg(done / n);
        }
      }));
      var body = "<CompleteMultipartUpload>" + etags.map(function(e, i){ return "<Part><PartNumber>" + (i + 1) + "</PartNumber><ETag>" + e + "</ETag></Part>"; }).join("") + "</CompleteMultipartUpload>";
      await req("POST", key, { uploadId:id }, body, { "Content-Type":"application/xml" });
    }catch(err){ req("DELETE", key, { uploadId:id }).catch(function(){}); throw err; }
  }
  async function del(key){ await req("DELETE", key); } /* ลบไฟล์เดียว (ใช้กับเสียงพากย์ voice/) */
  async function test(){ var q = { "list-type":"2", "max-keys":"1" }; await req("GET", "", q); return true; }

  window.R2 = { ready:ready, cfg:function(){ return cfg; }, setCfg:function(c){ cfg = c; MWStore.set(KEY, c); },
                list:list, url:url, get:get, put:put, del:del, test:test, presign:presign };
})();
