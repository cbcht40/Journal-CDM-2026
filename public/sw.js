// Service worker : réception des rappels push + ouverture de l'app au clic
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(
    self.registration.showNotification(data.title || "Journal CDM 2026", {
      body: data.body || "Pense à remplir ton carnet ⚽",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      for (const f of fenetres) if ("focus" in f) return f.focus();
      return clients.openWindow("/");
    })
  );
});
