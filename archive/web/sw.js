// The PREVIOUS app on this origin (the old worker board) registered a
// service worker with app-shell caching; it outlives its app and hijacks
// every soft load with the dead shell (hard refresh bypasses a SW for one
// load — it never unregisters it). This replacement installs over it,
// unregisters the origin, and reloads every tab it controlled. Keep the
// file for as long as any browser might still carry the old registration.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(
    self.registration.unregister()
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) =>
        clients.forEach((client) => client.navigate(client.url))
      ),
  ))
