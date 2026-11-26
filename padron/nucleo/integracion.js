"use strict";
// Une el padrón con la base del mapa. Lee y escribe en la misma base usando la
// API del documento padre (PC y APK comparten origen), así los cambios de un
// lado aparecen del otro sin depender de archivos intermedios.
(function() {
  const T = window.TextoPadron;
  const Act = window.ActualizacionPadron;
  const HOST_APP = "appassets.androidplatform.net";
  const CAMPOS = ["nombre", "dni", "nacimiento", "direccion", "telefono", "responsable",
    "nacionalidad", "actividad", "observaciones"];

  let base = new Map();
  let baseLista = false;
  let ultimaLista = new Set();
  let revision = 0;
  let pendiente = false;
  let cola = Promise.resolve();
  let alRecibir = null;

  function apiPadre() {
    try {
      const padre = window.parent;
      if (padre && padre !== window && padre.ApiApp) return padre.ApiApp;
    } catch (error) {
      // El documento padre puede estar bloqueado; se prueba la API HTTP.
    }
    return window.ApiApp || null;
  }

  function embebida() {
    try {
      return !!window.parent && window.parent !== window;
    } catch (error) {
      return true;
    }
  }

  function apiHttp() {
    if (embebida()) return null;
    if (location.hostname === HOST_APP) return null;
    if (location.protocol !== "http:" && location.protocol !== "https:") return null;
    const leer = async respuesta => {
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.error || "No se pudo completar la operación.");
      return datos;
    };
    return {
      get: ruta => fetch(ruta, { cache: "no-store" }).then(leer),
      post: (ruta, cuerpo) => fetch(ruta, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }).then(leer)
    };
  }

  function api() {
    const propia = apiPadre();
    if (propia && typeof propia.get === "function" && typeof propia.post === "function") return propia;
    return apiHttp();
  }

  function disponible() {
    return !!api();
  }

  function pendienteDeGuardar() {
    return pendiente;
  }

  function lista() {
    return baseLista;
  }

  function conectar(actualizar) {
    alRecibir = typeof actualizar === "function" ? actualizar : null;
  }

  function claveNombre(registro) {
    return T.normalizar(registro.nombre) + "|" + String(registro.grado || "") +
      String(registro.division || "").toUpperCase();
  }

  function fechaMapa(iso) {
    const partes = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return partes ? partes[3] + "/" + partes[2] + "/" + partes[1] : String(iso || "");
  }

  function leerBase(payload) {
    const lectura = Act.leer(JSON.stringify({
      anio: payload.anio,
      generado: payload.generado || "",
      datos: payload.datos
    }));
    const crudos = new Map();
    (payload.datos.features || []).forEach(feature => {
      const props = feature && feature.properties;
      if (!props) return;
      const personaId = String(props.persona_id || "");
      if (personaId && !crudos.has(personaId)) crudos.set(personaId, props);
    });
    const indice = new Map();
    lectura.registros.forEach(registro => {
      if (!registro.personaId) return;
      indice.set(registro.personaId, Object.assign({}, registro,
        { raw: crudos.get(registro.personaId) || {} }));
    });
    const alumnos = lectura.registros.map(registro => ({
      id: registro.id,
      personaId: registro.personaId || "",
      nombre: registro.nombre,
      dni: registro.dni,
      nacimiento: registro.nacimiento,
      grado: registro.grado,
      division: registro.division,
      direccion: registro.direccion,
      telefono: registro.telefono,
      responsable: registro.responsable,
      nacionalidad: registro.nacionalidad,
      actividad: registro.actividad,
      observaciones: registro.observaciones,
      modificado: ""
    }));
    return { alumnos, indice, lectura };
  }

  async function cargar() {
    const conector = api();
    if (!conector) throw new Error("No hay conexión con la base del mapa.");
    const payload = await conector.get("/api/datos");
    if (!payload || !payload.datos || !Array.isArray(payload.datos.features)) {
      throw new Error("La base del mapa devolvió datos incompletos.");
    }
    revision = Number(payload.revision) || 0;
    const leido = leerBase(payload);
    base = leido.indice;
    baseLista = true;
    pendiente = false;
    ultimaLista = new Set(leido.alumnos.filter(alumno => alumno.personaId)
      .map(alumno => alumno.personaId));
    return {
      anio: Number(payload.anio) || leido.lectura.anio || null,
      generado: leido.lectura.generado || "",
      fuente: leido.lectura.fuente || "Mapa integrado EP 39",
      alumnos: leido.alumnos
    };
  }

  function iguales(alumno, original) {
    if (String(alumno.grado) !== String(original.grado)) return false;
    if (String(alumno.division || "").toUpperCase() !==
        String(original.division || "").toUpperCase()) return false;
    return CAMPOS.every(campo => String(alumno[campo] || "") === String(original[campo] || ""));
  }

  function camposDe(alumno, original) {
    const crudo = original && original.raw ? original.raw : {};
    const sinCambios = campo => original &&
      String(alumno[campo] || "") === String(original[campo] || "");
    const conservar = (campo, crudoCampo) => sinCambios(campo) && crudo[crudoCampo] !== undefined
      ? String(crudo[crudoCampo] || "") : null;
    const elegir = (campo, crudoCampo, propio) => {
      const guardado = conservar(campo, crudoCampo);
      return guardado === null ? String(propio || "") : guardado;
    };
    return {
      nombre_persona: elegir("nombre", "nombre_persona", alumno.nombre),
      numero_alumno: String(crudo.numero_alumno || ""),
      dni: String(alumno.dni || "").replace(/\D/g, ""),
      fecha_nacimiento: conservar("nacimiento", "fecha_nacimiento") === null
        ? fechaMapa(alumno.nacimiento) : conservar("nacimiento", "fecha_nacimiento"),
      direccion_texto: elegir("direccion", "direccion_texto", alumno.direccion),
      referente_familiar: elegir("responsable", "referente_familiar", alumno.responsable),
      responsable_nacionalidad: elegir("nacionalidad", "responsable_nacionalidad", alumno.nacionalidad),
      responsable_actividad: elegir("actividad", "responsable_actividad", alumno.actividad),
      telefono_contacto_familia: elegir("telefono", "telefono_contacto_familia", alumno.telefono),
      observaciones: elegir("observaciones", "observaciones", alumno.observaciones)
    };
  }

  function registroDe(alumno, enviado) {
    return {
      id: alumno.id,
      personaId: alumno.personaId || "",
      nombre: alumno.nombre,
      dni: alumno.dni || "",
      nacimiento: alumno.nacimiento || "",
      grado: alumno.grado,
      division: alumno.division,
      direccion: alumno.direccion || "",
      telefono: alumno.telefono || "",
      responsable: alumno.responsable || "",
      nacionalidad: alumno.nacionalidad || "",
      actividad: alumno.actividad || "",
      observaciones: alumno.observaciones || "",
      raw: enviado || {}
    };
  }

  async function guardarRemoto(alumno, original) {
    const conector = api();
    const campos = camposDe(alumno, original);
    const resultado = await conector.post("/api/guardar", {
      revision,
      id: original ? alumno.personaId : null,
      grado: String(alumno.grado) + "-" + String(alumno.division).toUpperCase(),
      campos
    });
    revision = Number(resultado.revision) || revision;
    alumno.personaId = String(resultado.id || alumno.personaId || "");
    return campos;
  }

  async function eliminarRemoto(personaId) {
    const resultado = await api().post("/api/eliminar", { revision, id: personaId });
    revision = Number(resultado.revision) || revision;
  }

  async function sincronizarAhora(alumnos) {
    if (!api()) return { error: "No hay conexión con la base del mapa." };
    if (!baseLista) return { error: "Todavía no se leyó la base del mapa." };
    if (!Array.isArray(alumnos)) return { error: "No se recibió la lista del padrón." };
    const lista = alumnos.filter(alumno => alumno && String(alumno.nombre || "").trim());
    const porDni = new Map();
    const porNombre = new Map();
    base.forEach((registro, personaId) => {
      if (registro.dni && !porDni.has(registro.dni)) porDni.set(registro.dni, personaId);
      const clave = claveNombre(registro);
      if (!porNombre.has(clave)) porNombre.set(clave, personaId);
    });
    const usados = new Set();
    const presentes = new Set();
    let creados = 0;
    let actualizados = 0;
    let eliminados = 0;
    try {
      for (const alumno of lista) {
        let personaId = String(alumno.personaId || "");
        if (!personaId || !base.has(personaId) || usados.has(personaId)) {
          const porDocumento = alumno.dni ? porDni.get(String(alumno.dni).replace(/\D/g, "")) : "";
          personaId = porDocumento && !usados.has(porDocumento) ? porDocumento : "";
          if (!personaId) {
            const porNombreCurso = porNombre.get(claveNombre(alumno)) || "";
            personaId = porNombreCurso && !usados.has(porNombreCurso) ? porNombreCurso : "";
          }
        }
        if (personaId && base.has(personaId)) {
          usados.add(personaId);
          presentes.add(personaId);
          alumno.personaId = personaId;
          const original = base.get(personaId);
          if (!iguales(alumno, original)) {
            const enviado = await guardarRemoto(alumno, original);
            base.set(personaId, registroDe(alumno, enviado));
            actualizados += 1;
          }
        } else {
          const enviado = await guardarRemoto(alumno, null);
          creados += 1;
          if (alumno.personaId) {
            base.set(alumno.personaId, registroDe(alumno, enviado));
            presentes.add(alumno.personaId);
          }
        }
      }
      for (const personaId of Array.from(ultimaLista)) {
        if (presentes.has(personaId) || !base.has(personaId)) continue;
        await eliminarRemoto(personaId);
        base.delete(personaId);
        eliminados += 1;
      }
      ultimaLista = new Set(presentes);
      pendiente = false;
      return { creados, actualizados, eliminados };
    } catch (error) {
      pendiente = true;
      return { error: error.message, creados, actualizados, eliminados };
    }
  }

  function sincronizar(alumnos) {
    const tarea = cola.then(() => sincronizarAhora(alumnos));
    cola = tarea.catch(() => {});
    return tarea;
  }

  async function refrescar(alumnos) {
    await cola.catch(() => {});
    if (baseLista && pendiente) {
      if (!Array.isArray(alumnos)) return null;
      await sincronizar(alumnos);
      if (pendiente) return null;
    }
    const lectura = await cargar();
    if (lectura && alRecibir) alRecibir(lectura);
    return lectura;
  }

  window.IntegracionPadron = { disponible, lista, pendienteDeGuardar, conectar, cargar, sincronizar, refrescar };
})();
