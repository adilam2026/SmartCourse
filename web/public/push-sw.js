/* Notifications téléphone (Web Push) : chargé par le service worker de l'application (workbox importScripts).
 * Le serveur n'envoie qu'un récapitulatif par validation ; ce script l'affiche, puis ouvre la liste concernée au toucher. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Courses", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Courses";
  const options = {
    body: data.body || "",
    // Même identifiant pour une même validation : une livraison en double remplace la notification, elle ne s'empile pas.
    tag: data.tag || "smartcourse",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png", // silhouette blanche (barre d'état)
    lang: "fr",
    timestamp: Date.now(),
    data: { url: typeof data.url === "string" && data.url.charAt(0) === "/" ? data.url : "/", listId: data.listId || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = d.url || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        // Application déjà ouverte : on la ramène devant et on lui dit quelle liste ouvrir (elle sait si la session est valide).
        try {
          await w.focus();
        } catch (e) {
          /* ignoré */
        }
        w.postMessage({ type: "open-list", listId: d.listId, url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
