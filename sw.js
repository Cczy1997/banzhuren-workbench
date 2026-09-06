/* 班主任小台 · Service Worker（应用外壳缓存）
 * 策略：stale-while-revalidate（缓存优先 + 后台静默更新）
 *   - 有缓存：立即返回 → 刷新秒开；同时后台拉新版写进缓存
 *   - 新版内容有变化：postMessage('sw-update') → 页面弹「有新版本」提示条
 *   - 无缓存（首次访问 / 清过缓存）：等网络，拿到后写缓存
 *
 * 缓存名固定为 wb-shell-v1（**不随版本号变**）：
 *   以前缓存名带版本号，每次部署都把缓存整个作废 → 用户又要全量重下 2MB。
 *   现在版本号只用于 sw.js?v=xxx 让浏览器重新拉取本文件，缓存本身保持复用。
 * 升级兼容：activate 时把旧名字缓存里的条目迁移到 wb-shell-v1，再删旧的，
 *   避免"换缓存名那一次"用户被清空缓存、首次访问慢。
 *
 * 只缓存同源的 HTML 导航请求；supabase 等跨域请求一律走网络，绝不缓存。
 */
const CACHE = "wb-shell-v1";

/* 后台更新节流：SW 存活期间，同一导航 N 秒内不重复全量拉取（省流量） */
var lastCheck = 0;
var CHECK_INTERVAL = 60 * 1000;

self.addEventListener("install", function(){ self.skipWaiting(); });

self.addEventListener("activate", function(e){
  e.waitUntil((async function(){
    try{
      var keys = await caches.keys();
      var cache = await caches.open(CACHE);
      for(var i=0;i<keys.length;i++){
        if(keys[i] === CACHE) continue;
        try{
          var old = await caches.open(keys[i]);
          var reqs = await old.keys();
          for(var j=0;j<reqs.length;j++){
            var already = await cache.match(reqs[j]);
            if(!already){
              var m = await old.match(reqs[j]);
              if(m) await cache.put(reqs[j], m.clone());   // 迁移，避免重新下载
            }
          }
          await caches.delete(keys[i]);
        }catch(_){}
      }
    }catch(_){}
    await self.clients.claim();
  })());
});

/* 页面点「更新」时：立即跳过等待、接管页面 */
self.addEventListener("message", function(e){
  if(e && e.data && e.data.type === "skip-waiting"){ self.skipWaiting(); }
});

function notifyUpdate(){
  self.clients.matchAll({ includeUncontrolled:true }).then(function(cs){
    cs.forEach(function(c){ try{ c.postMessage({ type:"sw-update" }); }catch(_){} });
  });
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(!req || req.method !== "GET") return;
  var url;
  try{ url = new URL(req.url); }catch(_){ return; }
  if(url.origin !== self.location.origin) return;        // 跨域（supabase）不缓存
  var p = url.pathname;
  var isShell = req.mode === "navigate" || p.endsWith("/") || p.endsWith("index.html") || p.endsWith(".html");
  if(!isShell) return;

  e.respondWith((async function(){
    var cache = await caches.open(CACHE);
    var cached = await cache.match(req);

    /* 后台更新：拉新版 → 与缓存内容比对 → 有变化才写缓存并通知页面 */
    var updating = null;
    var now = Date.now();
    if(!cached || now - lastCheck > CHECK_INTERVAL){
      lastCheck = now;
      updating = fetch(req).then(function(res){
        if(!res || res.status !== 200 || res.type === "opaque") return null;
        return res.clone().text().then(function(txt){
          if(!cached) return cache.put(req, res.clone());
          return cached.clone().text().then(function(oldTxt){
            if(oldTxt !== txt){
              return cache.put(req, res.clone()).then(notifyUpdate);
            }
            return null;
          });
        });
      }).catch(function(){ return null; });
    }

    if(cached){                       // 秒开：直接用缓存，不等网络
      if(updating) e.waitUntil(updating);
      return cached;
    }

    /* 无缓存：等网络（首次访问 / 缓存被清） */
    try{
      return await fetch(req);
    }catch(err){
      if(updating) await updating.catch(function(){});
      var fb = await cache.match(req);
      if(fb) return fb;
      return new Response("离线且无缓存", { status:503, headers:{ "Content-Type":"text/plain; charset=utf-8" } });
    }
  })());
});
