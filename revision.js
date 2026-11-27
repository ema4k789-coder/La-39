"use strict";
// Sección Revisión: anotador de pendientes por equipo. Arranca con los cambios
// de la actualización, pero también permite agregar casos nuevos o especiales,
// editarlos y quitarlos. Quitar de la lista o vaciar NO toca la base: solo
// "Agregar a la base", "Mover al grado" y "Guardar en la base" (al editar un
// alumno existente) escriben en la base real.
(function() {
  const CLAVE = "escuela39.revision.v2";
  const CLAVE_VIEJA = "escuela39.revision.v1";
  const CAMPOS_BASE = ["nombre_persona", "numero_alumno", "dni", "fecha_nacimiento", "direccion_texto",
    "referente_familiar", "responsable_nacionalidad", "responsable_actividad",
    "telefono_contacto_familia", "observaciones"];
  const TIPOS = { agregado: "Agregado", editado: "Editado", faltante: "Falta en la base", propio: "Caso nuevo" };
  const FILTROS = [
    { id: "todos", texto: "Todos" },
    { id: "agregado", texto: "Agregados" },
    { id: "editado", texto: "Editados" },
    { id: "faltante", texto: "Faltantes" },
    { id: "propio", texto: "Casos nuevos" }
  ];
  const GRADOS = [];
  for (let curso = 1; curso <= 6; curso++) {
    for (const division of ["A", "B", "C", "D"]) GRADOS.push(curso + "-" + division);
  }

  let filtro = "todos";
  let mostrarHechos = false;
  let abrirAlta = false;
  let editando = "";
  let editor = null;
  let estado = nuevoEstado("");
  let ultimoMensaje = null;
  let ocupado = false;

  function nuevoEstado(id) {
    return { id: id || "", hechos: {}, quitados: {}, notas: {}, datos: {}, propios: [] };
  }

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

  function gradoPartes(grado) {
    const [curso, division] = String(grado || "").split("-");
    return [String(curso || ""), String(division || "").toUpperCase()];
  }

  function etiqueta(tipo) {
    return TIPOS[tipo] || tipo;
  }

  function cargarEstado() {
    const datos = window.REVISION_EP39 || {};
    estado = nuevoEstado(datos.id || "");
    let guardado = null;
    try {
      guardado = JSON.parse(localStorage.getItem(CLAVE) || "null");
    } catch (error) {
      guardado = null;
    }
    if (!guardado) {
      try {
        const viejo = JSON.parse(localStorage.getItem(CLAVE_VIEJA) || "null");
        if (viejo && viejo.id === estado.id && viejo.hechos) {
          estado.hechos = viejo.hechos;
          guardarEstado();
        }
      } catch (error) {}
      return;
    }
    if (guardado.id === estado.id) {
      estado.hechos = guardado.hechos || {};
      estado.quitados = guardado.quitados || {};
      estado.notas = guardado.notas || {};
      estado.datos = guardado.datos || {};
      estado.propios = Array.isArray(guardado.propios) ? guardado.propios : [];
      return;
    }
    // Si cambia la actualización, se conservan los casos propios y sus notas.
    estado.propios = Array.isArray(guardado.propios) ? guardado.propios : [];
    for (const clave of Object.keys(guardado.notas || {})) {
      if (clave.indexOf("propio:") === 0) estado.notas[clave] = guardado.notas[clave];
    }
    for (const clave of Object.keys(guardado.datos || {})) {
      if (clave.indexOf("propio:") === 0) estado.datos[clave] = guardado.datos[clave];
    }
  }

  function guardarEstado() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({
        id: estado.id, hechos: estado.hechos, quitados: estado.quitados,
        notas: estado.notas, datos: estado.datos, propios: estado.propios
      }));
    } catch (error) {}
  }

  function conAjustes(original, clave) {
    const salida = Object.assign({}, original);
    const ajuste = estado.datos[clave];
    if (ajuste) {
      for (const campo of ["nombre", "dni", "direccion", "telefono", "curso", "division"]) {
        if (ajuste[campo] !== undefined) salida[campo] = ajuste[campo];
      }
    }
    salida.nota = estado.notas[clave] || "";
    return salida;
  }

  function items() {
    const datos = window.REVISION_EP39 || {};
    const salida = [];
    for (const tipo of ["agregado", "editado", "faltante"]) {
      const lista = Array.isArray(datos[tipo + "s"]) ? datos[tipo + "s"] : [];
      for (const original of lista) {
        if (!original || !original.persona_id) continue;
        const clave = tipo + ":" + original.persona_id;
        salida.push({ tipo, clave, enBase: tipo !== "faltante", original,
          item: conAjustes(original, clave) });
      }
    }
    for (const original of estado.propios) {
      if (!original || !original.persona_id) continue;
      const clave = "propio:" + original.persona_id;
      salida.push({ tipo: "propio", clave, enBase: false, original,
        item: conAjustes(original, clave) });
    }
    return salida;
  }

  function activo(entry) {
    return !estado.hechos[entry.clave] && !estado.quitados[entry.clave];
  }

  function opcionesGrado(item) {
    const actual = String((item && item.curso) || "").trim() + "-" +
      String((item && item.division) || "").trim().toUpperCase();
    return GRADOS.map(grado => '<option value="' + grado + '"' +
      (grado === actual ? " selected" : "") + ">" + gradoValor(grado) + "</option>").join("");
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

  function notaHtml(item) {
    if (!String(item.nota || "").trim()) return "";
    return '<p class="revision-nota"><strong>Nota:</strong> ' + esc(item.nota) + "</p>";
  }

  function estadoHtml() {
    if (!ultimoMensaje) return "";
    return '<p class="revision-estado ' + esc(ultimoMensaje.tipo || "") + '" role="status">' +
      esc(ultimoMensaje.texto) + "</p>";
  }

  function cambiarClaseEstado(elemento, tipo) {
    if (!elemento) return;
    elemento.className = "revision-estado" + (tipo ? " " + tipo : "");
    elemento.textContent = "";
  }

  function campo(texto, nombre, valorActual) {
    return "<label>" + esc(texto) +
      '<input data-campo="' + esc(nombre) + '" type="text" autocomplete="off" value="' +
      esc(valorActual == null ? "" : valorActual) + '"></label>';
  }

  function campoNota(valorActual) {
    return '<label class="revision-ancho">Nota<textarea data-campo="nota" rows="2" autocomplete="off">' +
      esc(valorActual == null ? "" : valorActual) + "</textarea></label>";
  }

  function formularioEdicion(entry) {
    const datos = editor && editor.clave === entry.clave ? editor.datos : entry.item;
    const aviso = entry.enBase
      ? "Si cambiás algún dato, al guardar se actualiza la base real y se pide confirmación. La nota queda solo en esta lista."
      : "Se guarda solo en esta lista; la base no cambia hasta que uses «Agregar a la base».";
    return '<div class="revision-editor" data-editor="1">' +
      '<div class="revision-campos">' +
        campo("Nombre", "nombre", datos.nombre) +
        campo("DNI", "dni", datos.dni) +
        campo("Domicilio", "direccion", datos.direccion) +
        campo("Teléfono", "telefono", datos.telefono) +
        "<label>Grado<select data-campo=\"grado\">" + opcionesGrado(datos) + "</select></label>" +
      "</div>" +
      campoNota(datos.nota) +
      '<p class="revision-aviso">' + esc(aviso) + "</p>" +
      '<div class="revision-acciones">' +
        '<button type="button" class="revision-boton primary" data-accion="guardar-edicion">Guardar cambios</button>' +
        '<button type="button" class="revision-boton" data-accion="cancelar-edicion">Cancelar</button>' +
      "</div>" +
      "</div>";
  }

  function tarjeta(entry) {
    const item = entry.item;
    const hecho = !!estado.hechos[entry.clave];
    const quitado = !!estado.quitados[entry.clave];
    const resuelto = hecho || quitado;
    const principal = entry.enBase ? "Mover al grado" : "Agregar a la base";
    const deshabilitado = resuelto || ocupado ? " disabled" : "";
    const editandoEsta = editando === entry.clave;
    const etiquetaEstado = hecho ? "Hecho en la base" : "Quitado de la lista";
    return '<article class="revision-item' + (resuelto ? " revision-hecho" : "") +
      (quitado ? " revision-quitado" : "") + '" data-tipo="' + esc(entry.tipo) +
      '" data-clave="' + esc(entry.clave) + '">' +
      '<div class="revision-item-cabecera">' +
        '<span class="revision-tipo revision-tipo-' + esc(entry.tipo) + '">' + esc(etiqueta(entry.tipo)) + "</span>" +
        '<strong class="revision-nombre">' + esc(item.nombre || "Sin nombre") + "</strong>" +
        '<span class="revision-grado">' + esc(gradoTexto(item)) + "</span>" +
      "</div>" +
      detalleHtml(item) + cambiosHtml(item) + notaHtml(item) +
      (editandoEsta ? formularioEdicion(entry) :
        (resuelto
          ? '<div class="revision-acciones">' +
              '<span class="revision-etiqueta-estado">' + esc(etiquetaEstado) + "</span>" +
              '<button type="button" class="revision-boton" data-accion="deshacer">Volver a la lista</button>' +
            "</div>"
          : '<div class="revision-acciones">' +
              "<label>Grado<select class=\"revision-grado-select\"" + deshabilitado + ">" +
                opcionesGrado(item) + "</select></label>" +
              '<button type="button" class="revision-boton primary" data-accion="principal"' + deshabilitado + ">" +
                principal + "</button>" +
              '<button type="button" class="revision-boton" data-accion="editar"' + deshabilitado + ">Editar</button>" +
              '<button type="button" class="revision-boton danger" data-accion="quitar"' + deshabilitado +
                ' title="Se quita solo de esta lista; no se borra de la base">Quitar de la lista</button>' +
            "</div>")) +
      '<p class="revision-estado" role="status"></p>' +
      "</article>";
  }

  function formularioAlta() {
    return '<div class="revision-editor revision-alta">' +
      '<p class="revision-aviso">El caso nuevo queda solo en esta lista hasta que uses «Agregar a la base».</p>' +
      '<div class="revision-campos">' +
        '<label>Nombre<input id="altaNombre" type="text" autocomplete="off"></label>' +
        '<label>DNI<input id="altaDni" type="text" autocomplete="off"></label>' +
        '<label>Domicilio<input id="altaDireccion" type="text" autocomplete="off"></label>' +
        '<label>Teléfono<input id="altaTelefono" type="text" autocomplete="off"></label>' +
        '<label>Grado<select id="altaGrado">' + opcionesGrado({ curso: "1", division: "A" }) + "</select></label>" +
      "</div>" +
      '<label class="revision-ancho">Nota<textarea id="altaNota" rows="2" autocomplete="off"></textarea></label>' +
      '<p class="revision-estado error" data-alta-error></p>' +
      '<div class="revision-acciones">' +
        '<button type="button" class="revision-boton primary" data-alta-guardar="1">Agregar a la lista</button>' +
        '<button type="button" class="revision-boton" data-alta-cancelar="1">Cancelar</button>' +
      "</div>" +
      "</div>";
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
    const activos = todos.filter(activo);
    const hechos = todos.filter(entry => estado.hechos[entry.clave]).length;
    const quitados = todos.filter(entry => estado.quitados[entry.clave]).length;
    const filtros = FILTROS.map(opcion => {
      const cuenta = opcion.id === "todos" ? activos.length
        : activos.filter(entry => entry.tipo === opcion.id).length;
      return '<button type="button" class="revision-filtro" data-filtro="' + opcion.id +
        '" aria-pressed="' + (filtro === opcion.id) + '">' + opcion.texto +
        " (" + cuenta + ")</button>";
    }).join("") +
      '<button type="button" class="revision-filtro" data-hechos="1" aria-pressed="' +
        mostrarHechos + '">' + (mostrarHechos ? "Ocultar hechos" : "Mostrar hechos") +
        (hechos + quitados ? " (" + (hechos + quitados) + ")" : "") + "</button>" +
      (hechos + quitados ? '<button type="button" class="revision-filtro" data-reiniciar="1">' +
        "Volver a mostrar todo</button>" : "");
    const herramientas =
      (abrirAlta ? "" : '<button type="button" class="revision-boton primary" data-alta="1">Agregar caso</button>') +
      (activos.length ? '<button type="button" class="revision-boton" data-vaciar="1">Vaciar pendientes</button>' : "");
    resumen.innerHTML =
      '<p class="revision-resumen-fuente">' + esc(datos.fuente || "Actualización de la base") +
        ". Antes: " + esc((datos.anterior || {}).total) + " alumnos · ahora: " +
        esc((datos.actual || {}).total) + " alumnos.</p>" +
      '<p class="revision-resumen-texto">Esta lista es un anotador de casos dudosos: podés agregar casos nuevos o especiales, editar y quitar. ' +
        '<strong>Quitar de la lista no borra alumnos de la base.</strong> La base solo cambia con «Agregar a la base» o «Mover al grado».</p>' +
      (herramientas ? '<div class="revision-filtros">' + herramientas + "</div>" : "") +
      (abrirAlta ? formularioAlta() : "") +
      '<div class="revision-filtros" role="group" aria-label="Filtrar la revisión">' + filtros + "</div>" +
      "<p>" + activos.length + " pendientes de " + todos.length + " casos.</p>" +
      estadoHtml();
    const visibles = todos.filter(entry =>
      (filtro === "todos" || entry.tipo === filtro) && (mostrarHechos || activo(entry)));
    if (!visibles.length) {
      const texto = !todos.length
        ? "La lista está vacía. Podés agregar un caso o cargar una actualización; la base no cambió."
        : (!mostrarHechos && !activos.length
          ? "No hay pendientes. Todo quedó hecho o quitado de la lista."
          : "No hay casos para mostrar con este filtro.");
      lista.innerHTML = '<p class="revision-vacio">' + esc(texto) + "</p>";
    } else {
      lista.innerHTML = visibles.map(tarjeta).join("");
    }
    actualizarBadge();
  }

  function actualizarBadge() {
    const badge = document.getElementById("revisionBadge");
    if (!badge) return;
    const pendientes = items().filter(activo).length;
    badge.textContent = String(pendientes);
    badge.hidden = pendientes === 0;
  }

  function mensaje(texto, tipo) {
    ultimoMensaje = { texto, tipo: tipo || "" };
  }

  function progreso(tarjeta, texto) {
    const estadoLinea = tarjeta ? tarjeta.querySelector(".revision-estado") : null;
    cambiarClaseEstado(estadoLinea);
    if (estadoLinea) estadoLinea.textContent = texto || "";
    const boton = tarjeta ? tarjeta.querySelector("button[data-accion]") : null;
    return boton;
  }

  function errorEn(tarjeta, texto) {
    const estadoLinea = tarjeta ? tarjeta.querySelector(".revision-estado") : null;
    if (estadoLinea) {
      estadoLinea.className = "revision-estado error";
      estadoLinea.textContent = texto;
    }
    mensaje(texto, "error");
  }

  function mensajeDeError(error) {
    const texto = (error && error.message) || "No se pudo completar la operación.";
    return /DNI/i.test(texto)
      ? texto + " Revisá la ficha en el mapa y corregí el DNI antes de agregarlo."
      : texto;
  }

  async function datosActuales() {
    return window.ApiApp.get("/api/datos");
  }

  async function refrescarMapa() {
    try {
      if (window.MapaApp && typeof window.MapaApp.refrescar === "function") {
        await window.MapaApp.refrescar();
      }
    } catch (error) {}
  }

  function marcarHecho(entry, hecho) {
    if (hecho) {
      estado.hechos[entry.clave] = true;
      delete estado.quitados[entry.clave];
    } else {
      delete estado.hechos[entry.clave];
    }
    guardarEstado();
  }

  function alPrincipal(entry, tarjeta) {
    const item = entry.item;
    const selector = tarjeta.querySelector(".revision-grado-select");
    const grado = selector ? selector.value : "";
    const [curso, division] = gradoPartes(grado);
    if (!curso || !division) {
      errorEn(tarjeta, "Elegí un grado para agregar al alumno a la base.");
      return Promise.resolve(false);
    }
    if (entry.enBase && String(item.curso) === curso &&
        String(item.division || "").toUpperCase() === division) {
      errorEn(tarjeta, "Elegí un grado distinto al actual para mover al alumno.");
      return Promise.resolve(false);
    }
    if (!entry.enBase && !String(item.nombre || "").trim()) {
      errorEn(tarjeta, "Falta el nombre del alumno: no se puede agregar desde acá.");
      return Promise.resolve(false);
    }
    return (async () => {
      const datos = await datosActuales();
      if (entry.enBase) {
        await window.ApiApp.post("/api/trasladar", {
          revision: datos.revision, id: item.persona_id, grado
        });
        mensaje("Movido a " + gradoValor(grado) + ": " + (item.nombre || "el alumno") + ".", "ok");
      } else {
        const campos = entry.tipo === "faltante"
          ? Object.assign({}, entry.original.campos || {}) : {};
        campos.nombre_persona = String(item.nombre || "").trim();
        campos.dni = String(item.dni || "").replace(/\D/g, "");
        campos.direccion_texto = String(item.direccion || "").trim();
        campos.telefono_contacto_familia = String(item.telefono || "").trim();
        const payload = { revision: datos.revision, grado, campos };
        const direccionCambiada = String(item.direccion || "").trim() !==
          String(entry.original.direccion || "").trim();
        if (entry.tipo === "faltante" && !direccionCambiada &&
            Array.isArray(entry.original.coordenadas) && entry.original.coordenadas.length === 2) {
          payload.coordenadas = entry.original.coordenadas;
          payload.referencia = entry.original.referencia || "";
        }
        await window.ApiApp.post("/api/guardar", payload);
        mensaje("Agregado a " + gradoValor(grado) + ": " + campos.nombre_persona + ".", "ok");
      }
      marcarHecho(entry, true);
      await refrescarMapa();
      return true;
    })();
  }

  function leerCampos(tarjeta) {
    const leer = nombre => {
      const control = tarjeta.querySelector('[data-campo="' + nombre + '"]');
      return control ? String(control.value || "").trim() : "";
    };
    return { nombre: leer("nombre"), dni: leer("dni"), direccion: leer("direccion"),
      telefono: leer("telefono"), grado: leer("grado"), nota: leer("nota") };
  }

  async function guardarFichaEnBase(entry, campos) {
    const datos = await datosActuales();
    const features = (datos.datos && datos.datos.features) || [];
    const feature = features.find(candidato => candidato && candidato.properties &&
      candidato.properties.persona_id === entry.original.persona_id);
    if (!feature) throw new Error("No se encontró el alumno en la base.");
    const camposBase = {};
    for (const nombre of CAMPOS_BASE) {
      camposBase[nombre] = String(feature.properties[nombre] == null ? "" : feature.properties[nombre]);
    }
    camposBase.nombre_persona = campos.nombre;
    camposBase.dni = campos.dni;
    camposBase.direccion_texto = campos.direccion;
    camposBase.telefono_contacto_familia = campos.telefono;
    await window.ApiApp.post("/api/guardar", {
      revision: datos.revision, id: entry.original.persona_id, grado: campos.grado, campos: camposBase
    });
    await refrescarMapa();
    return datos.revision;
  }

  function guardarEdicion(entry, tarjeta) {
    const campos = leerCampos(tarjeta);
    if (!campos.nombre) {
      errorEn(tarjeta, "Escribí el nombre del alumno o caso.");
      return Promise.resolve(false);
    }
    const [curso, division] = gradoPartes(campos.grado);
    const previo = editor && editor.clave === entry.clave ? editor.datos : entry.item;
    const cambioBase = entry.enBase && (
      campos.nombre !== String(previo.nombre || "") ||
      campos.dni !== String(previo.dni || "") ||
      campos.direccion !== String(previo.direccion || "") ||
      campos.telefono !== String(previo.telefono || "") ||
      curso !== String(previo.curso || "") ||
      division !== String(previo.division || "").toUpperCase());
    if (entry.enBase && cambioBase &&
        !confirm("Se guardarán los cambios en la base real. ¿Continuar?")) {
      return Promise.resolve(false);
    }
    return (async () => {
      if (entry.enBase && cambioBase) {
        await guardarFichaEnBase(entry, campos);
        mensaje("Guardado en la base y en la lista: " + campos.nombre + ".", "ok");
        marcarHecho(entry, true);
      } else {
        mensaje(entry.enBase
          ? "Nota guardada en la lista: " + campos.nombre + ". La base no cambió."
          : "Guardado en la lista: " + campos.nombre + ". La base no cambió.", "ok");
      }
      estado.datos[entry.clave] = { nombre: campos.nombre, dni: campos.dni,
        direccion: campos.direccion, telefono: campos.telefono, curso, division };
      estado.notas[entry.clave] = campos.nota;
      guardarEstado();
      editando = "";
      editor = null;
      return true;
    })();
  }

  async function abrirEditor(entry) {
    if (entry.enBase) {
      try {
        const datos = await datosActuales();
        const features = (datos.datos && datos.datos.features) || [];
        const feature = features.find(candidato => candidato && candidato.properties &&
          candidato.properties.persona_id === entry.original.persona_id);
        if (!feature) {
          mensaje("No se encontró el alumno en la base para editar.", "error");
          render();
          return;
        }
        const p = feature.properties || {};
        editor = { clave: entry.clave, datos: {
          nombre: p.nombre_persona || "", dni: p.dni || "", direccion: p.direccion_texto || "",
          telefono: p.telefono_contacto_familia || "", curso: p.curso || "",
          division: String(p.division || "").toUpperCase(), nota: entry.item.nota || ""
        } };
      } catch (error) {
        mensaje("No se pudo leer la ficha: " + mensajeDeError(error), "error");
        render();
        return;
      }
    } else {
      editor = { clave: entry.clave, datos: {
        nombre: entry.item.nombre || "", dni: entry.item.dni || "",
        direccion: entry.item.direccion || "", telefono: entry.item.telefono || "",
        curso: entry.item.curso || "", division: String(entry.item.division || "").toUpperCase(),
        nota: entry.item.nota || ""
      } };
    }
    editando = entry.clave;
    render();
  }

  function alQuitar(entry) {
    estado.quitados[entry.clave] = true;
    delete estado.hechos[entry.clave];
    guardarEstado();
    mensaje("Quitado de la lista: " + (entry.item.nombre || "el caso") + ". La base no cambió.", "ok");
    render();
  }

  function alVaciar() {
    const activos = items().filter(activo);
    if (!activos.length) return;
    if (!confirm("¿Vaciar toda la lista de pendientes? No se borra ningún alumno de la base. " +
        "Se puede recuperar con «Mostrar hechos».")) return;
    for (const entry of items()) {
      estado.quitados[entry.clave] = true;
      delete estado.hechos[entry.clave];
    }
    abrirAlta = false;
    editando = "";
    editor = null;
    guardarEstado();
    mensaje("Lista vaciada. No se modificó la base de datos.", "ok");
    render();
  }

  function alReiniciar() {
    if (!confirm("¿Volver a mostrar todos los casos? No se modifica la base ni el padrón.")) return;
    estado.hechos = {};
    estado.quitados = {};
    guardarEstado();
    mensaje("Se volvieron a mostrar todos los casos. La base no cambió.", "ok");
    render();
  }

  function agregarCaso() {
    const valorDe = id => {
      const control = document.getElementById(id);
      return control ? String(control.value || "").trim() : "";
    };
    const nombre = valorDe("altaNombre");
    const caja = document.querySelector(".revision-alta");
    const error = caja ? caja.querySelector("[data-alta-error]") : null;
    if (error) error.textContent = "";
    if (!nombre) {
      if (error) error.textContent = "Escribí el nombre del caso.";
      return;
    }
    const [curso, division] = gradoPartes(valorDe("altaGrado") || "1-A");
    const id = "P-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    estado.propios.push({ persona_id: id, nombre, dni: valorDe("altaDni"),
      direccion: valorDe("altaDireccion"), telefono: valorDe("altaTelefono"),
      curso: curso || "1", division: division || "A", creado: new Date().toISOString() });
    estado.notas["propio:" + id] = valorDe("altaNota");
    abrirAlta = false;
    guardarEstado();
    mensaje("Caso agregado a la lista: " + nombre + ". La base no cambió.", "ok");
    render();
  }

  async function accion(boton) {
    if (ocupado) return;
    const tarjeta = boton.closest(".revision-item");
    if (!tarjeta) return;
    const clave = tarjeta.getAttribute("data-clave");
    const entry = items().find(candidato => candidato.clave === clave);
    if (!entry) return;
    const nombreAccion = boton.getAttribute("data-accion");
    if (nombreAccion === "editar") {
      await abrirEditor(entry);
      return;
    }
    if (nombreAccion === "cancelar-edicion") {
      editando = "";
      editor = null;
      render();
      return;
    }
    if (nombreAccion === "deshacer") {
      delete estado.hechos[entry.clave];
      delete estado.quitados[entry.clave];
      guardarEstado();
      mensaje("Volvió a la lista: " + (entry.item.nombre || "el caso") +
        ". Los cambios ya guardados en la base no se deshacen.", "ok");
      render();
      return;
    }
    if (nombreAccion === "quitar") {
      alQuitar(entry);
      return;
    }
    const textoBoton = boton.textContent;
    ocupado = true;
    boton.disabled = true;
    boton.textContent = "Guardando…";
    progreso(tarjeta, "Guardando el cambio…");
    try {
      const resultado = nombreAccion === "guardar-edicion"
        ? await guardarEdicion(entry, tarjeta)
        : await alPrincipal(entry, tarjeta);
      if (resultado === false) {
        boton.disabled = false;
        boton.textContent = textoBoton;
        ocupado = false;
        return;
      }
    } catch (error) {
      errorEn(tarjeta, mensajeDeError(error));
      boton.disabled = false;
      boton.textContent = textoBoton;
      ocupado = false;
      return;
    }
    ocupado = false;
    render();
  }

  function iniciar() {
    const boton = document.querySelector('.panel-tab[data-panel="revision"]');
    if (!window.REVISION_EP39) {
      if (boton) boton.hidden = true;
      return;
    }
    cargarEstado();
    const resumen = document.getElementById("revisionResumen");
    const lista = document.getElementById("revisionLista");
    if (resumen) {
      resumen.addEventListener("click", evento => {
        const control = evento.target.closest("button");
        if (!control) return;
        if (control.hasAttribute("data-alta")) {
          abrirAlta = !abrirAlta;
          editando = "";
          editor = null;
          render();
          return;
        }
        if (control.hasAttribute("data-alta-cancelar")) {
          abrirAlta = false;
          render();
          return;
        }
        if (control.hasAttribute("data-alta-guardar")) {
          agregarCaso();
          return;
        }
        if (control.hasAttribute("data-vaciar")) {
          alVaciar();
          return;
        }
        if (control.hasAttribute("data-hechos")) {
          mostrarHechos = !mostrarHechos;
          render();
          return;
        }
        if (control.hasAttribute("data-reiniciar")) {
          alReiniciar();
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
