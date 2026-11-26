"use strict";
// Candado de la app EP 39 para iPhone. Los datos de alumnos viajan cifrados:
// el código de invitación es la llave que los descifra. Se pide una sola vez
// por teléfono y queda guardado en el navegador para abrir sin internet.
(function() {
  const BASE = (function() {
    const actual = document.currentScript;
    return actual ? new URL("./", actual.src) : new URL("./", location.href);
  })();
  const DB_NOMBRE = "ep39-acceso";
  const DB_ALMACEN = "estado";
  const DB_CLAVE = "actual";

  function bytesDesdeBase64(texto) {
    const binario = atob(String(texto || ""));
    const salida = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
    return salida;
  }

  function base64DesdeBytes(bytes) {
    const datos = new Uint8Array(bytes);
    let binario = "";
    for (let i = 0; i < datos.length; i++) binario += String.fromCharCode(datos[i]);
    return btoa(binario);
  }

  function normalizarCodigo(texto) {
    return String(texto || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  async function derivar(codigo, salBase64, iteraciones) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(codigo),
      "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2", salt: bytesDesdeBase64(salBase64),
      iterations: iteraciones, hash: "SHA-256"
    }, material, 256);
    return new Uint8Array(bits);
  }

  async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  }

  const texto = valor => new TextEncoder().encode(valor);

  async function abrirBase() {
    return new Promise((resolver, rechazar) => {
      const pedido = indexedDB.open(DB_NOMBRE, 1);
      pedido.onupgradeneeded = () => {
        if (!pedido.result.objectStoreNames.contains(DB_ALMACEN))
          pedido.result.createObjectStore(DB_ALMACEN);
      };
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rechazar(pedido.error || new Error("No se pudo abrir el guardado."));
    });
  }

  async function leerEstado() {
    try {
      const base = await abrirBase();
      return await new Promise((resolver, rechazar) => {
        const pedido = base.transaction(DB_ALMACEN, "readonly").objectStore(DB_ALMACEN).get(DB_CLAVE);
        pedido.onsuccess = () => resolver(pedido.result || null);
        pedido.onerror = () => rechazar(pedido.error);
      });
    } catch (error) {
      return null;
    }
  }

  async function guardarEstado(estado) {
    try {
      const base = await abrirBase();
      await new Promise((resolver, rechazar) => {
        const tx = base.transaction(DB_ALMACEN, "readwrite");
        tx.objectStore(DB_ALMACEN).put(estado, DB_CLAVE);
        tx.oncomplete = () => resolver();
        tx.onerror = () => rechazar(tx.error);
      });
    } catch (error) {
      console.warn("No se pudo guardar el acceso:", error);
    }
  }

  async function borrarEstado() {
    try {
      const base = await abrirBase();
      await new Promise(resolver => {
        const tx = base.transaction(DB_ALMACEN, "readwrite");
        tx.objectStore(DB_ALMACEN).delete(DB_CLAVE);
        tx.oncomplete = () => resolver();
        tx.onerror = () => resolver();
      });
    } catch (error) {}
  }

  async function descifrarArchivo(nombre, clave, llaves) {
    const meta = llaves.archivos[nombre];
    const respuesta = await fetch(new URL(meta.ruta, BASE), { cache: "no-store" });
    if (!respuesta.ok) throw new Error("No se pudo descargar la base cifrada.");
    const contenido = await respuesta.arrayBuffer();
    const llave = await crypto.subtle.importKey("raw", clave, "AES-GCM", false, ["decrypt"]);
    const plano = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: bytesDesdeBase64(meta.iv),
      additionalData: texto("EP39|archivo|" + nombre + "|" + llaves.generacion)
    }, llave, contenido);
    const datos = JSON.parse(new TextDecoder().decode(plano));
    return { global: datos.global, datos: datos.datos };
  }

  async function descifrarTodo(clave, llaves) {
    const archivos = {};
    for (const nombre of Object.keys(llaves.archivos)) {
      archivos[nombre] = await descifrarArchivo(nombre, clave, llaves);
    }
    return archivos;
  }

  function aplicar(archivos) {
    Object.keys(archivos || {}).forEach(nombre => {
      const archivo = archivos[nombre];
      if (archivo && archivo.global) window[archivo.global] = archivo.datos;
    });
  }

  function cargarMarcos() {
    document.querySelectorAll("iframe[data-src]").forEach(marco => {
      if (!marco.getAttribute("src")) marco.setAttribute("src", marco.getAttribute("data-src"));
    });
  }

  async function probarCodigo(codigo, llaves) {
    const limpio = normalizarCodigo(codigo);
    if (limpio.split("-").length < 5) {
      throw new Error("El código tiene 6 palabras y 2 números, separados por espacios.");
    }
    const token = await derivar(limpio, llaves.kdf.token.sal, llaves.kdf.token.iteraciones);
    const etiqueta = base64DesdeBytes((await sha256(token)).slice(0, 16));
    const invitacion = (llaves.invitaciones || []).find(item => item.etiqueta === etiqueta);
    if (!invitacion) throw new Error("Ese código no es válido. Revisá las 6 palabras y los 2 números.");
    const llaveEnvoltura = await derivar(limpio, invitacion.sal, llaves.kdf.invitacion.iteraciones);
    let clave;
    try {
      clave = await crypto.subtle.decrypt({
        name: "AES-GCM", iv: bytesDesdeBase64(invitacion.iv),
        additionalData: texto("EP39|invitacion|" + llaves.generacion + "|" + etiqueta)
      }, await crypto.subtle.importKey("raw", llaveEnvoltura, "AES-GCM", false, ["decrypt"]),
        bytesDesdeBase64(invitacion.clave));
    } catch (error) {
      throw new Error("Ese código no es válido. Revisá las 6 palabras y los 2 números.");
    }
    return { clave: new Uint8Array(clave), etiqueta };
  }

  function pedirCodigo(llaves, mensajeInicial) {
    return new Promise(resolver => {
      const capa = document.createElement("div");
      capa.className = "acceso-capa";
      capa.innerHTML =
        '<form class="acceso-tarjeta" autocomplete="off">' +
          '<div class="acceso-escudo" aria-hidden="true">39</div>' +
          '<h1 class="acceso-titulo">EP 39</h1>' +
          '<p class="acceso-subtitulo">Código de invitación</p>' +
          '<p class="acceso-ayuda">Ingresá las 6 palabras y los 2 números que te dio la escuela.</p>' +
          '<input class="acceso-codigo" type="text" inputmode="text" enterkeyhint="go" ' +
            'autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false" ' +
            'placeholder="monte pera tren luna rio cobre 47" aria-label="Código de invitación">' +
          '<p class="acceso-error" role="alert"></p>' +
          '<button class="acceso-entrar" type="submit">Entrar</button>' +
          '<p class="acceso-nota">Se pide una sola vez en este teléfono. Después abre sin internet.</p>' +
        '</form>';
      document.body.appendChild(capa);
      document.documentElement.classList.add("acceso-bloqueado");
      const formulario = capa.querySelector("form");
      const campo = capa.querySelector(".acceso-codigo");
      const error = capa.querySelector(".acceso-error");
      const boton = capa.querySelector(".acceso-entrar");
      let ocupado = false;
      if (mensajeInicial) error.textContent = mensajeInicial;
      setTimeout(() => { try { campo.focus({ preventScroll: true }); } catch (e) {} }, 120);

      formulario.addEventListener("submit", async evento => {
        evento.preventDefault();
        if (ocupado) return;
        error.textContent = "";
        if (!campo.value.trim()) { error.textContent = "Escribí el código de invitación."; return; }
        ocupado = true;
        boton.disabled = true;
        campo.disabled = true;
        boton.textContent = "Verificando…";
        try {
          const abierto = await probarCodigo(campo.value, llaves);
          const archivos = await descifrarTodo(abierto.clave, llaves);
          await guardarEstado({ generacion: llaves.generacion, datosId: llaves.datosId,
            clave: abierto.clave.buffer.slice(0), archivos: archivos });
          aplicar(archivos);
          cargarMarcos();
          capa.classList.add("acceso-saliendo");
          setTimeout(() => {
            capa.remove();
            document.documentElement.classList.remove("acceso-bloqueado");
          }, 260);
          resolver(archivos);
        } catch (falla) {
          error.textContent = falla && falla.message
            ? falla.message
            : "No se pudo abrir. Revisá el código e intentá de nuevo.";
          ocupado = false;
          boton.disabled = false;
          campo.disabled = false;
          boton.textContent = "Entrar";
          campo.focus({ preventScroll: true });
          campo.select();
        }
      });
    });
  }

  let preparando = null;

  function preparar() {
    if (preparando) return preparando;
    preparando = (async () => {
      const llaves = window.LLAVES_EP39;
      if (!llaves || !llaves.archivos || !llaves.invitaciones) {
        throw new Error("Falta la configuración de acceso de la app.");
      }
      if (!window.crypto || !crypto.subtle || !window.indexedDB) {
        throw new Error("Este navegador no permite abrir la app cifrada. Probá con Safari actualizado.");
      }
      const guardado = await leerEstado();
      let archivos = null;
      if (guardado && guardado.generacion === llaves.generacion && guardado.clave) {
        if (guardado.datosId === llaves.datosId && guardado.archivos) {
          archivos = guardado.archivos;
        } else {
          try {
            archivos = await descifrarTodo(new Uint8Array(guardado.clave), llaves);
            await guardarEstado({ generacion: llaves.generacion, datosId: llaves.datosId,
              clave: guardado.clave, archivos: archivos });
          } catch (error) {
            archivos = null;
            await borrarEstado();
          }
        }
      } else if (guardado) {
        await borrarEstado();
      }
      if (!archivos) {
        const inicial = guardado && guardado.generacion !== llaves.generacion
          ? "La escuela renovó los códigos. Ingresá el código nuevo." : "";
        archivos = await pedirCodigo(llaves, inicial);
      } else {
        aplicar(archivos);
        cargarMarcos();
      }
      return true;
    })();
    preparando.catch(() => { preparando = null; });
    return preparando;
  }

  window.AccesoApp = { preparar, probarCodigo, normalizarCodigo };
})();
