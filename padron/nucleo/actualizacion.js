"use strict";
// Lectura del archivo de actualización que exporta la app del mapa.
// Convierte las fichas GeoJSON al formato del padrón, repara textos con
// codificación rota y arma la lista final sin tocar el guardado.
(function() {
  const T = window.TextoPadron;
  const CAMPOS_TEXTO = ["nombre", "dni", "nacimiento", "direccion", "telefono",
    "responsable", "nacionalidad", "actividad", "observaciones"];
  const MARCAS_ROTAS = ["Ã", "Â", "â€"];
  const CP1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F
  };

  function bytesDe(texto, cp1252) {
    const bytes = new Uint8Array(texto.length);
    for (let posicion = 0; posicion < texto.length; posicion++) {
      const codigo = texto.charCodeAt(posicion);
      if (codigo < 0x100) {
        bytes[posicion] = codigo;
      } else if (cp1252 && CP1252[codigo] !== undefined) {
        bytes[posicion] = CP1252[codigo];
      } else {
        return null;
      }
    }
    return bytes;
  }

  function repararTexto(valor) {
    const texto = T.limpiarEspacios(valor);
    if (!texto || !MARCAS_ROTAS.some(marca => texto.includes(marca))) return texto;
    for (const cp1252 of [true, false]) {
      const bytes = bytesDe(texto, cp1252);
      if (!bytes) continue;
      try {
        const reparado = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return T.limpiarEspacios(reparado);
      } catch (error) {
        // El texto no era UTF-8 guardado como cp1252; se prueba la otra variante.
      }
    }
    return texto;
  }

  function cabecera(texto) {
    return T.normalizar(texto).replace(/[^a-z0-9]/g, "");
  }

  function datoOrigen(props, preferencias) {
    const fuentes = [];
    const origen = Array.isArray(props.datos_excel_origen) ? props.datos_excel_origen : [];
    origen.forEach(columna => {
      if (columna) fuentes.push([columna.encabezado, columna.valor]);
    });
    Object.keys(props.excel_maestro || {}).forEach(encabezado => {
      fuentes.push([encabezado, props.excel_maestro[encabezado]]);
    });
    for (const preferencia of preferencias) {
      for (const [encabezado, valor] of fuentes) {
        if (cabecera(encabezado) !== preferencia) continue;
        const texto = T.limpiarEspacios(valor);
        if (texto) return texto;
      }
    }
    return "";
  }

  function identificador(valor, indice, usados) {
    let id = repararTexto(valor).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id) id = "S-" + String(indice).padStart(4, "0");
    if (usados.has(id)) id = "S-" + String(indice).padStart(4, "0");
    while (usados.has(id)) id += "-" + indice;
    usados.add(id);
    return id;
  }

  function nombreFuente(generado) {
    const partes = String(generado || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return partes
      ? "Actualización de la app del mapa del " + partes[3] + "/" + partes[2] + "/" + partes[1] +
        " " + partes[4] + ":" + partes[5]
      : "Actualización de la app del mapa";
  }

  function leer(contenido) {
    let raiz;
    try {
      raiz = JSON.parse(contenido);
    } catch (error) {
      throw new Error("El archivo no es un JSON válido.");
    }
    const candidatas = [raiz, raiz && raiz.datos];
    const coleccion = candidatas.find(item => item && Array.isArray(item.features));
    if (!coleccion) {
      throw new Error("El archivo no es una actualización de la app del mapa.");
    }

    const registros = [];
    const usados = new Set();
    const resumen = {
      alumnos: 0, cursos: 0, conDni: 0, conNacimiento: 0,
      conDireccion: 0, conTelefono: 0, conResponsable: 0,
      sinNombre: 0, sinCurso: 0, otrosRoles: 0
    };

    coleccion.features.forEach((feature, posicion) => {
      const props = (feature && feature.properties) || {};
      const rol = String(props.rol || "").trim().toLowerCase();
      if ((rol && rol !== "alumno") || (!rol && props.es_alumno_central !== true)) {
        if (rol !== "alumno") resumen.otrosRoles++;
        return;
      }
      const nombre = T.normalizarNombre(repararTexto(props.nombre_persona));
      if (!nombre) {
        resumen.sinNombre++;
        return;
      }
      const grado = String(props.curso || "").trim();
      const division = String(props.division || "").trim().toUpperCase();
      if (!/^[1-6]$/.test(grado) || !/^[A-D]$/.test(division)) {
        resumen.sinCurso++;
        return;
      }

      const direccion = repararTexto(props.direccion_texto) ||
        datoOrigen(props, ["direccion", "domicilio"]);
      const fecha = props.fecha_nacimiento ||
        datoOrigen(props, ["fechadenacimiento", "fechanac", "fecha"]);
      const documento = props.dni || props.alumno_cuil ||
        datoOrigen(props, ["dni", "documento", "dnicuil"]);
      const responsable = repararTexto(props.responsable_nombre_completo) ||
        datoOrigen(props, ["nombrederesponsablepadreomadre", "apellidoynombresdelpadremadre",
          "apellidoynombresdelpadretutor", "tutorpadremadre", "tutor", "responsable"]);
      const nacionalidad = repararTexto(props.responsable_nacionalidad) ||
        datoOrigen(props, ["nacionalidad"]);
      const actividad = repararTexto(props.responsable_actividad) ||
        datoOrigen(props, ["actividadlaboral", "actividad", "ocupacion"]);
      const telefono = T.normalizarTelefono(props.telefono_contacto_familia) ||
        T.normalizarTelefono(datoOrigen(props, ["telefono", "celular"]));
      const observaciones = repararTexto(props.observaciones) ||
        datoOrigen(props, ["observaciones"]);

      const registro = {
        id: identificador(props.persona_id, posicion + 1, usados),
        personaId: T.limpiarEspacios(props.persona_id),
        nombre,
        dni: T.normalizarDni(documento),
        nacimiento: T.normalizarFecha(fecha),
        grado,
        division,
        direccion: T.normalizarDireccion(repararTexto(direccion)),
        telefono,
        responsable: T.normalizarNombre(repararTexto(responsable)),
        nacionalidad,
        actividad,
        observaciones
      };
      registros.push(registro);
    });

    resumen.alumnos = registros.length;
    resumen.cursos = new Set(registros.map(registro => registro.grado + registro.division)).size;
    registros.forEach(registro => {
      if (registro.dni) resumen.conDni++;
      if (registro.nacimiento) resumen.conNacimiento++;
      if (registro.direccion) resumen.conDireccion++;
      if (registro.telefono) resumen.conTelefono++;
      if (registro.responsable) resumen.conResponsable++;
    });

    const generado = String(raiz.generado || "");
    const anio = Number(raiz.anio) || null;
    return {
      anio,
      generado,
      fuente: nombreFuente(generado),
      registros,
      resumen
    };
  }

  function claveNombre(registro) {
    return T.normalizar(registro.nombre) + "|" + String(registro.grado) +
      String(registro.division).toUpperCase();
  }

  function nuevoId() {
    if (window.AlmacenPadron && typeof window.AlmacenPadron.nuevoId === "function") {
      return window.AlmacenPadron.nuevoId();
    }
    return "ALU-" + Date.now().toString(36).toUpperCase() + "-" +
      Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  function preparar(actuales, lectura, modo) {
    const registros = lectura && Array.isArray(lectura.registros) ? lectura.registros : [];
    if (!registros.length) throw new Error("El archivo no tiene alumnos para cargar.");
    const ahora = new Date().toISOString();

    if (modo === "reemplazar") {
      const usados = new Set();
      const alumnos = registros.map(registro => {
        let id = registro.id;
        while (usados.has(id)) id = nuevoId();
        usados.add(id);
        return Object.assign({}, registro, { id, modificado: ahora });
      });
      return {
        alumnos,
        agregados: alumnos.length,
        actualizados: 0,
        sinCambios: 0,
        conservados: 0,
        quitados: actuales.length
      };
    }

    const trabajo = actuales.map(alumno => Object.assign({}, alumno));
    const porId = new Map();
    const porDni = new Map();
    const porNombre = new Map();
    trabajo.forEach(alumno => {
      porId.set(alumno.id, alumno);
      if (alumno.dni && !porDni.has(alumno.dni)) porDni.set(alumno.dni, alumno);
      const clave = claveNombre(alumno);
      if (!porNombre.has(clave)) porNombre.set(clave, alumno);
    });

    const usados = new Set();
    let agregados = 0;
    let actualizados = 0;
    let sinCambios = 0;

    registros.forEach(registro => {
      let encontrado = porId.get(registro.id) ||
        (registro.dni ? porDni.get(registro.dni) : null) ||
        porNombre.get(claveNombre(registro)) || null;
      if (encontrado && usados.has(encontrado.id)) encontrado = null;

      if (encontrado) {
        usados.add(encontrado.id);
        const copia = Object.assign({}, encontrado);
        let cambio = false;
        CAMPOS_TEXTO.forEach(clave => {
          if (registro[clave] && registro[clave] !== copia[clave]) {
            copia[clave] = registro[clave];
            cambio = true;
          }
        });
        if (copia.grado !== registro.grado || copia.division !== registro.division) {
          copia.grado = registro.grado;
          copia.division = registro.division;
          cambio = true;
        }
        if (cambio) {
          copia.modificado = ahora;
          actualizados++;
        } else {
          sinCambios++;
        }
        trabajo[trabajo.indexOf(encontrado)] = copia;
        return;
      }

      let id = registro.id;
      while (porId.has(id) || trabajo.some(alumno => alumno.id === id)) id = nuevoId();
      const nuevo = Object.assign({}, registro, { id, modificado: ahora });
      trabajo.push(nuevo);
      porId.set(id, nuevo);
      if (nuevo.dni && !porDni.has(nuevo.dni)) porDni.set(nuevo.dni, nuevo);
      const clave = claveNombre(nuevo);
      if (!porNombre.has(clave)) porNombre.set(clave, nuevo);
      agregados++;
    });

    const conservados = trabajo.length - agregados - usados.size;
    return { alumnos: trabajo, agregados, actualizados, sinCambios, conservados, quitados: 0 };
  }

  window.ActualizacionPadron = { leer, preparar, repararTexto };
})();
