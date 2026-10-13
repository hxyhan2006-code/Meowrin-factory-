/* Service worker แบบ passthrough: ไม่แคชอะไร ไม่แตะ API/CDN แค่ทำให้ติดตั้งเป็นแอพได้ */
self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function(e){ e.respondWith(fetch(e.request)); });
