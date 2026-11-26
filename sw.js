"use strict";
// Service worker de la app EP 39 (PWA): guarda toda la aplicación para que abra
// sin internet. Al cambiar la versión en version.js se descarta la caché vieja.
// Actualización 2.7.1: base con los 784 alumnos de la app del teléfono.
importScripts("./version.js?v=2");

const CACHE = "ep39-" + self.VERSION_APP;
const ARCHIVOS = [
  "./index.html",
  "./estilos.css",
  "./estilos-ios.css",
  "./estilos-acceso.css",
  "./acceso.js",
  "./llaves.js",
  "./app.js",
  "./salidas.js",
  "./version.js",
  "./datos-calles.js",
  "./datos-cifrados/datos-iniciales.bin",
  "./datos-cifrados/padron-inicial.bin",
  "./manifest.webmanifest",
  "./iconos/icon-192.png",
  "./iconos/icon-512.png",
  "./iconos/icon-1024.png",
  "./iconos/apple-touch-icon.png",
  "./leaflet/leaflet.css",
  "./leaflet/leaflet.js",
  "./leaflet/images/layers.png",
  "./leaflet/images/layers-2x.png",
  "./leaflet/images/marker-icon.png",
  "./leaflet/images/marker-icon-2x.png",
  "./leaflet/images/marker-shadow.png",
  "./nucleo/logica.js",
  "./nucleo/tramos.js",
  "./nucleo/calles.js",
  "./nucleo/geocodificador.js",
  "./nucleo/alumnos.js",
  "./nucleo/almacen.js",
  "./nucleo/excel.js",
  "./nucleo/backend.js",
  "./nucleo/arranque.js",
  "./vendor/xlsx.full.min.js",
  "./padron/index.html",
  "./padron/estilos.css",
  "./padron/app.js",
  "./padron/nucleo/actualizacion.js",
  "./padron/nucleo/almacen.js",
  "./padron/nucleo/excel.js",
  "./padron/nucleo/integracion.js",
  "./padron/nucleo/texto.js",
  "./padron/vendor/xlsx.full.min.js"
];

self.addEventListener("install", evento => {
  evento.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(ARCHIVOS.map(async ruta => {
        const respuesta = await fetch(ruta, { cache: "reload" });
        if (!respuesta.ok) throw new Error("No se pudo guardar " + ruta);
        await cache.put(ruta, respuesta);
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", evento => {
  evento.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(clave => clave !== CACHE)
        .map(clave => caches.delete(clave))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", evento => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  if (pedido.mode === "navigate") {
    evento.respondWith(
      caches.match(pedido, { ignoreSearch: true })
        .then(hit => hit || fetch(pedido))
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  evento.respondWith(
    caches.match(pedido, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(pedido).then(respuesta => {
        if (respuesta && respuesta.ok && respuesta.type === "basic") {
          const copia = respuesta.clone();
          caches.open(CACHE).then(cache => cache.put(pedido, copia));
        }
        return respuesta;
      });
    })
  );
});
