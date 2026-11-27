"use strict";
// Versión de la app: se muestra en la cabecera, el service worker la usa para la caché
// y el build del APK la usa como versionName.
var VERSION_APP = "2.7.3";
if (typeof window !== "undefined") window.VERSION_APP = VERSION_APP;
if (typeof self !== "undefined") self.VERSION_APP = VERSION_APP;
