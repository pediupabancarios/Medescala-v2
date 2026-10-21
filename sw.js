/* MedEscala — service worker.
   1) Offline: tenta a rede primeiro (deploys novos aparecem na hora) e cai no cache se estiver sem internet.
   2) Notificações: recebe os lembretes de plantão enviados pelo servidor (Web Push), mesmo com o app fechado.
   Subir a versão C força limpar o cache antigo. Só intercepta arquivos do próprio site — o Supabase não passa por aqui. */
const C = 'mes-sw-v1';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(C).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(
    fetch(r)
      .then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(C).then((c) => c.put(r, copia)); }
        return res;
      })
      .catch(() => caches.match(r).then((m) => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'MedEscala', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(
    self.registration.showNotification(d.title || 'MedEscala', {
      body: d.body || '',
      tag: d.tag || 'medescala',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || './#/myshifts' },
      requireInteraction: !!d.urgent,
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) { if (c.navigate) c.navigate(alvo).catch(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(alvo);
    })
  );
});
