"use strict";
// Los mismos endpoints del servidor de PC, pero ejecutados dentro del
// navegador/telefono. No usa red: recibe el almacenamiento, el buscador de
// calles y el lector de Excel ya conectados.
(function(root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./alumnos.js"));
  } else {
    root.BackendApp = factory(root.Alumnos);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function(Alumnos) {
  const EDITABLE = ["nombre_persona", "numero_alumno", "dni", "fecha_nacimiento", "direccion_texto",
    "referente_familiar", "responsable_nacionalidad", "responsable_actividad",
    "telefono_contacto_familia", "observaciones"];
  const PERMANENCIA = "permanencia";
  const CAMPOS_EXPORTACION = [["Alumno", "nombre_persona"], ["Número de alumno", "numero_alumno"],
    ["DNI", "dni"], ["Fecha de nacimiento", "fecha_nacimiento"], ["Curso", "curso"],
    ["División", "division"], ["Domicilio", "direccion_texto"], ["Responsable", "referente_familiar"],
    ["Nacionalidad responsable", "responsable_nacionalidad"],
    ["Actividad responsable", "responsable_actividad"], ["Teléfono", "telefono_contacto_familia"],
    ["Observaciones", "observaciones"]];

  function nuevoId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function validarCoordenadas(coords) {
    if (!Array.isArray(coords) || coords.length !== 2 ||
        coords.some(value => typeof value === "boolean" || typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error("Las coordenadas no son válidas.");
    }
    if (!(-180 <= coords[0] && coords[0] <= 180 && -90 <= coords[1] && coords[1] <= 90)) {
      throw new Error("Las coordenadas están fuera de rango.");
    }
  }

  function resumirDatos(datos) {
    let alumnos = 0, ubicados = 0;
    for (const feature of datos.features) {
      if (!Alumnos.student(feature)) continue;
      alumnos += 1;
      if (Alumnos.located(feature)) ubicados += 1;
    }
    return { alumnos, ubicados, pendientes: alumnos - ubicados };
  }

  const anioDelDia = () => new Date().getFullYear();

  function etiquetaGrado(feature) {
    const props = (feature && feature.properties) || {};
    const course = String(props.curso || "").trim();
    const division = String(props.division || "").trim().toUpperCase();
    return course + "°" + (division ? " " + division : "");
  }

  const GRADO_SALIDA = /^[1-6]-[A-D]$/;
  const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function listaSalidas(datos) {
    return datos && Array.isArray(datos.salidas) ? datos.salidas : [];
  }

  function normalizarSalida(entrada, anio) {
    const nombre = String((entrada && entrada.nombre) || "").trim().slice(0, 120);
    if (!nombre) throw new Error("Poné un nombre a la salida.");
    const grados = [], vistosGrados = new Set();
    for (const valor of Array.isArray(entrada.grados) ? entrada.grados : []) {
      const grado = String(valor || "").toUpperCase();
      if (GRADO_SALIDA.test(grado) && !vistosGrados.has(grado)) {
        vistosGrados.add(grado);
        grados.push(grado);
      }
    }
    const alumnos = [], vistos = new Set();
    const fuente = Array.isArray(entrada.alumnos) ? entrada.alumnos : [];
    for (const item of fuente.slice(0, 2000)) {
      const identifier = String((item && item.persona_id) || "");
      if (!identifier || vistos.has(identifier)) continue;
      vistos.add(identifier);
      alumnos.push({
        persona_id: identifier,
        nombre: String((item && item.nombre) || "").slice(0, 120),
        numero: String((item && item.numero) || "").slice(0, 30),
        grado: String((item && item.grado) || "").slice(0, 30),
        dni: String((item && item.dni) || "").slice(0, 30)
      });
    }
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String((entrada && entrada.fecha) || ""))
      ? String(entrada.fecha) : "";
    const ahora = new Date().toISOString();
    return {
      id: String((entrada && entrada.id) || nuevoId()),
      nombre,
      fecha,
      notas: String((entrada && entrada.notas) || "").slice(0, 1000),
      grados,
      alumnos,
      anio: Number((entrada && entrada.anio)) || Number(anio) || 0,
      creada: String((entrada && entrada.creada) || ahora),
      modificada: ahora
    };
  }

  function fusionarSalidas(anteriores, nuevas) {
    const porId = new Map();
    for (const salida of anteriores) if (salida && salida.id) porId.set(salida.id, salida);
    for (const salida of nuevas) {
      if (!salida || !salida.id) continue;
      const previa = porId.get(salida.id);
      if (!previa || String(salida.modificada || "") >= String(previa.modificada || "")) {
        porId.set(salida.id, salida);
      }
    }
    return Array.from(porId.values());
  }

  function nombreArchivoSalida(nombre, sufijo) {
    const limpio = String(nombre || "salida").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);
    return "salida-" + (limpio || "salida") + (sufijo || "") + ".xlsx";
  }

  function normalizarFeatures(features) {
    const limpias = [], identificadores = new Set();
    for (const feature of features) {
      if (!feature || typeof feature !== "object" || Array.isArray(feature) ||
          !feature.properties || typeof feature.properties !== "object" ||
          Array.isArray(feature.properties)) {
        throw new Error("El archivo contiene un alumno con formato inválido.");
      }
      let geometry = feature.geometry == null ? null : feature.geometry;
      if (geometry !== null) {
        if (geometry.type !== "Point") {
          throw new Error("El archivo contiene una ubicación con formato inválido.");
        }
        validarCoordenadas(geometry.coordinates);
        geometry = { type: "Point", coordinates: [geometry.coordinates[0], geometry.coordinates[1]] };
      }
      const copia = { ...feature, properties: { ...feature.properties }, geometry };
      if (Alumnos.student(copia)) {
        let identificador = String(copia.properties.persona_id || "");
        if (!identificador || identificadores.has(identificador)) {
          identificador = "P-" + nuevoId();
          copia.properties.persona_id = identificador;
        }
        identificadores.add(identificador);
      }
      limpias.push(copia);
    }
    return limpias;
  }

  function fusionarProps(existente, entrante) {
    const props = { ...(existente.properties || {}) };
    for (const [clave, valor] of Object.entries(entrante.properties || {})) {
      if (valor === null || valor === undefined) continue;
      if (typeof valor === "string" && valor.trim() === "") continue;
      props[clave] = valor;
    }
    return props;
  }

  function fusionarFeature(existente, entrante) {
    let geometry = existente.geometry || entrante.geometry || null;
    if (existente.geometry && !entrante.geometry) geometry = existente.geometry;
    else if (entrante.geometry) geometry = entrante.geometry;
    return { ...existente, ...entrante, type: "Feature",
      properties: fusionarProps(existente, entrante), geometry };
  }

  function fusionarActivos(actuales, entrantes, anioActual, anioArchivo) {
    const mismoAnio = anioArchivo === null || anioArchivo === undefined ||
      !anioActual || anioArchivo === anioActual;
    if (!mismoAnio) return { features: actuales, agregados: 0, actualizados: 0 };
    const indice = new Map(), orden = [];
    actuales.forEach((feature, posicion) => {
      const identificador = String((feature.properties || {}).persona_id || "");
      const clave = identificador || ("__indice__" + posicion);
      indice.set(clave, feature);
      orden.push(clave);
    });
    let agregados = 0, actualizados = 0;
    for (const entrante of entrantes) {
      const identificador = String((entrante.properties || {}).persona_id || "");
      if (identificador && indice.has(identificador)) {
        indice.set(identificador, fusionarFeature(indice.get(identificador), entrante));
        actualizados += 1;
      } else {
        const clave = identificador || ("__nueva__" + nuevoId());
        indice.set(clave, entrante);
        orden.push(clave);
        agregados += 1;
      }
    }
    return { features: orden.map(clave => indice.get(clave)), agregados, actualizados };
  }

  function registroDeFeature(feature, anio, momento) {
    const props = feature.properties || {};
    const geometry = feature.geometry || {}, coords = geometry.coordinates;
    const ubicado = geometry.type === "Point" && Array.isArray(coords) && coords.length === 2;
    return { anio, persona_id: String(props.persona_id || ""),
      nombre: String(props.nombre_persona || ""), grado: etiquetaGrado(feature),
      dni: String(props.dni || ""), direccion: String(props.direccion_texto || ""),
      telefono: String(props.telefono_contacto_familia || ""), ubicado,
      contenido: feature, promovido_en: momento };
  }

  function fusionarMemoria(actuales, items) {
    const registros = (actuales || []).slice(), indice = new Map();
    registros.forEach((registro, posicion) => {
      indice.set(registro.anio + "|" + registro.persona_id, posicion);
    });
    const momento = new Date().toISOString();
    let agregados = 0, actualizados = 0;
    for (const item of items) {
      for (const feature of item.features) {
        const identificador = String((feature.properties || {}).persona_id || "");
        const clave = item.anio + "|" + identificador;
        if (identificador && indice.has(clave)) {
          const posicion = indice.get(clave), previo = registros[posicion];
          const contenido = previo && previo.contenido
            ? fusionarFeature(previo.contenido, feature) : feature;
          registros[posicion] = registroDeFeature(contenido, item.anio, momento);
          actualizados += 1;
        } else {
          registros.push(registroDeFeature(feature, item.anio, momento));
          if (identificador) indice.set(clave, registros.length - 1);
          agregados += 1;
        }
      }
    }
    return { registros, agregados, actualizados };
  }

  function exportarMemoria(registros) {
    const grupos = new Map();
    for (const registro of registros || []) {
      if (!registro || !Number.isInteger(registro.anio)) continue;
      const contenido = registro.contenido;
      if (!contenido || contenido.type !== "Feature") continue;
      if (!grupos.has(registro.anio)) grupos.set(registro.anio, []);
      grupos.get(registro.anio).push(contenido);
    }
    return [...grupos.entries()].sort((uno, otro) => uno[0] - otro[0])
      .map(([anio, features]) => ({ anio, datos: { type: "FeatureCollection", features } }));
  }

  function prepararActualizacion(texto, anioActual, fusionar) {
    if (typeof texto !== "string" || !texto.trim()) {
      throw new Error("El archivo de actualización está vacío.");
    }
    if (texto.length > 80 * 1024 * 1024) {
      throw new Error("El archivo de actualización es demasiado grande.");
    }
    let contenido;
    try {
      contenido = JSON.parse(texto);
    } catch {
      throw new Error("El archivo de actualización no es un JSON válido.");
    }
    let anioPaquete = null;
    if (contenido && contenido.anio !== undefined) {
      anioPaquete = contenido.anio;
      if (typeof anioPaquete === "boolean" || !Number.isInteger(anioPaquete)) {
        throw new Error("El archivo de actualización tiene un año lectivo inválido.");
      }
      if (!fusionar && anioActual !== undefined && anioPaquete !== anioActual) {
        throw new Error("El archivo de actualización pertenece al año " + anioPaquete +
          " y el año en curso es " + anioActual + ". No se cargó para no mezclar datos.");
      }
    }
    const datos = contenido && contenido.formato === "actualizacion-datos" ? contenido.datos : contenido;
    if (!datos || datos.type !== "FeatureCollection" || !Array.isArray(datos.features)) {
      throw new Error("El archivo no tiene una colección de alumnos válida.");
    }
    const features = normalizarFeatures(datos.features);
    const preparados = { ...datos, features };
    const resumen = resumirDatos(preparados);
    if (!fusionar && !resumen.alumnos) throw new Error("El archivo de actualización no contiene alumnos.");
    const memoria = [];
    let memoriaPresente = false, memoriaAlumnos = 0;
    if (contenido && Array.isArray(contenido.memoria)) {
      memoriaPresente = true;
      for (const item of contenido.memoria) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const anioItem = item.anio;
        if (typeof anioItem === "boolean" || !Number.isInteger(anioItem)) continue;
        const datosItem = item.datos;
        if (!datosItem || datosItem.type !== "FeatureCollection" || !Array.isArray(datosItem.features)) continue;
        const limpias = normalizarFeatures(datosItem.features);
        memoriaAlumnos += limpias.filter(feature => Alumnos.student(feature)).length;
        memoria.push({ anio: anioItem, features: limpias });
      }
    }
    return { datos: preparados, resumen,
      generado: contenido && typeof contenido.generado === "string" ? contenido.generado : "",
      anio: anioPaquete, memoria, memoriaPresente, memoriaAlumnos };
  }

  function crearBackend(opciones) {
    const almacen = opciones.almacen;
    const datosCalles = opciones.datosCalles;
    const buscarCalles = opciones.buscarCalles;
    const excel = opciones.excel;
    let indiceCalles = null;

    async function cargarEstado() {
      const estado = await almacen.cargar();
      if (estado && estado.datos && Array.isArray(estado.datos.features)) {
        for (const feature of estado.datos.features) {
          const props = feature.properties || {};
          if (props.nombre_persona) props.nombre_persona = Alumnos.upperName(props.nombre_persona);
        }
        estado.datos.features.sort(Alumnos.compareBySurname);
      }
      return estado;
    }

    function aniosMemoria(memoria) {
      const grupos = new Map();
      for (const registro of memoria || []) {
        const grupo = grupos.get(registro.anio) || { anio: registro.anio, alumnos: 0, ubicados: 0 };
        grupo.alumnos += 1;
        if (registro.ubicado) grupo.ubicados += 1;
        grupos.set(registro.anio, grupo);
      }
      return [...grupos.values()].sort((a, b) => b.anio - a.anio);
    }

    function registrosMemoria(memoria, anio) {
      return (memoria || []).filter(registro => registro.anio === anio)
        .slice().sort((a, b) => String(a.grado || "").localeCompare(String(b.grado || ""), "es") ||
          String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"))
        .map(registro => ({ persona_id: registro.persona_id, nombre: registro.nombre,
          grado: registro.grado, dni: registro.dni, direccion: registro.direccion,
          telefono: registro.telefono, ubicado: !!registro.ubicado }));
    }

    async function comprobarRevision(esperada, revision) {
      if (esperada !== revision) {
        throw new Error("La base cambió en otra pestaña. Recargá antes de guardar.");
      }
    }

    async function ubicarAlumnos(features) {
      const pendientes = features.filter(feature => Alumnos.student(feature) && !feature.geometry);
      const matches = pendientes.length
        ? await buscarCalles({ tipo: "lote", domicilios: pendientes.map(feature =>
          String((feature.properties || {}).direccion_texto || "")) })
        : [];
      if (!Array.isArray(matches) || matches.length !== pendientes.length) {
        throw new Error("Respuesta inválida del buscador de calles.");
      }
      let ubicados = 0;
      pendientes.forEach((feature, index) => {
        const match = matches[index] || {}, props = feature.properties;
        if (match.estado === "aproximada") {
          validarCoordenadas(match.coordenadas);
          feature.geometry = { type: "Point", coordinates: match.coordenadas };
          props.coordenadas_pendientes = false;
          props.ubicacion_referencia = match.descripcion;
          ubicados += 1;
        } else if (match.estado === "pendiente") {
          props.coordenadas_pendientes = true;
          props.ubicacion_referencia = "Pendiente: " + match.motivo;
        } else {
          throw new Error("Estado inválido en la búsqueda de calles.");
        }
      });
      return { ubicados, pendientes: pendientes.length - ubicados };
    }

    function indice() {
      if (indiceCalles) return indiceCalles;
      indiceCalles = [];
      for (const road of datosCalles.roads) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const line of road.coordinates) {
          for (const point of line) {
            if (point[0] < minX) minX = point[0];
            if (point[0] > maxX) maxX = point[0];
            if (point[1] < minY) minY = point[1];
            if (point[1] > maxY) maxY = point[1];
          }
        }
        if (Number.isFinite(minX)) indiceCalles.push([minX, minY, maxX, maxY, road]);
      }
      return indiceCalles;
    }

    function calles(payload) {
      const bbox = (payload || {}).bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4 ||
          bbox.some(value => typeof value === "boolean" || typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error("Área del mapa inválida.");
      }
      const [west, south, east, north] = bbox;
      if (!(-180 <= west && west <= east && east <= 180 && -90 <= south && south <= north && north <= 90)) {
        throw new Error("Área del mapa fuera de rango.");
      }
      const features = [];
      for (const [x1, y1, x2, y2, road] of indice()) {
        if (x1 <= east && x2 >= west && y1 <= north && y2 >= south) {
          if (features.length === 5000) break;
          features.push({ type: "Feature", properties: { nombre: road.name },
            geometry: { type: "MultiLineString", coordinates: road.coordinates } });
        }
      }
      return { type: "FeatureCollection", features };
    }

    return {
      async estado() {
        return { aplicacion: "escuela39-simple", instancia: "local" };
      },

      async datos() {
        const estado = await cargarEstado();
        return { revision: estado.revision, anio: estado.anio, anio_egreso: estado.anio_egreso,
          datos: estado.datos };
      },

      async normalizarNombres() {
        const { revision, datos } = await almacen.cargar();
        let cambios = 0;
        for (const feature of datos.features) {
          const props = feature.properties || {};
          const nombre = String(props.nombre_persona || "");
          const mayusculas = Alumnos.upperName(nombre);
          if (nombre && nombre !== mayusculas) {
            props.nombre_persona = mayusculas;
            cambios += 1;
          }
        }
        if (!cambios) return { cambios: 0 };
        const respaldo = await almacen.respaldar();
        const nuevaRevision = await almacen.guardar(revision, datos);
        return { cambios, respaldo, revision: nuevaRevision };
      },

      async mapaBase() {
        return { localidades: datosCalles.localities, municipio: datosCalles.municipality,
          lugares: datosCalles.places };
      },

      async buscar(payload) {
        return buscarCalles(payload);
      },

      async calles(payload) {
        return calles(payload);
      },

      async columnas(payload) {
        return excel.inspeccionar(payload || {});
      },

      async contarAlumnos(payload) {
        return excel.contar(payload || {});
      },

      async guardar(payload) {
        payload = payload || {};
        const props = payload.campos;
        if (!props || typeof props !== "object" || Array.isArray(props) ||
            Object.keys(props).some(key => key !== PERMANENCIA && !EDITABLE.includes(key)) ||
            (props[PERMANENCIA] !== undefined && typeof props[PERMANENCIA] !== "boolean") ||
            !String(props.nombre_persona || "").trim()) {
          throw new Error("Completá el nombre del alumno y verificá los campos.");
        }
        const [course, division] = Alumnos.parseGrade(payload.grado);
        const { revision, datos } = await cargarEstado();
        await comprobarRevision(payload.revision, revision);
        const identifier = payload.id;
        const matches = datos.features.filter(feature => Alumnos.student(feature) &&
          (feature.properties || {}).persona_id === identifier);
        if (identifier && matches.length !== 1) {
          throw new Error("No se encontró el alumno o su identificador está repetido.");
        }
        const dni = String(props.dni || "").replace(/\D/g, "");
        const unchangedDni = matches.length === 1 && dni === Alumnos.studentDni(matches[0]);
        if (dni && !unchangedDni && datos.features.some(feature =>
          Alumnos.student(feature) && feature !== (matches[0] || null) && Alumnos.studentDni(feature) === dni)) {
          throw new Error("Ya existe otro alumno con ese DNI.");
        }
        let feature;
        if (matches.length) feature = matches[0];
        else {
          const family = "F-" + nuevoId();
          feature = { type: "Feature", geometry: null, properties: {
            familia_id: family, persona_id: family + "-ALUMNO", rol: "alumno", es_alumno_central: true } };
          datos.features.push(feature);
        }
        const originalAddress = feature.properties.direccion_texto || "";
        for (const key of EDITABLE) feature.properties[key] = String(props[key] || "").trim();
        feature.properties.nombre_persona = Alumnos.upperName(feature.properties.nombre_persona);
        feature.properties.responsable_nombre_completo = feature.properties.referente_familiar;
        feature.properties.dni = dni;
        feature.properties.alumno_cuil = dni;
        feature.properties.alumno_cuil_referencia = dni;
        feature.properties.curso = course;
        feature.properties.division = division;
        if (typeof props[PERMANENCIA] === "boolean") {
          feature.properties[PERMANENCIA] = props[PERMANENCIA];
        }
        const coords = payload.coordenadas === undefined ? null : payload.coordenadas;
        if (coords !== null) {
          validarCoordenadas(coords);
          feature.geometry = { type: "Point", coordinates: coords };
          feature.properties.coordenadas_pendientes = false;
          const reference = payload.referencia === undefined ? "" : payload.referencia;
          if (typeof reference !== "string" || reference.length > 300) {
            throw new Error("Referencia de ubicación inválida.");
          }
          feature.properties.ubicacion_referencia = reference || "Ubicación elegida manualmente";
        } else if (originalAddress !== feature.properties.direccion_texto) {
          feature.geometry = null;
          feature.properties.coordenadas_pendientes = true;
          feature.properties.ubicacion_referencia = "Pendiente: domicilio modificado";
        }
        const nuevaRevision = await almacen.guardar(revision, datos);
        return { id: feature.properties.persona_id, revision: nuevaRevision };
      },

      async ubicacion(payload) {
        payload = payload || {};
        const identifier = payload.id;
        const { revision, datos } = await cargarEstado();
        await comprobarRevision(payload.revision, revision);
        const matches = datos.features.filter(feature => Alumnos.student(feature) &&
          (feature.properties || {}).persona_id === identifier);
        if (!identifier || matches.length !== 1) {
          throw new Error("No se encontró el alumno o su identificador está repetido.");
        }
        validarCoordenadas(payload.coordenadas);
        const feature = matches[0];
        feature.geometry = { type: "Point", coordinates: payload.coordenadas };
        feature.properties.coordenadas_pendientes = false;
        feature.properties.ubicacion_referencia = "Ubicación elegida manualmente";
        const nuevaRevision = await almacen.guardar(revision, datos);
        return { id: identifier, revision: nuevaRevision };
      },

      async ubicar(payload) {
        payload = payload || {};
        const [course, division] = Alumnos.parseGrade(payload.grado);
        const { revision, datos } = await cargarEstado();
        await comprobarRevision(payload.revision, revision);
        const features = datos.features.filter(feature => Alumnos.student(feature) &&
          String((feature.properties || {}).curso) === course &&
          String((feature.properties || {}).division || "").toUpperCase() === division);
        if (!features.length) throw new Error("No hay alumnos en el grado seleccionado.");
        const counts = await ubicarAlumnos(features);
        const respaldo = await almacen.respaldar();
        const nuevaRevision = await almacen.guardar(revision, datos);
        return { ...counts, respaldo, revision: nuevaRevision };
      },

      async importar(payload) {
        payload = payload || {};
        const grade = payload.grado;
        const { revision, datos, anio } = await cargarEstado();
        await comprobarRevision(payload.revision, revision);
        const importadas = excel.leer(payload, anio);
        for (const feature of importadas) {
          const props = feature.properties || {};
          if (props.nombre_persona) props.nombre_persona = Alumnos.upperName(props.nombre_persona);
        }
        const conservar = payload.conservar_ubicados === undefined ? true : payload.conservar_ubicados;
        if (typeof conservar !== "boolean") {
          throw new Error("La opción de conservar ubicaciones no es válida.");
        }
        let added, stats;
        if (conservar) {
          const merged = Alumnos.mergeGrade(datos, importadas, grade);
          datos.features = merged.geojson.features;
          added = merged.added;
          stats = merged.stats;
        } else {
          const replaced = Alumnos.replaceGrade(datos, importadas, grade);
          datos.features = replaced.geojson.features;
          added = importadas;
          stats = { conservados: 0, agregados: importadas.length,
            reemplazados: replaced.removed, domicilios_distintos: 0 };
        }
        const counts = await ubicarAlumnos(added);
        const respaldo = await almacen.respaldar();
        const filas = Alumnos.duplicateImportRows(datos, importadas);
        const nuevaRevision = await almacen.guardar(revision, datos);
        return { ...counts, importados: importadas.length, agregados: stats.agregados,
          conservados: stats.conservados, reemplazados: stats.reemplazados,
          domicilios_distintos: stats.domicilios_distintos, respaldo,
          filas_dni_duplicado: filas, revision: nuevaRevision };
      },

      async anioLectivo(payload) {
        payload = payload || {};
        const nuevo = payload.anio;
        if (typeof nuevo !== "number" || !Number.isInteger(nuevo) || nuevo < 2000 || nuevo > 2100) {
          throw new Error("El año lectivo debe ser un número entre 2000 y 2100.");
        }
        const estado = await cargarEstado();
        await comprobarRevision(payload.revision, estado.revision);
        const actual = estado.anio, egreso = estado.anio_egreso;
        if (nuevo > egreso + 1) {
          throw new Error("Primero promocioná los grupos del año " + egreso + ".");
        }
        if (nuevo === actual) {
          return { anio: actual, anio_egreso: egreso, revision: estado.revision, respaldo: "" };
        }
        const respaldo = await almacen.respaldar();
        const nuevoEgreso = nuevo >= egreso ? egreso : nuevo;
        const revision = await almacen.guardar(estado.revision, estado.datos,
          { anio: nuevo, anio_egreso: nuevoEgreso });
        return { anio: nuevo, anio_egreso: nuevoEgreso, revision, respaldo };
      },

      async promocion(payload) {
        payload = payload || {};
        const estado = await cargarEstado();
        await comprobarRevision(payload.revision, estado.revision);
        const activos = [], egresados = [];
        const cierre = estado.datos.features.filter(feature => Alumnos.student(feature))
          .map(feature => JSON.parse(JSON.stringify(feature)));
        let promovidos = 0, permanecen = 0, sinGrado = 0;
        for (const feature of estado.datos.features) {
          if (!Alumnos.student(feature)) { activos.push(feature); continue; }
          const props = feature.properties || {};
          if (props.permanencia === true) {
            permanecen += 1;
            activos.push(feature);
            continue;
          }
          const raw = String(props.curso || "").trim();
          const course = /^\d+$/.test(raw) ? Number(raw) : NaN;
          if (course === 6) egresados.push(feature);
          else if (course >= 1 && course <= 5) {
            props.curso = String(course + 1);
            promovidos += 1;
            activos.push(feature);
          } else {
            sinGrado += 1;
            activos.push(feature);
          }
        }
        const alumnos = promovidos + permanecen + egresados.length + sinGrado;
        if (!alumnos) throw new Error("No hay alumnos para promocionar.");
        if (!(promovidos || permanecen || egresados.length)) {
          throw new Error("No hay alumnos con grado válido para promocionar.");
        }
        const anioActual = estado.anio, anioEgreso = estado.anio_egreso;
        const respaldo = await almacen.respaldar();
        const momento = new Date().toISOString();
        const nuevosRegistros = [], vistos = new Set();
        for (const feature of cierre) {
          const registro = registroDeFeature(feature, anioEgreso, momento);
          if (registro.persona_id && vistos.has(registro.persona_id)) continue;
          if (registro.persona_id) vistos.add(registro.persona_id);
          nuevosRegistros.push(registro);
        }
        const clavesCierre = new Set(nuevosRegistros.filter(registro => registro.persona_id)
          .map(registro => registro.anio + "|" + registro.persona_id));
        const memoriaPrevia = (estado.memoria || []).filter(registro =>
          !(registro.anio === anioEgreso && registro.persona_id &&
            clavesCierre.has(registro.anio + "|" + registro.persona_id)));
        const nuevoAnio = Math.max(anioActual, anioEgreso + 1);
        const revision = await almacen.guardar(estado.revision,
          { ...estado.datos, features: activos },
          { anio: nuevoAnio, anio_egreso: nuevoAnio,
            memoria: memoriaPrevia.concat(nuevosRegistros) });
        return { alumnos, promovidos, permanecen, egresados: egresados.length, sin_grado: sinGrado,
          memoria_guardados: nuevosRegistros.length,
          anio_anterior: anioEgreso, anio_nuevo: nuevoAnio, anio_egreso: nuevoAnio,
          respaldo, revision };
      },

      async memoria(anioParam) {
        let anio = null;
        if (anioParam !== undefined && anioParam !== null && anioParam !== "") {
          anio = Number(anioParam);
          if (!Number.isInteger(anio)) throw new Error("El año indicado no es válido.");
        }
        const estado = await cargarEstado();
        const anios = aniosMemoria(estado.memoria);
        if (anio === null && anios.length) anio = anios[0].anio;
        return { anio_actual: estado.anio, anios, anio,
          registros: anio === null ? [] : registrosMemoria(estado.memoria, anio) };
      },

      async trasladar(payload) {
        payload = payload || {};
        const estado = await cargarEstado();
        await comprobarRevision(payload.revision, estado.revision);
        const [course, division] = Alumnos.parseGrade(payload.grado);
        const identifier = payload.id;
        const matches = estado.datos.features.filter(feature => Alumnos.student(feature) &&
          (feature.properties || {}).persona_id === identifier);
        if (!identifier || matches.length !== 1) {
          throw new Error("No se encontró el alumno o su identificador está repetido.");
        }
        const feature = matches[0];
        if (String(feature.properties.curso) === course &&
            String(feature.properties.division || "").toUpperCase() === division) {
          throw new Error("El alumno ya está en ese grado.");
        }
        feature.properties.curso = course;
        feature.properties.division = division;
        const respaldo = await almacen.respaldar();
        const revision = await almacen.guardar(estado.revision, estado.datos);
        return { id: identifier, grado: course + "-" + division, respaldo, revision };
      },

      async eliminar(payload) {
        payload = payload || {};
        const { revision, datos } = await cargarEstado();
        await comprobarRevision(payload.revision, revision);
        const identifier = payload.id;
        const matches = datos.features.filter(feature => Alumnos.student(feature) &&
          (feature.properties || {}).persona_id === identifier);
        if (!identifier || matches.length !== 1) {
          throw new Error("No se encontró el alumno o su identificador está repetido.");
        }
        const respaldo = await almacen.respaldar();
        datos.features = datos.features.filter(feature => feature !== matches[0]);
        const nuevaRevision = await almacen.guardar(revision, datos);
        return { id: identifier, respaldo, revision: nuevaRevision };
      },

      async salidas() {
        const estado = await cargarEstado();
        return { revision: estado.revision,
          salidas: listaSalidas(estado.datos).filter(item => item && item.id) };
      },

      async guardarSalida(payload) {
        payload = payload || {};
        const estado = await cargarEstado();
        await comprobarRevision(payload.revision, estado.revision);
        const lista = listaSalidas(estado.datos).slice();
        const salida = normalizarSalida(payload.salida, estado.anio);
        if (lista.length >= 500 && !lista.some(item => item && item.id === salida.id)) {
          throw new Error("Hay demasiadas salidas guardadas. Eliminá alguna antes de crear otra.");
        }
        const indice = lista.findIndex(item => item && item.id === salida.id);
        if (indice >= 0) lista[indice] = salida;
        else lista.push(salida);
        const datos = { ...estado.datos, salidas: lista };
        const revision = await almacen.guardar(estado.revision, datos);
        return { revision, salida, salidas: lista };
      },

      async eliminarSalida(payload) {
        payload = payload || {};
        const estado = await cargarEstado();
        await comprobarRevision(payload.revision, estado.revision);
        const identifier = String(payload.id || "");
        const lista = listaSalidas(estado.datos).filter(item => item && item.id !== identifier);
        const datos = { ...estado.datos, salidas: lista };
        const revision = await almacen.guardar(estado.revision, datos);
        return { revision, salidas: lista };
      },

      async exportarSalida(payload) {
        payload = payload || {};
        const estado = await cargarEstado();
        const salida = listaSalidas(estado.datos)
          .find(item => item && item.id === String(payload.id || ""));
        if (!salida) throw new Error("No se encontró la salida guardada.");
        const listaSola = payload.tipo === "lista";
        const porId = new Map();
        for (const feature of estado.datos.features) {
          if (Alumnos.student(feature) && feature.properties && feature.properties.persona_id) {
            porId.set(feature.properties.persona_id, feature);
          }
        }
        const filas = (salida.alumnos || []).map(item => {
          const feature = porId.get(item.persona_id);
          const p = (feature && feature.properties) || {};
          return {
            grado: feature ? etiquetaGrado(feature) : String(item.grado || ""),
            nombre: String(p.nombre_persona || item.nombre || ""),
            numero: String(p.numero_alumno || item.numero || ""),
            dni: String(p.dni || item.dni || ""),
            nacimiento: String(p.fecha_nacimiento || ""),
            domicilio: String(p.direccion_texto || ""),
            responsable: String(p.referente_familiar || ""),
            telefono: String(p.telefono_contacto_familia || ""),
            observaciones: String(p.observaciones || "")
          };
        });
        filas.sort((uno, otro) =>
          uno.grado.localeCompare(otro.grado, "es", { numeric: true }) ||
          uno.nombre.localeCompare(otro.nombre, "es", { sensitivity: "base" }));
        const headers = listaSola
          ? ["Grado", "Alumno"]
          : ["N.º de alumno", "Alumno", "Grado", "DNI", "Fecha de nacimiento", "Domicilio",
            "Responsable", "Teléfono", "Observaciones"];
        const titulo = String(salida.nombre || "Salida")
          .replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Salida";
        const hojas = [{
          headers, titulo,
          filas: filas.map(fila => listaSola
            ? [fila.grado, fila.nombre]
            : [fila.numero, fila.nombre, fila.grado, fila.dni, fila.nacimiento,
              fila.domicilio, fila.responsable, fila.telefono, fila.observaciones])
        }];
        const contenido = await excel.escribirLibro(hojas);
        return { nombre: nombreArchivoSalida(salida.nombre, listaSola ? "-lista" : ""),
          tipo: MIME_XLSX, contenido };
      },

      async exportarGeoJSON() {
        const { datos, anio } = await cargarEstado();
        return { nombre: "escuela39-" + anio + ".geojson", contenido: JSON.stringify(datos, null, 2) };
      },

      async exportarActualizacion() {
        const { revision, datos, anio, memoria } = await cargarEstado();
        const fecha = new Date(), pad = valor => String(valor).padStart(2, "0");
        const marca = fecha.getFullYear() + pad(fecha.getMonth() + 1) + pad(fecha.getDate()) + "-" +
          pad(fecha.getHours()) + pad(fecha.getMinutes());
        const memoriaPaquete = exportarMemoria(memoria);
        const ciclos = Array.from(new Set([anio].concat(memoriaPaquete.map(item => item.anio))))
          .filter(Number.isInteger).sort((uno, otro) => uno - otro);
        return {
          nombre: "actualizacion-EP39-" + anio + "-" + marca + ".json",
          tipo: "application/json",
          contenido: JSON.stringify({
            aplicacion: "escuela39-simple",
            formato: "actualizacion-datos",
            version: 2,
            generado: fecha.toISOString(),
            revision_origen: revision,
            anio,
            ciclos_lectivos: ciclos,
            resumen: resumirDatos(datos),
            datos,
            memoria: memoriaPaquete
          }, null, 2)
        };
      },

      async importarActualizacion(payload) {
        payload = payload || {};
        const estado = await cargarEstado();
        await comprobarRevision(payload.revision, estado.revision);
        const fusionar = !!payload.fusionar;
        const paquete = prepararActualizacion(payload.contenido, estado.anio, fusionar);
        const datos = paquete.datos;
        for (const feature of datos.features) {
          const props = feature.properties || {};
          if (props.nombre_persona) props.nombre_persona = Alumnos.upperName(props.nombre_persona);
        }
        const previas = listaSalidas(estado.datos);
        let memoria = Array.isArray(estado.memoria) ? estado.memoria.slice() : [];
        let statsActivos = { agregados: datos.features.length, actualizados: 0 };
        let statsMemoria = { agregados: 0, actualizados: 0 };
        if (fusionar) {
          const activos = fusionarActivos(estado.datos.features, datos.features, estado.anio, paquete.anio);
          datos.features = activos.features;
          statsActivos = { agregados: activos.agregados, actualizados: activos.actualizados };
          if (paquete.memoriaPresente) {
            const fusion = fusionarMemoria(memoria, paquete.memoria);
            memoria = fusion.registros;
            statsMemoria = { agregados: fusion.agregados, actualizados: fusion.actualizados };
          }
        } else if (paquete.memoriaPresente) {
          const momento = new Date().toISOString();
          memoria = [];
          for (const item of paquete.memoria) {
            for (const feature of item.features) memoria.push(registroDeFeature(feature, item.anio, momento));
          }
          statsMemoria = { agregados: memoria.length, actualizados: 0 };
        }
        if (Array.isArray(datos.salidas)) {
          if (fusionar) datos.salidas = fusionarSalidas(previas, datos.salidas);
        } else {
          datos.salidas = previas.slice();
        }
        const respaldo = await almacen.respaldar();
        const revision = await almacen.guardar(estado.revision, datos, { memoria });
        return { ...paquete.resumen, generado: paquete.generado, anio: estado.anio,
          fusionado: fusionar,
          activos_agregados: statsActivos.agregados, activos_actualizados: statsActivos.actualizados,
          memoria_agregados: statsMemoria.agregados, memoria_actualizados: statsMemoria.actualizados,
          respaldo, revision };
      },

      async exportarXLSX(grado) {
        const { datos, anio } = await cargarEstado();
        let curso = "", division = "";
        if (grado) {
          const match = /^([1-6])-([A-D])$/.exec(String(grado));
          if (!match) throw new Error("Seleccioná un grado válido.");
          curso = match[1];
          division = match[2];
        }
        const headers = CAMPOS_EXPORTACION.map(([label]) => label)
          .concat(["Latitud", "Longitud", "Datos originales JSON", "Permanece en el grado", "Año lectivo"]);
        const grupos = new Map();
        for (const feature of datos.features) {
          if (!Alumnos.student(feature)) continue;
          const props = feature.properties || {};
          const cursoFila = String(props.curso || "").trim();
          const divisionFila = String(props.division || "").trim().toUpperCase();
          if (curso && (cursoFila !== curso || divisionFila !== division)) continue;
          const coords = (feature.geometry || {}).coordinates || [null, null];
          const clave = cursoFila && divisionFila ? cursoFila + "-" + divisionFila : "sin-curso";
          if (!grupos.has(clave)) grupos.set(clave, { curso: cursoFila, division: divisionFila, filas: [] });
          grupos.get(clave).filas.push({
            nombre: String(props.nombre_persona || ""),
            fila: CAMPOS_EXPORTACION.map(([, key]) => String(props[key] || ""))
              .concat([coords[1], coords[0],
                JSON.stringify(props.datos_excel_origen || props.excel_maestro || {}),
                props.permanencia === true ? "Sí" : "", anio])
          });
        }
        const orden = (uno, otro) =>
          (Number(uno.curso) || 99) - (Number(otro.curso) || 99) ||
          uno.division.localeCompare(otro.division, "es") ||
          uno.curso.localeCompare(otro.curso, "es");
        const hojas = Array.from(grupos.values()).sort(orden).map(grupo => ({
          headers,
          titulo: grupo.curso && grupo.division ? grupo.curso + "° " + grupo.division : "Sin curso",
          filas: grupo.filas
            .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, "es", { sensitivity: "base" }))
            .map(item => item.fila)
        }));
        if (!hojas.length) hojas.push({ headers, titulo: "Alumnos", filas: [] });
        const contenido = excel.escribirLibro(hojas);
        return { nombre: "alumnos-" + anio + (grado ? "-" + grado : "") + ".xlsx",
          tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contenido };
      }
    };
  }

  return { crearBackend, EDITABLE };
});
