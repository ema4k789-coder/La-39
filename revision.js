"use strict";
// Sección Revisión: lista los alumnos agregados, editados y faltantes de la
// actualización, aparte del mapa y del padrón, para que los nombres o DNI
// repetidos no se mezclen con la base. Permite agregar, mover de grado y eliminar.
(function() {
  const CLAVE = "escuela39.revision.v1";
  const TIPOS = { agregado: "Agregado", editado: "Editado", faltante: "Falta en la base" };
  const FILTROS = [
    { id: "todos", texto: "Todos" },
    { id: "agregado", texto: "Agregados" },
    { id: "editado", texto: "Editados" },
    { id: "faltante", texto: "Faltantes" }
  ];
  let filtro = "todos";
  let mostrarHechos = false;
  let hechos = {};
  let ultimoMensaje = null;
  let ocupado = false;

  function esc(texto) {
    return String(texto == null ? "" : texto)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function valor(texto) {
    if (texto === true) return "Sí";
    if (texto === false) return "No";
    const limpio = String(texto == null ? "" : texto).trim();
    return limpio || "(vacío)";
  }

  function gradoTexto(item) {
    const curso = String((item && item.curso) || "").trim();
    const division = String((item && item.division) || "").trim().toUpperCase();
    return curso ? curso + "° " + division : "sin grado";
  }

  function gradoValor(grado) {
    const [curso, division] = String(grado || "").split("-");
    return curso ? curso + "° " + division : "sin grado";
  }

  function clave(entry) {
    return entry.tipo + ":" + entry.item.persona_id;
  }

  function items() {
    const datos = window.REVISION_EP39 || {};
    const salida = [];
    for (const tipo of ["agregado", "editado", "faltante"]) {
      const lista = Array.isArray(datos[tipo + "s"]) ? datos[tipo + "s"] : [];
      for (const item of lista) {
        if (item && item.persona_id) salida.push({ tipo, item });
      }
    }
    return salida;
  }

  function cargarHechos() {
    hechos = {};
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE) || "{}");
      if (guardado && guardado.id === (window.REVISION_EP39 || {}).id && guardado.hechos) {
        hechos = guardado.hechos;
      } else {
        localStorage.removeItem(CLAVE);
      }
    } catch (error) {
      hechos = {};
    }
  }

  function guardarHechos() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({
        id: (window.REVISION_EP39 || {}).id, hechos
      }));
    } catch (error) {}
  }

  function marcarHecho(entry, hecho) {
    if (hecho) hechos[clave(entry)] = true;
    else delete hechos[clave(entry)];
    guardarHechos();
  }

  function marcar(lista, tipo) {
    const restantes = lista.filter(entry => !hechos[clave(entry)]);
    return tipo ? restantes.filter(entry => entry.tipo === tipo).length : restantes.length;
  }

  function opcionesGrado(item) {
    const actual = String((item && item.curso) || "").trim() + "-" +
      String((item && item.division) || "").trim().toUpperCase();
    let html = "";
    for (let curso = 1; curso <= 6; curso++) {
      for (const division of ["A", "B", "C", "D"]) {
        const valorGrado = curso + "-" + division;
        html += '<option value="' + valorGrado + '"' + (valorGrado === actual ? " selected" : "") +
          ">" + curso + "° " + division + "</option>";
      }
    }
    return html;
  }

  function detalleHtml(item) {
    const filas = [];
    if (String(item.dni || "").trim()) filas.push(["DNI", item.dni]);
    if (String(item.direccion || "").trim()) filas.push(["Domicilio", item.direccion]);
    if (String(item.telefono || "").trim()) filas.push(["Teléfono", item.telefono]);
    if (!filas.length) return "";
    return '<dl class="revision-detalle">' + filas.map(fila =>
      "<div><dt>" + esc(fila[0]) + "</dt><dd>" + esc(fila[1]) + "</dd></div>").join("") + "</dl>";
  }

  function cambiosHtml(item) {
    if (!Array.isArray(item.cambios) || !item.cambios.length) return "";
    return '<ul class="revision-cambios">' + item.cambios.map(cambio =>
      '<li><span class="revision-campo">' + esc(cambio.etiqueta || cambio.campo) + "</span>" +
      '<span class="revision-antes">' + esc(valor(cambio.antes)) + "</span>" +
      '<span class="revision-flecha">→</span>' +
      '<span class="revision-despues">' + esc(valor(cambio.despues)) + "</span></li>").join("") + "</ul>";
  }

  function estadoHtml() {
    if (!ultimoMensaje) return "";
    return '<p class="revision-estado ' + esc(ultimoMensaje.tipo || "") + '" role="status">' +
      esc(ultimoMensaje.texto) + "</p>";
  }

  function tarjeta(entry) {
    const tipo = entry.tipo, item = entry.item;
    const hecho = !!hechos[clave(entry)];
    const principal = tipo === "faltante" ? "Agregar a este grado" : "Mover al grado";
    const eliminar = tipo === "faltante" ? "Quitar de la lista" : "Eliminar";
    const deshabilitado = hecho || ocupado ? " disabled" : "";
    return '<article class="revision-item' + (hecho ? " revision-hecho" : "") +
      '" data-tipo="' + tipo + '" data-id="' + esc(item.persona_id) + '">' +
      '<div class="revision-item-cabecera">' +
        '<span class="revision-tipo revision-tipo-' + tipo + '">' + esc(TIPOS[tipo]) + "</span>" +
        '<strong class="revision-nombre">' + esc(item.nombre || "Sin nombre") + "</strong>" +
        '<span class="revision-grado">' + esc(gradoTexto(item)) + "</span>" +
      "</div>" +
      detalleHtml(item) + cambiosHtml(item) +
      '<div class="revision-acciones">' +
        "<label>Grado<select class=\"revision-grado-select\"" + deshabilitado + ">" +
          opcionesGrado(item) + "</select></label>" +
        '<button type="button" class="revision-boton primary" data-accion="principal"' + deshabilitado + ">" +
          (hecho ? "Hecho" : principal) + "</button>" +
        '<button type="button" class="revision-boton danger" data-accion="eliminar"' + deshabilitado + ">" +
          eliminar + "</button>" +
        (hecho ? '<button type="button" class="revision-boton" data-accion="deshacer">Volver a la lista</button>' : "") +
      "</div>" +
      '<p class="revision-estado" role="status"></p>' +
      "</article>";
  }

  function render() {
    const datos = window.REVISION_EP39;
    const resumen = document.getElementById("revisionResumen");
    const lista = document.getElementById("revisionLista");
    if (!resumen || !lista) return;
    if (!datos) {
      resumen.innerHTML = "";
      lista.innerHTML = '<p class="revision-vacio">La lista de revisión no está disponible en esta versión.</p>';
      return;
    }
    const todos = items();
    const hechosTotal = todos.filter(entry => hechos[clave(entry)]).length;
    resumen.innerHTML =
      '<p class="revision-resumen-fuente">' + esc(datos.fuente || "Actualización de la base") +
        ". Antes: " + esc((datos.anterior || {}).total) + " alumnos · ahora: " +
        esc((datos.actual || {}).total) + " alumnos.</p>" +
      '<div class="revision-filtros" role="group" aria-label="Filtrar la revisión">' +
        FILTROS.map(opcion => {
          const cuenta = marcar(todos, opcion.id === "todos" ? "" : opcion.id);
          return '<button type="button" class="revision-filtro" data-filtro="' + opcion.id +
            '" aria-pressed="' + (filtro === opcion.id) + '">' + opcion.texto +
            " (" + cuenta + ")</button>";
        }).join("") +
        '<button type="button" class="revision-filtro" data-hechos="1" aria-pressed="' +
          mostrarHechos + '">' + (mostrarHechos ? "Ocultar hechos" : "Mostrar hechos") +
          (hechosTotal ? " (" + hechosTotal + ")" : "") + "</button>" +
        (hechosTotal ? '<button type="button" class="revision-filtro" data-reiniciar="1">' +
          "Volver a mostrar todo</button>" : "") +
      "</div>" +
      "<p>" + marcar(todos) + " sin revisar de " + todos.length + " cambios.</p>" +
      estadoHtml();
    const visibles = todos.filter(entry =>
      (filtro === "todos" || entry.tipo === filtro) && (mostrarHechos || !hechos[clave(entry)]));
    lista.innerHTML = visibles.length
      ? visibles.map(tarjeta).join("")
      : '<p class="revision-vacio">No hay cambios para mostrar con este filtro.</p>';
    actualizarBadge();
  }

  function actualizarBadge() {
    const badge = document.getElementById("revisionBadge");
    if (!badge) return;
    const pendientes = items().filter(entry => !hechos[clave(entry)]).length;
    badge.textContent = String(pendientes);
    badge.hidden = pendientes === 0;
  }

  function mensaje(texto, tipo) {
    ultimoMensaje = { texto, tipo: tipo || "" };
  }

  async function revisionActual() {
    const payload = await window.ApiApp.get("/api/datos");
    return payload.revision;
  }

  async function refrescarMapa() {
    try {
      if (window.MapaApp && typeof window.MapaApp.refrescar === "function") {
        await window.MapaApp.refrescar();
      }
    } catch (error) {}
  }

  function mensajeDeError(error) {
    const texto = (error && error.message) || "No se pudo completar la operación.";
    return /DNI/i.test(texto)
      ? texto + " Revisá la ficha en el mapa y corregí el DNI antes de agregarlo."
      : texto;
  }

  function nombreDe(entry) {
    return entry.item.nombre || "el alumno";
  }

  async function alPrincipal(entry, tarjeta, estado) {
    const item = entry.item;
    const selector = tarjeta.querySelector(".revision-grado-select");
    const grado = selector ? selector.value : "";
    const [curso, division] = String(grado).split("-");
    if (entry.tipo !== "faltante" && String(item.curso) === curso &&
        String(item.division || "").toUpperCase() === division) {
      const texto = "Elegí un grado distinto al actual para mover al alumno.";
      estado.className = "revision-estado error";
      estado.textContent = texto;
      mensaje(texto, "error");
      return;
    }
    if (entry.tipo === "faltante" && !String((item.campos || {}).nombre_persona || "").trim()) {
      const texto = "Falta el nombre del alumno: no se puede agregar desde acá.";
      estado.className = "revision-estado error";
      estado.textContent = texto;
      mensaje(texto, "error");
      return;
    }
    const revision = await revisionActual();
    if (entry.tipo === "faltante") {
      const payload = { revision, grado, campos: item.campos };
      if (Array.isArray(item.coordenadas) && item.coordenadas.length === 2) {
        payload.coordenadas = item.coordenadas;
        payload.referencia = item.referencia || "";
      }
      await window.ApiApp.post("/api/guardar", payload);
      mensaje("Agregado a " + gradoValor(grado) + ": " + nombreDe(entry) + ".", "ok");
    } else {
      await window.ApiApp.post("/api/trasladar", { revision, id: item.persona_id, grado });
      mensaje("Movido a " + gradoValor(grado) + ": " + nombreDe(entry) + ".", "ok");
    }
    marcarHecho(entry, true);
    await refrescarMapa();
  }

  async function alEliminar(entry) {
    if (entry.tipo === "faltante") {
      marcarHecho(entry, true);
      mensaje("Se quitó de la lista de faltantes: " + nombreDe(entry) + ".", "ok");
      return;
    }
    if (!confirm("¿Eliminar a " + nombreDe(entry) +
        " de la base? Se borran su ficha y su ubicación; antes se guarda un respaldo.")) return false;
    const revision = await revisionActual();
    await window.ApiApp.post("/api/eliminar", { revision, id: entry.item.persona_id });
    marcarHecho(entry, true);
    mensaje("Eliminado de la base: " + nombreDe(entry) + ".", "ok");
    await refrescarMapa();
    return true;
  }

  async function accion(boton) {
    if (ocupado) return;
    const tarjeta = boton.closest(".revision-item");
    if (!tarjeta) return;
    const tipo = tarjeta.getAttribute("data-tipo"), id = tarjeta.getAttribute("data-id");
    const entry = items().find(candidato => candidato.tipo === tipo &&
      candidato.item.persona_id === id);
    if (!entry) return;
    const nombreAccion = boton.getAttribute("data-accion");
    if (nombreAccion === "deshacer") {
      marcarHecho(entry, false);
      ultimoMensaje = null;
      render();
      return;
    }
    const estado = tarjeta.querySelector(".revision-estado");
    const textoBoton = boton.textContent;
    ocupado = true;
    boton.disabled = true;
    boton.textContent = "Guardando…";
    if (estado) {
      estado.className = "revision-estado";
      estado.textContent = "Guardando el cambio…";
    }
    try {
      if (nombreAccion === "eliminar") {
        const hecho = await alEliminar(entry);
        if (hecho === false) {
          boton.disabled = false;
          boton.textContent = textoBoton;
          if (estado) {
            estado.className = "revision-estado";
            estado.textContent = "";
          }
          return;
        }
      } else {
        await alPrincipal(entry, tarjeta, estado || { className: "", textContent: "" });
      }
    } catch (error) {
      if (estado) {
        estado.className = "revision-estado error";
        estado.textContent = mensajeDeError(error);
      }
      ultimoMensaje = { texto: mensajeDeError(error), tipo: "error" };
      boton.disabled = false;
      boton.textContent = textoBoton;
      ocupado = false;
      return;
    } finally {
      ocupado = false;
    }
    render();
  }

  function iniciar() {
    const boton = document.querySelector('.panel-tab[data-panel="revision"]');
    if (!window.REVISION_EP39) {
      if (boton) boton.hidden = true;
      return;
    }
    cargarHechos();
    const resumen = document.getElementById("revisionResumen");
    const lista = document.getElementById("revisionLista");
    if (resumen) {
      resumen.addEventListener("click", evento => {
        const control = evento.target.closest("button");
        if (!control) return;
        if (control.hasAttribute("data-hechos")) {
          mostrarHechos = !mostrarHechos;
          render();
          return;
        }
        if (control.hasAttribute("data-reiniciar")) {
          if (!confirm("¿Volver a mostrar todos los cambios? No se modifica la base ni el padrón.")) return;
          hechos = {};
          guardarHechos();
          ultimoMensaje = null;
          render();
          return;
        }
        const nuevoFiltro = control.getAttribute("data-filtro");
        if (nuevoFiltro) {
          filtro = nuevoFiltro;
          render();
        }
      });
    }
    if (lista) {
      lista.addEventListener("click", evento => {
        const botonAccion = evento.target.closest("button[data-accion]");
        if (botonAccion) accion(botonAccion);
      });
    }
    actualizarBadge();
    if (document.getElementById("panelRevision") &&
        !document.getElementById("panelRevision").hidden) {
      render();
    }
  }

  window.RevisionApp = {
    alMostrar: render,
    actualizar: actualizarBadge
  };

  iniciar();
})();
