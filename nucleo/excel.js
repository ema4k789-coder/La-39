"use strict";
// Lectura y escritura de planillas .xlsx sin Python: usa SheetJS y las mismas
// reglas que importar_excel_grado.py (columnas, fila de encabezados, último renglón).
(function(root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("../vendor/xlsx.full.min.js"));
  } else {
    root.ExcelApp = factory(root.XLSX);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function(XLSX) {
  if (!XLSX) throw new Error("Falta la librería para leer Excel.");
  const FIELDS = ["numero_alumno", "nombre", "dni", "fecha_nacimiento", "responsable",
    "responsable_nacionalidad", "responsable_actividad", "direccion", "telefono"];
  const FIELD_LABELS = { numero_alumno: "número de alumno", nombre: "nombre del alumno", dni: "DNI",
    fecha_nacimiento: "fecha de nacimiento", responsable: "responsable",
    responsable_nacionalidad: "nacionalidad responsable", responsable_actividad: "actividad responsable",
    direccion: "domicilio", telefono: "teléfono" };
  const MAX_BYTES = 10 * 1024 * 1024;

  function nuevoId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function texto(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) {
      const pad = number => String(number).padStart(2, "0");
      return pad(value.getDate()) + "/" + pad(value.getMonth() + 1) + "/" + value.getFullYear();
    }
    return String(value).trim();
  }

  function normalizarNumeroAlumno(value) {
    if (value === null || value === undefined || typeof value === "boolean") return "";
    if (typeof value === "number") return String(value);
    return texto(value);
  }

  function abrirLibro(encoded) {
    if (typeof encoded !== "string" || encoded.length > MAX_BYTES * 4 / 3 + 8) {
      throw new Error("El Excel debe tener como máximo 10 MB.");
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new Error("El contenido del Excel no es válido.");
    }
    const size = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    if (!size || size > MAX_BYTES) throw new Error("El Excel está vacío o supera los 10 MB.");
    let workbook;
    try {
      workbook = XLSX.read(encoded, { type: "base64", cellDates: true });
    } catch (error) {
      throw new Error("El contenido del Excel no es válido.");
    }
    if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length) {
      throw new Error("El Excel no tiene hojas.");
    }
    return workbook;
  }

  function dimensiones(sheet) {
    if (!sheet || !sheet["!ref"]) return null;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    return { maxRow: range.e.r + 1, maxCol: range.e.c + 1 };
  }

  function elegirHoja(workbook, sheetName, headerRow) {
    if (!Number.isInteger(headerRow) || headerRow < 1) {
      throw new Error("La fila de encabezados debe ser un número entero positivo.");
    }
    if (sheetName && !workbook.SheetNames.includes(sheetName)) {
      throw new Error("La hoja seleccionada no existe.");
    }
    const nombre = sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[nombre];
    const dims = dimensiones(sheet);
    if (!dims) throw new Error("La hoja seleccionada está vacía.");
    if (headerRow >= dims.maxRow) {
      throw new Error("La fila de encabezados debe estar antes de las filas de alumnos.");
    }
    if (dims.maxCol > 200 || dims.maxRow > 10000) {
      throw new Error("La planilla supera el máximo permitido de 200 columnas o 10.000 filas.");
    }
    return { sheet, nombre, ...dims };
  }

  function valorCelda(sheet, row, column) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    if (!cell) return "";
    if (cell.v !== undefined && cell.v !== null) return cell.v;
    return cell.w === undefined ? "" : cell.w;
  }

  function filaValores(sheet, row, maxCol, columnas) {
    const result = [];
    for (let column = 0; column < maxCol; column++) result.push(valorCelda(sheet, row, column));
    return columnas ? result.slice(0, columnas) : result;
  }

  function columnasAsignadas(sheet, mapping, maxCol) {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping) ||
        Object.keys(mapping).some(key => !FIELDS.includes(key))) {
      throw new Error("La asignación de columnas es inválida.");
    }
    const indices = {};
    for (const field of FIELDS) {
      const index = mapping[field];
      if (index === undefined || index === null) continue;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > maxCol) {
        throw new Error("Una columna seleccionada no existe en la hoja.");
      }
      const previous = Object.keys(indices).find(name => indices[name] === index);
      if (previous) {
        throw new Error("La columna " + XLSX.utils.encode_col(index - 1) + " está asignada a " +
          FIELD_LABELS[previous] + " y " + FIELD_LABELS[field] + ". Seleccioná columnas diferentes.");
      }
      indices[field] = index;
    }
    return indices;
  }

  function validarUltima(headerRow, lastRow, maxRow) {
    if (!Number.isInteger(lastRow) || !(headerRow < lastRow && lastRow <= maxRow)) {
      throw new Error("La última fila de alumnos debe estar después del encabezado y dentro de la hoja.");
    }
  }

  function normalizarEncabezado(value) {
    return texto(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  }

  function columnaAnio(headers) {
    for (let index = 0; index < headers.length; index++) {
      if (normalizarEncabezado(headers[index]) === "ano lectivo" ||
          normalizarEncabezado(headers[index]) === "ciclo lectivo") return index + 1;
    }
    return null;
  }

  function valorAnio(value) {
    if (value === null || value === undefined || typeof value === "boolean") return null;
    if (typeof value === "number") {
      if (Number.isInteger(value)) return value;
      throw new Error("La columna Año lectivo tiene un valor inválido: " + value);
    }
    const raw = texto(value);
    if (!raw) return null;
    if (!/^(20\d{2}|2100)$/.test(raw)) {
      throw new Error("La columna Año lectivo tiene un valor inválido: " + raw);
    }
    return Number(raw);
  }

  function inspeccionar(payload) {
    const workbook = abrirLibro(payload.archivo);
    const headerRow = payload.fila;
    const { sheet, nombre, maxRow, maxCol } = elegirHoja(workbook, payload.hoja || "", headerRow);
    const row = filaValores(sheet, headerRow - 1, maxCol);
    const result = {
      hojas: workbook.SheetNames, hoja: nombre, fila_encabezados: headerRow, ultima_fila: maxRow,
      columnas: row.map((value, index) => ({ indice: index + 1,
        letra: XLSX.utils.encode_col(index), encabezado: texto(value) }))
    };
    const yearIndex = columnaAnio(row);
    if (yearIndex) {
      const values = new Set();
      for (let zeroRow = headerRow; zeroRow < maxRow; zeroRow++) {
        const value = valorCelda(sheet, zeroRow, yearIndex - 1);
        if (!texto(value) && value !== 0) continue;
        try { values.add(valorAnio(value)); }
        catch { values.add(texto(value)); }
      }
      result.anio_lectivo = { columna: XLSX.utils.encode_col(yearIndex - 1),
        valores: [...values].sort((a, b) => String(a).localeCompare(String(b))) };
    }
    return result;
  }

  function contar(payload) {
    const workbook = abrirLibro(payload.archivo);
    const headerRow = payload.fila;
    const { sheet, maxCol } = elegirHoja(workbook, payload.hoja || "", headerRow);
    const indices = columnasAsignadas(sheet, payload.columnas, maxCol);
    if (!indices.nombre) throw new Error("Seleccioná la columna de nombre del alumno para contar.");
    validarUltima(headerRow, payload.ultima, dimensiones(sheet).maxRow);
    let total = 0;
    for (let row = headerRow; row < payload.ultima; row++) {
      if (texto(valorCelda(sheet, row, indices.nombre - 1))) total += 1;
    }
    return { alumnos: total };
  }

  function leer(payload, anioActual) {
    const grade = String(payload.grado || "");
    const match = grade.match(/^([1-6])-([A-D])$/);
    if (!match) throw new Error("Seleccioná un grado válido.");
    const course = match[1], division = match[2];
    const nombreArchivo = String(payload.nombre || "").split(/[\\/]/).pop();
    if (!/\.xlsx$/i.test(nombreArchivo)) throw new Error("Seleccioná un archivo .xlsx.");
    const workbook = abrirLibro(payload.archivo);
    const headerRow = payload.fila;
    const { sheet, maxRow, maxCol } = elegirHoja(workbook, payload.hoja || "", headerRow);
    const indices = columnasAsignadas(sheet, payload.columnas, maxCol);
    if (!indices.nombre || !indices.direccion) {
      throw new Error("Seleccioná las columnas de nombre del alumno y domicilio.");
    }
    validarUltima(headerRow, payload.ultima, maxRow);
    const headers = filaValores(sheet, headerRow - 1, maxCol);
    const yearIndex = Number.isInteger(anioActual) ? columnaAnio(headers) : null;
    const features = [];
    for (let zeroRow = headerRow; zeroRow < payload.ultima; zeroRow++) {
      const rowNumber = zeroRow + 1;
      const row = filaValores(sheet, zeroRow, maxCol);
      const value = field => {
        const index = indices[field];
        return index && index <= row.length ? texto(row[index - 1]) : "";
      };
      const student = value("nombre");
      if (!student) continue;
      if (yearIndex && yearIndex <= row.length) {
        const rowYear = valorAnio(row[yearIndex - 1]);
        if (rowYear !== null && rowYear !== anioActual) {
          throw new Error("La fila " + rowNumber + " indica el año lectivo " + rowYear +
            " y el año en curso es " + anioActual + ". No se importó para no mezclar datos.");
        }
      }
      const dni = value("dni").replace(/\D/g, "");
      const family = "F-" + course + division + "-" + nuevoId();
      const tutor = value("responsable");
      features.push({ type: "Feature", geometry: null, properties: {
        familia_id: family, persona_id: family + "-ALUMNO", nombre_persona: student,
        rol: "alumno", es_alumno_central: true, dni, alumno_cuil: dni,
        alumno_cuil_referencia: dni, curso: course, division, turno: "",
        numero_alumno: indices.numero_alumno && indices.numero_alumno <= row.length
          ? normalizarNumeroAlumno(row[indices.numero_alumno - 1]) : "",
        fecha_nacimiento: value("fecha_nacimiento"), direccion_texto: value("direccion"),
        referente_familiar: tutor, responsable_nombre_completo: tutor,
        responsable_nacionalidad: value("responsable_nacionalidad"),
        responsable_actividad: value("responsable_actividad"),
        telefono_contacto_familia: value("telefono"), parentesco_con_alumno: "",
        nacionalidad: "", notas: "", observaciones: "", responsable_principal: false,
        importado_desde_excel: true, archivo_origen: nombreArchivo, fila_origen: rowNumber,
        grado_origen: course + "° " + division, coordenadas_pendientes: true,
        datos_excel_origen: row.map((cell, index) => ({ columna: XLSX.utils.encode_col(index),
          encabezado: texto(headers[index]), valor: texto(cell) })).filter(item => item.valor)
      } });
    }
    if (!features.length) {
      throw new Error("No se encontraron alumnos debajo de la fila de encabezados.");
    }
    return features;
  }

  function nombreHoja(nombre) {
    return String(nombre || "Alumnos").replace(/[\\/:*?\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Alumnos";
  }

  function crearHoja(headers, rows) {
    const data = [headers].concat(rows);
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet["!cols"] = headers.map((_, index) => {
      let longest = 0;
      for (const row of data) {
        const value = row[index] == null ? "" : String(row[index]);
        for (const line of value.split("\n")) longest = Math.max(longest, line.length);
      }
      return { wch: Math.min(50, Math.max(10, longest + 2)) };
    });
    sheet["!autofilter"] = { ref: sheet["!ref"] };
    return sheet;
  }

  function escribirLibro(hojas) {
    const workbook = XLSX.utils.book_new();
    const usados = new Set();
    for (const hoja of hojas) {
      let titulo = nombreHoja(hoja.titulo);
      for (let copia = 2; usados.has(titulo); copia++) {
        const sufijo = " (" + copia + ")";
        titulo = nombreHoja(hoja.titulo).slice(0, 31 - sufijo.length) + sufijo;
      }
      usados.add(titulo);
      XLSX.utils.book_append_sheet(workbook, crearHoja(hoja.headers, hoja.filas), titulo);
    }
    const result = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    return result instanceof Uint8Array ? result : new Uint8Array(result);
  }

  function escribir(headers, rows, title) {
    return escribirLibro([{ headers, filas: rows, titulo: title }]);
  }

  return { inspeccionar, contar, leer, escribir, escribirLibro, texto, abrirLibro };
});
