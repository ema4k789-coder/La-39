"use strict";
// Lectura y escritura de planillas. Reconoce los encabezados habituales y
// normaliza los valores con las mismas reglas que usa la búsqueda.
(function() {
  const CAMPOS_IMPORTACION = [
    { clave: "nombre", etiqueta: "Apellido y nombre", sinonimos: ["apellido y nombre", "apellidos y nombres", "nombre completo", "nombre y apellido", "nombre y apellidos", "alumno", "alumna", "estudiante", "nombre", "apellido"] },
    { clave: "dni", etiqueta: "DNI", sinonimos: ["dni", "documento", "n° de documento", "n de documento", "nro documento", "numero de documento", "documento nacional de identidad", "doc", "cuil", "alumno cuil"] },
    { clave: "nacimiento", etiqueta: "Fecha de nacimiento", sinonimos: ["fecha de nacimiento", "fecha nacimiento", "fecha nac", "nacimiento", "fnac", "fecha de nac"] },
    { clave: "curso", etiqueta: "Curso (grado y división)", sinonimos: ["curso", "grado y division", "grado y división", "grado/division", "grado/división", "año y division", "grado division", "curso grado"] },
    { clave: "grado", etiqueta: "Grado", sinonimos: ["grado", "año", "ano", "grado escolar"] },
    { clave: "division", etiqueta: "División", sinonimos: ["division", "división", "seccion", "sección", "letra", "div"] },
    { clave: "direccion", etiqueta: "Dirección", sinonimos: ["direccion", "dirección", "domicilio", "calle", "direccion particular", "dirección particular"] },
    { clave: "telefono", etiqueta: "Teléfono", sinonimos: ["telefono", "teléfono", "tel", "celular", "cel", "contacto", "telefono de contacto"] },
    { clave: "responsable", etiqueta: "Responsable", sinonimos: ["responsable", "padre", "madre", "tutor", "adulto responsable", "nombre del responsable", "padre madre tutor", "familia", "nombre del padre", "nombre de la madre"] },
    { clave: "nacionalidad", etiqueta: "Nacionalidad", sinonimos: ["nacionalidad", "nacionalidad del alumno", "pais", "país"] },
    { clave: "actividad", etiqueta: "Actividad del responsable", sinonimos: ["actividad", "ocupacion", "ocupación", "trabajo", "profesion", "profesión", "actividad del responsable", "actividad laboral", "ocupación del responsable"] },
    { clave: "observaciones", etiqueta: "Observaciones", sinonimos: ["observaciones", "observacion", "observación", "notas", "comentarios", "comentario"] }
  ];
  const ENCABEZADOS_IGNORADOS = new Set([
    "n", "n°", "nro", "numero", "orden", "numero de orden", "n de orden",
    "año lectivo", "ano lectivo", "ciclo lectivo", "año escolar", "ano escolar",
    "edad", "sexo", "turno", "mañana", "tarde", "sala", "preescolar"
  ]);
  const COLUMNAS_EXPORTACION = [
    { clave: "numero", etiqueta: "N°", ancho: 5 },
    { clave: "nombre", etiqueta: "Apellido y nombre", ancho: 34 },
    { clave: "dni", etiqueta: "DNI", ancho: 12 },
    { clave: "nacimiento", etiqueta: "Fecha de nacimiento", ancho: 15 },
    { clave: "anio", etiqueta: "Año lectivo", ancho: 11 },
    { clave: "grado", etiqueta: "Grado", ancho: 7 },
    { clave: "division", etiqueta: "División", ancho: 9 },
    { clave: "direccion", etiqueta: "Dirección", ancho: 34 },
    { clave: "telefono", etiqueta: "Teléfono", ancho: 15 },
    { clave: "responsable", etiqueta: "Responsable", ancho: 28 },
    { clave: "nacionalidad", etiqueta: "Nacionalidad", ancho: 14 },
    { clave: "actividad", etiqueta: "Actividad del responsable", ancho: 28 },
    { clave: "observaciones", etiqueta: "Observaciones", ancho: 30 }
  ];
  const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const ORDINALES = { primero: "1", segundo: "2", tercero: "3", cuarto: "4", quinto: "5", sexto: "6" };

  function normalizarEncabezado(texto) {
    return window.TextoPadron.normalizar(texto);
  }

  function adivinarCampo(encabezado) {
    const buscado = normalizarEncabezado(encabezado);
    if (!buscado || ENCABEZADOS_IGNORADOS.has(buscado)) return "";
    for (const campo of CAMPOS_IMPORTACION) {
      if (campo.sinonimos.some(sinonimo => normalizarEncabezado(sinonimo) === buscado)) return campo.clave;
    }
    for (const campo of CAMPOS_IMPORTACION) {
      if (campo.sinonimos.some(sinonimo => {
        const limpio = normalizarEncabezado(sinonimo);
        return limpio.length >= 4 && (buscado.includes(limpio) || limpio.includes(buscado));
      })) return campo.clave;
    }
    return "";
  }

  function celdasVacias(fila) {
    return !fila || fila.every(celda => window.TextoPadron.limpiarEspacios(celda) === "");
  }

  function leerLibro(archivo) {
    return new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onerror = () => rechazar(new Error("No se pudo leer el archivo."));
      lector.onload = () => {
        try {
          const bytes = new Uint8Array(lector.result);
          let libro;
          if (/\.csv$/i.test(archivo.name || "")) {
            let texto = new TextDecoder("utf-8").decode(bytes);
            if (texto.includes("\uFFFD")) texto = new TextDecoder("windows-1252").decode(bytes);
            libro = XLSX.read(texto, { type: "string", cellDates: true });
          } else {
            libro = XLSX.read(bytes, { type: "array", cellDates: true });
          }
          const hojas = libro.SheetNames.map(nombre => ({
            nombre,
            filas: filasDeHoja(libro, nombre)
          })).filter(hoja => hoja.filas.length);
          if (!hojas.length) throw new Error("La planilla no tiene filas con datos.");
          resolver({ libro, hojas });
        } catch (error) {
          rechazar(new Error(error.message || "No se pudo interpretar la planilla."));
        }
      };
      lector.readAsArrayBuffer(archivo);
    });
  }

  function filasDeHoja(libro, nombre) {
    const hoja = libro.Sheets[nombre];
    if (!hoja) return [];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "", blankrows: false });
    return filas.map(fila => Array.from(fila, celda => {
      if (typeof celda === "string") return celda.replace(/\u00a0/g, " ").trim();
      return celda;
    }));
  }

  function detectarCabecera(filas) {
    let mejor = 0, mejorPuntaje = -1;
    const limite = Math.min(filas.length, 20);
    for (let indice = 0; indice < limite; indice++) {
      const fila = filas[indice];
      if (celdasVacias(fila)) continue;
      const mapeados = fila.filter(celda => typeof celda === "string" && adivinarCampo(celda)).length;
      const textos = fila.filter(celda => typeof celda === "string" && celda.trim()).length;
      const puntaje = mapeados * 3 + textos;
      if (mapeados > 0 && puntaje > mejorPuntaje) {
        mejor = indice;
        mejorPuntaje = puntaje;
      }
    }
    return mejor;
  }

  function encabezados(filas, indiceCabecera) {
    return (filas[indiceCabecera] || []).map((celda, columna) => {
      const texto = window.TextoPadron.limpiarEspacios(celda);
      return texto || "Columna " + (columna + 1);
    });
  }

  function mapeoSugerido(listaEncabezados) {
    const mapa = {};
    CAMPOS_IMPORTACION.forEach(campo => {
      const columna = listaEncabezados.findIndex(encabezado => adivinarCampo(encabezado) === campo.clave);
      if (columna >= 0) mapa[campo.clave] = columna;
    });
    return mapa;
  }

  function textoCelda(valor) {
    if (valor === null || valor === undefined) return "";
    if (valor instanceof Date) return valor;
    if (typeof valor === "number") return String(valor);
    return window.TextoPadron.limpiarEspacios(valor);
  }

  function numeroGrado(valor) {
    const limpio = window.TextoPadron.normalizar(valor);
    if (!limpio) return "";
    const ordinal = ORDINALES[limpio.split(" ")[0]];
    if (ordinal) return ordinal;
    const numero = limpio.match(/^([1-6])(?:\s|[a-d]\b|$)/);
    return numero ? numero[1] : "";
  }

  function letraDivision(valor) {
    const limpio = window.TextoPadron.normalizar(valor);
    if (!limpio) return "";
    if (/^[a-d]$/.test(limpio)) return limpio.toUpperCase();
    const unida = limpio.match(/^[1-6]\s*([a-d])$/);
    if (unida) return unida[1].toUpperCase();
    const suelta = limpio.match(/(?:^|\s)([a-d])(?:\s|$)/);
    return suelta ? suelta[1].toUpperCase() : "";
  }

  function interpretarCurso(valor) {
    const limpio = window.TextoPadron.normalizar(valor);
    if (!limpio) return { grado: "", division: "" };
    return { grado: numeroGrado(limpio), division: letraDivision(limpio) };
  }

  function leerFilas(filas, indiceCabecera, mapa, cursoBase) {
    const registros = [];
    const resumen = { filas: 0, validos: 0, sinNombre: 0, fechasInvalidas: 0 };
    const base = {
      grado: cursoBase && /^[1-6]$/.test(String(cursoBase.grado)) ? String(cursoBase.grado) : "",
      division: cursoBase && /^[A-D]$/.test(String(cursoBase.division)) ? String(cursoBase.division) : ""
    };
    for (let indice = indiceCabecera + 1; indice < filas.length; indice++) {
      const fila = filas[indice];
      if (celdasVacias(fila)) continue;
      resumen.filas++;
      const valor = clave => mapa[clave] >= 0 && mapa[clave] !== undefined
        ? textoCelda(fila[mapa[clave]]) : "";
      const nombre = window.TextoPadron.normalizarNombre(valor("nombre"));
      if (!nombre) {
        resumen.sinNombre++;
        continue;
      }
      const nacimientoCrudo = valor("nacimiento");
      const nacimiento = window.TextoPadron.normalizarFecha(nacimientoCrudo);
      if (nacimientoCrudo !== "" && !nacimiento) resumen.fechasInvalidas++;
      const cursoFila = interpretarCurso(valor("curso"));
      const gradoFila = numeroGrado(valor("grado")) || cursoFila.grado;
      const divisionFila = letraDivision(valor("division")) || cursoFila.division;
      registros.push({
        nombre,
        dni: window.TextoPadron.normalizarDni(valor("dni")),
        nacimiento,
        grado: gradoFila || base.grado,
        division: divisionFila || base.division,
        direccion: window.TextoPadron.normalizarDireccion(valor("direccion")),
        telefono: window.TextoPadron.normalizarTelefono(valor("telefono")),
        responsable: window.TextoPadron.limpiarEspacios(valor("responsable")),
        nacionalidad: window.TextoPadron.limpiarEspacios(valor("nacionalidad")),
        actividad: window.TextoPadron.limpiarEspacios(valor("actividad")),
        observaciones: window.TextoPadron.limpiarEspacios(valor("observaciones"))
      });
    }
    resumen.validos = registros.length;
    return { registros, resumen };
  }

  function ordenarParaExportar(alumnos) {
    return alumnos.slice().sort((uno, otro) => {
      const curso = String(uno.grado).localeCompare(String(otro.grado), "es", { numeric: true }) ||
        String(uno.division).localeCompare(String(otro.division), "es") ||
        window.TextoPadron.normalizar(uno.nombre).localeCompare(window.TextoPadron.normalizar(otro.nombre), "es");
      return curso;
    });
  }

  function filaExportacion(alumno, numero, anio) {
    return {
      numero,
      nombre: alumno.nombre,
      dni: window.TextoPadron.formatearDni(alumno.dni),
      nacimiento: window.TextoPadron.formatearFecha(alumno.nacimiento),
      anio: Number(anio) || "",
      grado: alumno.grado,
      division: alumno.division,
      direccion: alumno.direccion,
      telefono: alumno.telefono,
      responsable: alumno.responsable,
      nacionalidad: alumno.nacionalidad,
      actividad: alumno.actividad,
      observaciones: alumno.observaciones
    };
  }

  function hojaDeAlumnos(alumnos, anio) {
    const ordenados = ordenarParaExportar(alumnos);
    const filas = [COLUMNAS_EXPORTACION.map(columna => columna.etiqueta)];
    ordenados.forEach((alumno, indice) => {
      const fila = filaExportacion(alumno, indice + 1, anio);
      filas.push(COLUMNAS_EXPORTACION.map(columna => fila[columna.clave] === undefined ? "" : fila[columna.clave]));
    });
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    hoja["!cols"] = COLUMNAS_EXPORTACION.map(columna => ({ wch: columna.ancho }));
    hoja["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(filas.length - 1, 0), c: COLUMNAS_EXPORTACION.length - 1 } })
    };
    return hoja;
  }

  function construirLibro(alumnos, anio, nombreHoja) {
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hojaDeAlumnos(alumnos, anio), limpiarNombreHoja(nombreHoja || "Padrón"));
    return libro;
  }

  function construirLibroPorCurso(alumnos, anio) {
    const libro = XLSX.utils.book_new();
    const grupos = new Map();
    for (const alumno of alumnos) {
      const grado = String(alumno.grado || "").trim();
      const division = String(alumno.division || "").trim().toUpperCase();
      const clave = grado && division ? grado + "-" + division : "sin-curso";
      if (!grupos.has(clave)) grupos.set(clave, { grado, division, alumnos: [] });
      grupos.get(clave).alumnos.push(alumno);
    }
    const orden = (uno, otro) =>
      (Number(uno.grado) || 99) - (Number(otro.grado) || 99) ||
      uno.division.localeCompare(otro.division, "es") ||
      uno.grado.localeCompare(otro.grado, "es");
    for (const grupo of Array.from(grupos.values()).sort(orden)) {
      const titulo = grupo.grado && grupo.division ? grupo.grado + "° " + grupo.division : "Sin curso";
      XLSX.utils.book_append_sheet(libro, hojaDeAlumnos(grupo.alumnos, anio), limpiarNombreHoja(titulo));
    }
    if (!grupos.size) {
      XLSX.utils.book_append_sheet(libro, hojaDeAlumnos([], anio), "Padrón");
    }
    return libro;
  }

  function construirPlantilla(grado, division, anio) {
    const cabeceras = CAMPOS_IMPORTACION.map(campo => campo.etiqueta).filter(etiqueta =>
      etiqueta !== "Curso (grado y división)" && etiqueta !== "Grado" && etiqueta !== "División");
    cabeceras.splice(3, 0, "Grado", "División");
    const filas = [
      cabeceras,
      ["APELLIDO Nombre", "45123456", "12/03/2015", grado || "1", division || "A", "Av. 7 N° 1234",
        "221 123 4567", "Responsable Apellido", "Argentina", "Comercio", ""]
    ];
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    hoja["!cols"] = cabeceras.map((cabecera, indice) => ({ wch: [30, 13, 15, 7, 9, 28, 15, 26, 14, 26, 24][indice] || 16 }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, limpiarNombreHoja("Modelo " + (grado || "1") + "° " + (division || "A")));
    return libro;
  }

  function limpiarNombreHoja(nombre) {
    return String(nombre).replace(/[\\/:*?\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Padrón";
  }

  function limpiarNombreArchivo(nombre) {
    return String(nombre).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  }

  function aBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binario = "";
    const bloque = 32768;
    for (let inicio = 0; inicio < bytes.length; inicio += bloque) {
      binario += String.fromCharCode.apply(null, bytes.subarray(inicio, inicio + bloque));
    }
    return btoa(binario);
  }

  function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function descargarEnNavegador(blob, archivo) {
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = archivo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 4000);
    return "navegador";
  }

  function descargarBinario(contenido, nombre, tipo) {
    const archivo = limpiarNombreArchivo(nombre);
    const blob = new Blob([contenido], { type: tipo });
    if (window.AndroidApp && typeof window.AndroidApp.guardarArchivo === "function") {
      window.AndroidApp.guardarArchivo(archivo, tipo, aBase64(contenido));
      return "telefono";
    }
    if (esIOS() && navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], archivo, { type: tipo });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: archivo }).catch(() => descargarEnNavegador(blob, archivo));
          return "compartido";
        }
      } catch (error) {}
    }
    return descargarEnNavegador(blob, archivo);
  }

  function descargarXlsx(libro, nombre) {
    const contenido = XLSX.write(libro, { bookType: "xlsx", type: "array" });
    return descargarBinario(contenido, nombre.endsWith(".xlsx") ? nombre : nombre + ".xlsx", TIPO_XLSX);
  }

  function descargarJson(datos, nombre) {
    const contenido = new TextEncoder().encode(JSON.stringify(datos, null, 2));
    return descargarBinario(contenido, nombre.endsWith(".json") ? nombre : nombre + ".json", "application/json");
  }

  window.ExcelPadron = {
    CAMPOS_IMPORTACION, COLUMNAS_EXPORTACION,
    leerLibro, filasDeHoja, detectarCabecera, encabezados, mapeoSugerido,
    adivinarCampo, interpretarCurso, leerFilas,
    construirLibro, construirLibroPorCurso, construirPlantilla, descargarXlsx, descargarJson
  };
})();
