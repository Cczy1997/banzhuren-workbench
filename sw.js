/* 班主任小台 · Service Worker（应用外壳缓存）
 * 作用：把 index.html 缓存到本地，刷新时秒开、弱网/离线也可用。
 * 缓存名含版本号：每次部署版本号变化 → 旧缓存自动失效、拉取新页面。
 * 仅缓存同源的 HTML 导航请求；supabase / 外部 API 等跨域请求一律走网络，绝不缓存。
 */
const CACHE = "wb-shell-resp-speed-2026-09-05";
self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){
  e.waitUntil((async function(){
    try{
      var keys = await caches.keys();
      await Promise.all(keys.map(function(k){ if(k !== CACHE) return caches.delete(k); }));
    }catch(_){}
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", function(e){
  var req = e.request;
  if(!req || req.method !== "GET") return;
  var url;
  try{ url = new URL(req.url); }catch(_){ return; }
  if(url.origin !== self.location.origin) return;            // 不缓存跨域（supabase 等）
  var p = url.pathname;
  var isShell = req.mode === "navigate" || p.endsWith("/") || p.endsWith("index.html") || p.endsWith(".html");
  if(!isShell) return;
  e.respondWith((async function(){
    var cache = await caches.open(CACHE);
    var cached = await cache.match(req);
    var network = fetch(req).then(function(res){
      if(res && res.status === 200 && res.type !== "opaque") cache.put(req, res.clone());
      return res;
    }).catch(function(){ return cached; });
    /* 网络优先：本应用部署频繁，缓存优先会导致"刚修好的版本用户要刷新两三次才拿得到"，
       被反复误判为"修复没生效"。这里改为先拿网络最新版，失败/弱网超时才回退缓存，
       既保证部署即时生效，又保留离线可用。 */
    try{
      return await Promise.race([
        network,
        new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("net-timeout")); }, 3000); })
      ]);
    }catch(_){
      return cached || network;   // 离线或 3 秒内没拿到 → 用本地缓存兜底
    }
  })());
});
