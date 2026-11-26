"use strict";
// Guarda la base de alumnos en el teléfono (IndexedDB) o en memoria para las
// pruebas. La revisión funciona igual que en la base SQLite de la PC: evita
// pisar cambios hechos desde otra pestaña.
(function(root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.Almacen = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  let contador = 0;
  function marcaTiempo() {
    const date = new Date(), pad = value => String(value).padStart(2, "0");
    contador = (contador + 1) % 1000;
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + "-" +
      pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds()) + "-" +
      String(date.getMilliseconds()).padStart(3, "0") + "-" + pad(contador);
  }
  const clonar = value => typeof structuredClone === "function"
    ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const CAMBIO_EN_OTRA_PESTANA = "La base cambió en otra pestaña. Recargá antes de guardar.";

  const anioDelDia = () => new Date().getFullYear();
  const memoriaInicial = value => Array.isArray(value) ? clonar(value) : [];

  function normalizarMeta(fuente) {
    const anio = Number(fuente && fuente.anio) || anioDelDia();
    return {
      anio,
      anio_egreso: Number(fuente && fuente.anio_egreso) || anio,
      memoria: memoriaInicial(fuente && fuente.memoria)
    };
  }

  function crearAlmacenMemoria(inicial) {
    let revision = inicial.revision || 1;
    let datos = clonar(inicial.datos);
    let meta = normalizarMeta(inicial);
    const respaldos = [];
    return {
      async cargar() {
        return { revision, datos: clonar(datos), ...clonar(meta) };
      },
      async guardar(revisionEsperada, nuevosDatos, nuevoMeta) {
        if (revisionEsperada !== revision) throw new Error(CAMBIO_EN_OTRA_PESTANA);
        revision += 1;
        datos = clonar(nuevosDatos);
        if (nuevoMeta) meta = { ...meta, ...normalizarMeta({ ...meta, ...nuevoMeta }) };
        return revision;
      },
      async respaldar() {
        const fecha = marcaTiempo();
        respaldos.push({ fecha, revision, datos: clonar(datos), ...clonar(meta) });
        if (respaldos.length > 20) respaldos.shift();
        return fecha;
      },
      async listarRespaldos() {
        return respaldos.map(item => item.fecha);
      }
    };
  }

  function abrirBase(nombre) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(nombre, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("estado")) db.createObjectStore("estado", { keyPath: "id" });
        if (!db.objectStoreNames.contains("respaldos")) db.createObjectStore("respaldos", { keyPath: "fecha" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transaccion(db, almacenes, modo, trabajo) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(almacenes, modo);
      let resultado;
      tx.oncomplete = () => resolve(resultado);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("No se pudo guardar en el teléfono."));
      const terminar = value => { resultado = value; };
      try {
        trabajo(tx, terminar, error => {
          try { tx.abort(); } catch {}
          reject(error);
        });
      } catch (error) {
        try { tx.abort(); } catch {}
        reject(error);
      }
    });
  }

  function crearAlmacenIndexedDB(opciones) {
    const nombre = opciones.nombre || "escuela39";
    let base = null;
    const abrir = () => {
      if (!base) base = abrirBase(nombre);
      return base;
    };
    return {
      async cargar() {
        const db = await abrir();
        return transaccion(db, "estado", "readwrite", (tx, terminar, fallar) => {
          const store = tx.objectStore("estado"), request = store.get(1);
          request.onsuccess = () => {
            let registro = request.result;
            if (!registro) {
              const meta = normalizarMeta(opciones);
              registro = { id: 1, revision: opciones.revision || 1, datos: opciones.datos, ...meta };
              store.put(registro);
            } else {
              const meta = normalizarMeta(registro);
              if (registro.anio !== meta.anio || registro.anio_egreso !== meta.anio_egreso ||
                  !Array.isArray(registro.memoria)) {
                Object.assign(registro, meta);
                store.put(registro);
              }
            }
            terminar({ revision: registro.revision, datos: registro.datos,
              anio: registro.anio, anio_egreso: registro.anio_egreso, memoria: registro.memoria });
          };
          request.onerror = () => fallar(request.error);
        });
      },
      async guardar(revisionEsperada, datos, nuevoMeta) {
        const db = await abrir();
        return transaccion(db, "estado", "readwrite", (tx, terminar, fallar) => {
          const store = tx.objectStore("estado"), request = store.get(1);
          request.onsuccess = () => {
            const registro = request.result;
            if (!registro || registro.revision !== revisionEsperada) {
              fallar(new Error(CAMBIO_EN_OTRA_PESTANA));
              return;
            }
            registro.revision += 1;
            registro.datos = datos;
            if (nuevoMeta) Object.assign(registro, normalizarMeta({ ...registro, ...nuevoMeta }));
            store.put(registro);
            terminar(registro.revision);
          };
          request.onerror = () => fallar(request.error);
        });
      },
      async respaldar() {
        const db = await abrir();
        return transaccion(db, ["estado", "respaldos"], "readwrite", (tx, terminar, fallar) => {
          const estado = tx.objectStore("estado"), respaldos = tx.objectStore("respaldos");
          const request = estado.get(1);
          request.onsuccess = () => {
            const registro = request.result;
            if (!registro) { fallar(new Error("No hay datos para respaldar.")); return; }
            const fecha = marcaTiempo();
            respaldos.put({ fecha, revision: registro.revision, datos: registro.datos,
              anio: registro.anio, anio_egreso: registro.anio_egreso, memoria: registro.memoria });
            const claves = respaldos.getAllKeys();
            claves.onsuccess = () => {
              const lista = claves.result.slice().sort();
              for (const clave of lista.slice(0, Math.max(0, lista.length - 20))) respaldos.delete(clave);
            };
            claves.onerror = () => fallar(claves.error);
            terminar(fecha);
          };
          request.onerror = () => fallar(request.error);
        });
      },
      async listarRespaldos() {
        const db = await abrir();
        return transaccion(db, "respaldos", "readonly", (tx, terminar, fallar) => {
          const request = tx.objectStore("respaldos").getAllKeys();
          request.onsuccess = () => terminar(request.result.slice().sort());
          request.onerror = () => fallar(request.error);
        });
      },
      async reiniciar(datos, revisionInicial, meta) {
        const db = await abrir();
        return transaccion(db, "estado", "readwrite", (tx, terminar, fallar) => {
          const store = tx.objectStore("estado"), request = store.get(1);
          request.onsuccess = () => {
            const registro = request.result;
            const revision = registro ? registro.revision + 1 : Math.max(1, Number(revisionInicial) || 1);
            const actual = normalizarMeta(registro || meta);
            const nuevo = meta ? normalizarMeta({ ...actual, ...meta }) : actual;
            store.put({ id: 1, revision, datos, ...nuevo });
            terminar(revision);
          };
          request.onerror = () => fallar(request.error);
        });
      }
    };
  }

  return { crearAlmacenMemoria, crearAlmacenIndexedDB, marcaTiempo };
});
