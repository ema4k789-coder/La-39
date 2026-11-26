"use strict";
// Salidas educativas: nóminas por grado guardadas junto con la base de alumnos.
// Usa las funciones y la base ya cargadas por app.js.
(function() {
  const $ = id => document.getElementById(id);
  const form = $("salidaForm");
  if (!form || !window.ApiApp) return;

  let salidas = [], actual = null, grados = [], seleccion = new Map();
  let revisionSalidas = 0, cargando = false, guardando = false, dirty = false, llenando = false;

  function gradoEtiqueta(grado) {
    const match = /^([1-6])-([A-D])$/.exec(grado || "");
    return match ? match[1] + "° " + match[2] : (grado || "Sin grado");
  }

  function alumnoDe(feature) {
    const p = (feature && feature.properties) || {};
    return {
      persona_id: String(p.persona_id || ""),
      nombre: String(p.nombre_persona || "Sin nombre"),
      numero: String(p.numero_alumno || ""),
      grado: gradeOf(p),
      dni: String(p.dni || "")
    };
  }

  function alumnosActualesPorGrado() {
    const grupos = new Map();
    for (const feature of features) {
      if (!student(feature)) continue;
      const alumno = alumnoDe(feature);
      if (!alumno.persona_id) continue;
      if (!grupos.has(alumno.grado)) grupos.set(alumno.grado, []);
      grupos.get(alumno.grado).push({ feature, alumno });
    }
    for (const lista of grupos.values()) {
      lista.sort((uno, otro) => uno.alumno.nombre.localeCompare(otro.alumno.nombre, "es", { sensitivity: "base" }));
    }
    return grupos;
  }

  function ordenarSalidas(lista) {
    return lista.slice().sort((uno, otro) =>
      String(otro.fecha || "").localeCompare(String(uno.fecha || "")) ||
      String(otro.modificada || "").localeCompare(String(uno.modificada || "")) ||
      String(uno.nombre || "").localeCompare(String(otro.nombre || ""), "es"));
  }

  function marcarCambio() {
    if (llenando) return;
    dirty = true;
    actualizarBotones();
  }

  function aviso(texto, tipo) {
    $("salidaStatus").textContent = texto || "";
    if (texto) toast(texto, tipo || "info");
  }

  function actualizarBotones() {
    const guardado = !!actual;
    $("salidaEliminar").hidden = !guardado;
    $("salidaEliminar").disabled = !guardado || guardando;
    $("salidaExportar").disabled = !guardado || dirty || guardando;
    $("salidaExportarLista").disabled = !guardado || dirty || guardando;
    $("salidaGuardar").disabled = guardando;
    $("salidaVerMapa").disabled = !seleccion.size;
  }

  function renderLista() {
    const contenedor = $("salidasItems");
    contenedor.textContent = "";
    if (!salidas.length) {
      const vacio = document.createElement("p");
      vacio.className = "hint";
      vacio.textContent = "Todavía no hay salidas guardadas.";
      contenedor.appendChild(vacio);
      return;
    }
    for (const salida of salidas) {
      const item = document.createElement("button"), nombre = document.createElement("strong"),
        detalle = document.createElement("span"), cuenta = document.createElement("span");
      item.type = "button";
      item.className = "salida-item" + (actual && actual.id === salida.id ? " selected" : "");
      item.setAttribute("role", "listitem");
      item.dataset.id = salida.id;
      nombre.textContent = salida.nombre || "Salida sin nombre";
      const partes = [];
      if (salida.fecha) partes.push(formatearFecha(salida.fecha));
      if (salida.grados && salida.grados.length) partes.push(salida.grados.map(gradoEtiqueta).join(", "));
      detalle.textContent = partes.join(" · ") || "Sin fecha ni grados";
      cuenta.className = "salida-item-cuenta";
      cuenta.textContent = (salida.alumnos ? salida.alumnos.length : 0) + " alumnos";
      item.append(nombre, detalle, cuenta);
      item.addEventListener("click", () => abrirSalida(salida.id));
      contenedor.appendChild(item);
    }
  }

  function formatearFecha(texto) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto || "");
    return match ? match[3] + "/" + match[2] + "/" + match[1] : texto;
  }

  function renderGrados() {
    const caja = $("salidaGrados");
    caja.textContent = "";
    if (!grados.length) {
      const vacio = document.createElement("span");
      vacio.className = "hint";
      vacio.textContent = "Ninguno todavía. Agregá uno o más grados.";
      caja.appendChild(vacio);
    }
    for (const grado of grados) {
      const chip = document.createElement("span"), texto = document.createElement("span"),
        quitar = document.createElement("button");
      chip.className = "salida-chip";
      texto.textContent = gradoEtiqueta(grado);
      quitar.type = "button";
      quitar.textContent = "✕";
      quitar.setAttribute("aria-label", "Quitar " + gradoEtiqueta(grado) + " de la salida");
      quitar.addEventListener("click", () => quitarGrado(grado));
      chip.append(texto, quitar);
      caja.appendChild(chip);
    }
  }

  function renderSelectGrados() {
    const select = $("salidaAgregarGrado");
    const actualValor = select.value;
    select.textContent = "";
    select.appendChild(new Option("Elegí un grado…", ""));
    const grupos = alumnosActualesPorGrado();
    let quedan = false;
    for (const grado of gradosValidos()) {
      if (grados.includes(grado)) continue;
      quedan = true;
      const cantidad = (grupos.get(grado) || []).length;
      select.appendChild(new Option(gradoEtiqueta(grado) + " (" + cantidad + ")", grado));
    }
    select.disabled = !quedan;
    if (quedan && grados.includes(actualValor)) select.value = "";
  }

  function gradosValidos() {
    const lista = [];
    for (let curso = 1; curso <= 6; curso++) for (const division of "ABCD") {
      lista.push(curso + "-" + division);
    }
    return lista;
  }

  function buscarActual() {
    return salidas.find(salida => salida.id === (actual && actual.id)) || null;
  }

  function filasVisibles() {
    const term = $("salidaBuscar").value.trim().toLocaleLowerCase("es");
    const soloSel = $("salidaSoloSel").checked;
    const grupos = alumnosActualesPorGrado();
    const idsEnBase = new Set();
    for (const lista of grupos.values()) {
      for (const item of lista) idsEnBase.add(item.alumno.persona_id);
    }
    const coincide = alumno => !term || [alumno.nombre, alumno.numero, alumno.dni].some(valor =>
      String(valor || "").toLocaleLowerCase("es").includes(term));
    const bloques = [];
    for (const grado of grados) {
      const filas = [];
      for (const item of grupos.get(grado) || []) {
        if (soloSel && !seleccion.has(item.alumno.persona_id)) continue;
        if (!coincide(item.alumno)) continue;
        filas.push({ alumno: item.alumno, fuera: false });
      }
      for (const [id, guardado] of seleccion) {
        if (idsEnBase.has(id) || String(guardado.grado || "") !== grado) continue;
        if (!coincide(guardado)) continue;
        filas.push({ alumno: guardado, fuera: true });
      }
      if (filas.length) bloques.push({ titulo: gradoEtiqueta(grado), filas });
    }
    const otros = [];
    for (const [id, guardado] of seleccion) {
      if (idsEnBase.has(id)) continue;
      if (grados.includes(String(guardado.grado || ""))) continue;
      if (!coincide(guardado)) continue;
      otros.push({ alumno: guardado, fuera: true });
    }
    if (otros.length) bloques.push({ titulo: "Otros grados", filas: otros });
    return bloques;
  }

  function renderAlumnos() {
    const contenedor = $("salidaAlumnos");
    contenedor.textContent = "";
    if (!grados.length) {
      const vacio = document.createElement("p");
      vacio.className = "hint";
      vacio.textContent = "Agregá uno o más grados para ver a los alumnos y marcarlos.";
      contenedor.appendChild(vacio);
      return;
    }
    const bloques = filasVisibles();
    if (!bloques.length) {
      const vacio = document.createElement("p");
      vacio.className = "hint";
      vacio.textContent = $("salidaSoloSel").checked
        ? "Todavía no marcaste alumnos en esta salida."
        : "Ningún alumno coincide con la búsqueda.";
      contenedor.appendChild(vacio);
      return;
    }
    for (const bloque of bloques) {
      const grupo = document.createElement("div"), titulo = document.createElement("h3");
      grupo.className = "salida-grupo";
      titulo.textContent = bloque.titulo;
      grupo.appendChild(titulo);
      for (const fila of bloque.filas) {
        grupo.appendChild(filaAlumno(fila.alumno, fila.fuera));
      }
      contenedor.appendChild(grupo);
    }
  }

  function filaAlumno(alumno, fuera) {
    const fila = document.createElement("label"), casilla = document.createElement("input"),
      texto = document.createElement("span"), nombre = document.createElement("strong"),
      detalle = document.createElement("span");
    fila.className = "salida-fila" + (fuera ? " fuera" : "");
    casilla.type = "checkbox";
    casilla.checked = seleccion.has(alumno.persona_id);
    casilla.addEventListener("change", () => {
      if (casilla.checked) {
        seleccion.set(alumno.persona_id, {
          persona_id: alumno.persona_id, nombre: alumno.nombre,
          numero: alumno.numero, grado: alumno.grado, dni: alumno.dni
        });
      } else {
        seleccion.delete(alumno.persona_id);
      }
      marcarCambio();
      actualizarResumen();
      if ($("salidaSoloSel").checked) renderAlumnos();
    });
    texto.className = "salida-fila-texto";
    nombre.textContent = alumno.nombre || "Sin nombre";
    const datos = [];
    if (alumno.numero) datos.push("N.º " + alumno.numero);
    if (alumno.dni) datos.push("DNI " + alumno.dni);
    detalle.textContent = fuera
      ? (datos.join(" · ") + (datos.length ? " · " : "") + "ya no está en la lista actual")
      : (datos.join(" · ") || gradoEtiqueta(alumno.grado));
    texto.append(nombre, detalle);
    fila.append(casilla, texto);
    return fila;
  }

  function actualizarResumen() {
    const partes = [seleccion.size + " alumnos seleccionados"];
    if (grados.length) partes.push(grados.length + (grados.length === 1 ? " grado" : " grados"));
    if (dirty) partes.push("cambios sin guardar");
    $("salidaResumen").textContent = partes.join(" · ");
    actualizarBotones();
  }

  function llenarFormulario(salida) {
    llenando = true;
    $("salidaVacio").hidden = true;
    form.hidden = false;
    $("salidaNombre").value = salida ? salida.nombre || "" : "";
    $("salidaFecha").value = salida ? salida.fecha || "" : "";
    $("salidaNotas").value = salida ? salida.notas || "" : "";
    $("salidaBuscar").value = "";
    $("salidaSoloSel").checked = false;
    $("salidaStatus").textContent = "";
    llenando = false;
  }

  function pintar() {
    renderLista();
    renderGrados();
    renderSelectGrados();
    renderAlumnos();
    actualizarResumen();
  }

  function nuevaSalida() {
    if (dirty && !confirm("Hay cambios sin guardar en la salida actual. ¿Descartarlos y crear una nueva?")) return;
    actual = null;
    grados = [];
    seleccion = new Map();
    dirty = false;
    llenarFormulario(null);
    pintar();
    $("salidaNombre").focus();
  }

  function abrirSalida(id) {
    if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos y abrir otra salida?")) return;
    const salida = salidas.find(item => item.id === id);
    if (!salida) return;
    actual = salida;
    grados = Array.isArray(salida.grados) ? salida.grados.slice() : [];
    seleccion = new Map();
    for (const alumno of salida.alumnos || []) {
      if (alumno && alumno.persona_id) seleccion.set(alumno.persona_id, {
        persona_id: alumno.persona_id, nombre: String(alumno.nombre || ""),
        numero: String(alumno.numero || ""), grado: String(alumno.grado || ""),
        dni: String(alumno.dni || "")
      });
    }
    dirty = false;
    llenarFormulario(salida);
    pintar();
  }

  function quitarGrado(grado) {
    const marca = gradoEtiqueta(grado);
    const afectados = [];
    for (const [id, guardado] of seleccion) {
      const enBase = features.find(feature => student(feature) &&
        feature.properties && feature.properties.persona_id === id);
      const gradoActual = enBase ? gradeOf(enBase.properties) : String(guardado.grado || "");
      if (gradoActual === grado) afectados.push(id);
    }
    if (afectados.length && !confirm("Quitar " + marca + " también quita " + afectados.length +
      (afectados.length === 1 ? " alumno marcado" : " alumnos marcados") + ". ¿Continuar?")) return;
    for (const id of afectados) seleccion.delete(id);
    grados = grados.filter(valor => valor !== grado);
    marcarCambio();
    pintar();
  }

  function agregarGrado(grado) {
    if (!/^[1-6]-[A-D]$/.test(grado) || grados.includes(grado)) return;
    grados.push(grado);
    grados.sort((uno, otro) => gradoEtiqueta(uno).localeCompare(gradoEtiqueta(otro), "es", { numeric: true }));
    marcarCambio();
    pintar();
  }

  function datosSalida() {
    const alumnos = [];
    for (const [id, guardado] of seleccion) {
      const feature = features.find(item => student(item) &&
        item.properties && item.properties.persona_id === id);
      const base = feature ? alumnoDe(feature) : guardado;
      alumnos.push({
        persona_id: id, nombre: base.nombre, numero: base.numero,
        grado: base.grado, dni: base.dni
      });
    }
    return {
      id: actual ? actual.id : "",
      nombre: $("salidaNombre").value.trim(),
      fecha: $("salidaFecha").value || "",
      notas: $("salidaNotas").value.trim(),
      grados: grados.slice(),
      alumnos,
      anio: schoolYear || 0
    };
  }

  async function guardar(evento) {
    evento.preventDefault();
    if (guardando) return;
    if (!seleccion.size && !confirm("La salida no tiene alumnos marcados. ¿Guardarla igual?")) return;
    guardando = true;
    actualizarBotones();
    $("salidaStatus").textContent = "Guardando…";
    try {
      const resultado = await ApiApp.post("/api/salidas",
        { revision: revisionSalidas, accion: "guardar", salida: datosSalida() });
      revision = resultado.revision;
      revisionSalidas = resultado.revision;
      salidas = ordenarSalidas(resultado.salidas || []);
      actual = resultado.salida || null;
      dirty = false;
      aviso("✓ Salida guardada: " + (actual ? actual.nombre : ""), "success");
    } catch (error) {
      aviso("No se pudo guardar la salida: " + error.message, "error");
    } finally {
      guardando = false;
      pintar();
    }
  }

  async function eliminar() {
    if (!actual) return;
    if (!confirm("¿Eliminar la salida «" + actual.nombre + "»? Esta acción no se puede deshacer.")) return;
    guardando = true;
    actualizarBotones();
    try {
      const resultado = await ApiApp.post("/api/salidas",
        { revision: revisionSalidas, accion: "eliminar", id: actual.id });
      revision = resultado.revision;
      revisionSalidas = resultado.revision;
      salidas = ordenarSalidas(resultado.salidas || []);
      actual = null;
      grados = [];
      seleccion = new Map();
      dirty = false;
      form.hidden = true;
      $("salidaVacio").hidden = false;
      aviso("Salida eliminada.", "success");
    } catch (error) {
      aviso("No se pudo eliminar: " + error.message, "error");
    } finally {
      guardando = false;
      pintar();
    }
  }

  function exportar(tipo) {
    if (!actual) { aviso("Guardá la salida antes de exportar.", "error"); return; }
    if (dirty) { aviso("Guardá los cambios antes de exportar.", "error"); return; }
    $("salidaStatus").textContent = "Preparando el Excel…";
    const ruta = "/api/salida.xlsx?id=" + encodeURIComponent(actual.id) + "&tipo=" + tipo;
    ApiApp.descargar(ruta).then(() => {
      $("salidaStatus").textContent = "Excel generado.";
    }).catch(error => aviso("No se pudo exportar: " + error.message, "error"));
  }

  function verEnMapa() {
    if (!seleccion.size) { aviso("Marcá al menos un alumno para verlo en el mapa.", "error"); return; }
    if (window.RestablecerVista) window.RestablecerVista();
    if (window.aplicarFiltroSalida) {
      window.aplicarFiltroSalida(Array.from(seleccion.keys()),
        $("salidaNombre").value.trim() || "Salida sin nombre");
    }
    if (window.CambiarPanel) window.CambiarPanel("mapa");
    setTimeout(() => {
      if (typeof map !== "undefined") map.invalidateSize();
      if (typeof encuadrarPuntos === "function") encuadrarPuntos(false);
    }, 450);
  }

  async function cargarLista() {
    if (cargando) return;
    cargando = true;
    try {
      if (!ApiApp.local) {
        aviso("Las salidas se guardan en la versión de la PC o el teléfono.", "error");
        return;
      }
      const datos = await ApiApp.get("/api/salidas");
      salidas = ordenarSalidas(Array.isArray(datos.salidas) ? datos.salidas : []);
      revisionSalidas = datos.revision;
      revision = datos.revision;
      renderLista();
      renderSelectGrados();
      if (actual) {
        const vigente = buscarActual();
        if (!vigente) {
          actual = null;
          form.hidden = true;
          $("salidaVacio").hidden = false;
        } else {
          actual = vigente;
        }
      }
      actualizarBotones();
    } catch (error) {
      aviso("No se pudieron cargar las salidas: " + error.message, "error");
    } finally {
      cargando = false;
    }
  }

  async function alMostrar() {
    if (!features.length) {
      try { await loadData(); } catch (error) { aviso("No se pudo cargar la base: " + error.message, "error"); }
    }
    await cargarLista();
    renderSelectGrados();
  }

  $("nuevaSalida").addEventListener("click", nuevaSalida);
  form.addEventListener("submit", guardar);
  $("salidaEliminar").addEventListener("click", eliminar);
  $("salidaExportar").addEventListener("click", () => exportar("datos"));
  $("salidaExportarLista").addEventListener("click", () => exportar("lista"));
  $("salidaVerMapa").addEventListener("click", verEnMapa);
  $("salidaAgregarGrado").addEventListener("change", evento => {
    const grado = evento.target.value;
    evento.target.value = "";
    agregarGrado(grado);
  });
  $("salidaBuscar").addEventListener("input", renderAlumnos);
  $("salidaSoloSel").addEventListener("change", renderAlumnos);
  for (const id of ["salidaNombre", "salidaFecha", "salidaNotas"]) {
    $(id).addEventListener("input", marcarCambio);
    $(id).addEventListener("change", marcarCambio);
  }

  window.SalidasApp = { alMostrar };
})();
