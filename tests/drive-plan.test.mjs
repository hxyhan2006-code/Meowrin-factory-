import fs from 'node:fs';
const src = fs.readFileSync('gdrive.js','utf8');
const a = src.indexOf('  function h32('), b = src.indexOf('  async function pool(');
const m = new Function(src.slice(a,b) + '; return {cid,sig,comp,plan};')();
const lib = Array.from({length:6},(_,i)=>({id:'f'+i+'|'+i,name:'f'+i,album:'A',imgV:2,scenes:[1,2],status:'done'}));
const mk = (c,over={})=>({id:'d'+c.id,appProperties:{cid:m.cid(c),sig:m.sig(c)},description:m.comp(c),...over});
let ok = true; const t=(n,c)=>{ console.log(c?'ok  ':'FAIL',n); ok = ok && c; };
// 1) everything backed up -> nothing to do
let files = lib.map(c=>mk(c)); let p = m.plan(lib, files, {}); t('ครบแล้ว = 0', p.todo.length===0);
// 2) album renamed on 2 clips + 1 new
const lib2 = lib.map((c,i)=>i<2?{...c,album:'B'}:c).concat([{id:'new|1',name:'n',album:'A',imgV:2,scenes:[1],status:'done'}]);
p = m.plan(lib2, files, {}); t('ใหม่1 เปลี่ยน2 สาเหตุอัลบั้ม', p.fresh===1&&p.changed===2&&p.why['อัลบั้ม']===2);
// 3) duplicate files: stale one listed last must not force re-upload
const stale = mk({...lib[0],album:'OLD'}, {id:'dupstale'});
p = m.plan(lib, files.concat([stale]), {}); t('ไฟล์ซ้ำ (เก่าอยู่ท้าย) ไม่อัปซ้ำ', p.todo.length===0 && p.dups===1);
p = m.plan(lib, [stale].concat(files), {}); t('ไฟล์ซ้ำ (เก่าอยู่หน้า) ไม่อัปซ้ำ', p.todo.length===0);
// 4) Drive returns no appProperties but local map knows the ids
const bare = files.map(f=>({id:f.id})); const fmap = {}; lib.forEach(c=>fmap[m.cid(c)]={id:'d'+c.id,sig:m.sig(c)});
p = m.plan(lib, bare, fmap); t('Drive ไม่ส่ง appProperties แต่เครื่องจำได้ = ไม่อัปซ้ำ', p.todo.length===0);
p = m.plan(lib, bare, {}); t('ไม่มีทั้งสองอย่าง = อัปหมด', p.todo.length===6);
process.exit(ok?0:1);
