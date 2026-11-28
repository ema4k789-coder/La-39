"use strict";
// Decide cómo arranca la app: con el servidor de la PC (HTTP) o standalone,
// con todos los datos y el backend dentro del navegador/telefono.
(function() {
  const params = new URLSearchParams(location.search);
  const local = window.MODO_LOCAL === true || params.has("local") || location.protocol === "file:";
  const aviso = text => { const status = document.getElementById("status"); if (status) status.textContent = text; };

  function cargar(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar " + src));
      document.head.appendChild(script);
    });
  }

  async function arrancarServidor() {
    window.ApiApp = {
      local: false,
      async get(ruta) {
        const response = await fetch(ruta, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
        return data;
      },
      async post(ruta, body) {
        const response = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
        return data;
      },
      async descargar(ruta) {
        location.href = ruta;
      }
    };
    await cargar("app.js?v=19");
  }

  function leerBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  // En iPhone el archivo se entrega con el menú de compartir: Archivos, WhatsApp, mail…
  async function compartirArchivo(blob, nombre) {
    if (!esIOS() || !navigator.share || !navigator.canShare) return false;
    try {
      const archivo = new File([blob], nombre, { type: blob.type || "application/octet-stream" });
      if (!navigator.canShare({ files: [archivo] })) return false;
      await navigator.share({ files: [archivo], title: nombre });
      return true;
    } catch (error) {
      return !!(error && error.name === "AbortError");
    }
  }

  async function descargarArchivo(blob, nombre) {
    if (window.AndroidApp && typeof window.AndroidApp.guardarArchivo === "function") {
      window.AndroidApp.guardarArchivo(nombre, blob.type || "application/octet-stream",
        await leerBase64(blob));
      return;
    }
    if (await compartirArchivo(blob, nombre)) return;
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url;
    link.download = nombre;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function arrancarLocal() {
    aviso("Abriendo la app offline...");
    await cargar("llaves.js?v=2");
    await cargar("acceso.js?v=2");
    await window.AccesoApp.preparar();
    await cargar("datos-calles.js");
    await cargar("vendor/xlsx.full.min.js");
    for (const src of ["nucleo/logica.js", "nucleo/tramos.js", "nucleo/calles.js",
      "nucleo/geocodificador.js", "nucleo/alumnos.js", "nucleo/almacen.js",
      "nucleo/excel.js?v=2", "nucleo/backend.js?v=5"]) {
      await cargar(src);
    }
    if (!window.DATOS_CALLES || !window.DATOS_CALLES.datos) {
      throw new Error("Faltan los datos de calles para la app offline.");
    }
    const datosCalles = window.DATOS_CALLES.datos;
    const api = window.NucleoCalles.crearAPI(datosCalles);
    let inicial = window.DATOS_INICIALES;
    if (!inicial) {
      aviso("Cargando la base inicial desde la PC...");
      const response = await fetch("/api/datos", { cache: "no-store" });
      if (!response.ok) throw new Error("Falta la base inicial de alumnos.");
      const payload = await response.json();
      inicial = { revision: payload.revision, datos: payload.datos, anio: payload.anio,
        anio_egreso: payload.anio_egreso };
    }
    const almacen = window.Almacen.crearAlmacenIndexedDB({
      nombre: params.get("db") || "escuela39", revision: inicial.revision, datos: inicial.datos,
      anio: inicial.anio, anio_egreso: inicial.anio_egreso, memoria: inicial.memoria,
      semillaAnterior: [151, 171]
    });
    if (params.has("reiniciar")) await almacen.reiniciar(inicial.datos, inicial.revision,
      { anio: inicial.anio, anio_egreso: inicial.anio_egreso, memoria: inicial.memoria });
    const backend = window.BackendApp.crearBackend({ almacen, datosCalles,
      buscarCalles: consulta => window.Geocodificador.buscar(api, consulta), excel: window.ExcelApp });
    try { await backend.normalizarNombres(); } catch (error) { console.warn("Nombres:", error); }
    const consultas = {
      "/api/estado": () => backend.estado(),
      "/api/datos": () => backend.datos(),
      "/api/mapa-base": () => backend.mapaBase(),
      "/api/salidas": () => backend.salidas()
    };
    const acciones = {
      "/api/columnas": body => backend.columnas(body),
      "/api/contar-alumnos": body => backend.contarAlumnos(body),
      "/api/calles": body => backend.calles(body),
      "/api/buscar": body => backend.buscar(body),
      "/api/guardar": body => backend.guardar(body),
      "/api/ubicacion": body => backend.ubicacion(body),
      "/api/importar": body => backend.importar(body),
      "/api/ubicar": body => backend.ubicar(body),
      "/api/anio": body => backend.anioLectivo(body),
      "/api/promocion": body => backend.promocion(body),
      "/api/trasladar": body => backend.trasladar(body),
      "/api/eliminar": body => backend.eliminar(body),
      "/api/datos-actualizacion": body => backend.importarActualizacion(body),
      "/api/salidas": body => body && body.accion === "eliminar"
        ? backend.eliminarSalida(body) : backend.guardarSalida(body)
    };
    window.ApiApp = {
      local: true,
      async get(ruta) {
        if (ruta.startsWith("/api/memoria")) {
          const anio = new URLSearchParams(ruta.split("?")[1] || "").get("anio");
          return backend.memoria(anio);
        }
        if (!consultas[ruta]) throw new Error("Ruta no encontrada: " + ruta);
        return consultas[ruta]();
      },
      async post(ruta, body) {
        if (!acciones[ruta]) throw new Error("Ruta no encontrada: " + ruta);
        return acciones[ruta](body);
      },
      async descargar(ruta) {
        if (ruta.startsWith("/api/salida.xlsx")) {
          const consulta = new URLSearchParams(ruta.split("?")[1] || "");
          const { nombre, tipo, contenido } = await backend.exportarSalida({
            id: consulta.get("id") || "", tipo: consulta.get("tipo") || "datos" });
          await descargarArchivo(new Blob([contenido], { type: tipo }), nombre);
        } else if (ruta === "/api/exportar.geojson") {
          const { nombre, contenido } = await backend.exportarGeoJSON();
          await descargarArchivo(new Blob([contenido], { type: "application/geo+json" }), nombre);
        } else if (ruta.startsWith("/api/exportar.xlsx")) {
          const grado = new URLSearchParams(ruta.split("?")[1] || "").get("grado") || "";
          const { nombre, tipo, contenido } = await backend.exportarXLSX(grado);
          await descargarArchivo(new Blob([contenido], { type: tipo }), nombre);
        } else if (ruta === "/api/actualizacion.json") {
          const { nombre, tipo, contenido } = await backend.exportarActualizacion();
          await descargarArchivo(new Blob([contenido], { type: tipo }), nombre);
        } else {
          throw new Error("Descarga no disponible.");
        }
      }
    };
    await cargar("app.js?v=19");
    await cargar("salidas.js?v=1");
    await cargar("revision.js?v=3");
  }

  (local ? arrancarLocal() : arrancarServidor()).catch(error =>
    aviso("Error al abrir la app: " + error.message));
})();
