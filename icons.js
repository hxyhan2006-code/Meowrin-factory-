/* icons.js (window.MWIcon) — ไอคอนเส้นของแอพ (แทนอีโมจิ) โหลดเป็นตัวแรกใน data-boot ของทั้งสองหน้า
   ใส่ sprite ลงหน้าเอง · ใน HTML ใช้ <svg class="ic" aria-hidden="true"><use href="#i-ชื่อ"/></svg> · ใน JS ใช้ MWIcon("ชื่อ") ได้สตริง <svg> พร้อมต่อ innerHTML
   สไตล์ .ic อยู่ใน style.css / footage.css (สีตามตัวอักษร ขนาด 1.1em) · เพิ่มไอคอนใหม่ = เพิ่มบรรทัดใน ICONS */
(function(){
  "use strict";
  var ICONS = {
    repeat:  '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    target:  '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    user:    '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
    search:  '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6M8 11h6"/>',
    spark:   '<path d="M12 3l2.2 6.3L21 12l-6.8 2.7L12 21l-2.2-6.3L3 12l6.8-2.7z"/>',
    folder:  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    film:    '<rect x="2" y="2" width="20" height="20" rx="2.2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"/>',
    save:    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
    sun:     '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    flame:   '<path d="M12 22c4 0 7-2.7 7-7 0-3-1.8-5-3.2-6.6C14.5 6.9 13.7 5 14 2c-3 1.4-5.2 4.1-5.5 7.2-.9-.8-1.4-1.8-1.5-3C5.3 8 5 10.6 5 15c0 4.3 3 7 7 7z"/>',
    clock:   '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    speaker: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    hide:    '<path d="M17.9 17.9A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/>',
    warn:    '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    cloud:   '<path d="M18 10h-1.3A7 7 0 1 0 4 15.5 4.5 4.5 0 0 0 8.5 20H18a5 5 0 0 0 0-10z"/>',
    more:    '<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></g>',
    chev:    '<path d="M6 9l6 6 6-6"/>',
    down:    '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
    stop:    '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    star:    '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1z"/>',
    check:   '<path d="M20 6L9 17l-5-5"/>',
    x:       '<path d="M18 6L6 18M6 6l12 12"/>',
    play:    '<path fill="currentColor" stroke="none" d="M8 5v14l11-7z"/>',
    pause:   '<path fill="currentColor" stroke="none" d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    back:    '<path d="M15 18l-6-6 6-6"/>',
    fwd:     '<path d="M9 18l6-6-6-6"/>',
    info:    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'
  };
  function svg(name){ return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  window.MWIcon = svg;
  var sprite = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' + Object.keys(ICONS).map(function(k){
    return '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + ICONS[k] + '</symbol>'; }).join("") + '</svg>';
  document.body.insertAdjacentHTML("afterbegin", sprite);
})();
