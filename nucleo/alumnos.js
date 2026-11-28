"use strict";
// Reglas de alumnos compartidas por la PC y la app: grados, DNI y la mezcla de
// una planilla importada con los alumnos que ya tienen ubicación.
(function(root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.Alumnos = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function texto(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function student(feature) {
    const props = feature && feature.properties || {};
    return props.es_alumno_central === true || texto(props.rol).toLowerCase() === "alumno";
  }

  function parseGrade(value) {
    const match = String(value || "").match(/^([1-6])-([A-D])$/);
    if (!match) throw new Error("Seleccioná un grado válido.");
    return [match[1], match[2]];
  }

  function studentDni(feature) {
    const props = feature && feature.properties || {};
    return texto(props.dni || props.alumno_cuil).replace(/\D/g, "");
  }

  function normalizeStudentNumber(value) {
    if (value === null || value === undefined || typeof value === "boolean") return "";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
    return texto(value);
  }

  function duplicateImportRows(dataset, imported) {
    const counts = new Map();
    dataset.features.filter(student).forEach(feature => {
      const dni = studentDni(feature);
      if (dni) counts.set(dni, (counts.get(dni) || 0) + 1);
    });
    return imported.filter(feature => {
      const dni = studentDni(feature);
      return dni && (counts.get(dni) || 0) > 1;
    }).map(feature => feature.properties.fila_origen);
  }

  function plainText(value) {
    return texto(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, " ").toLowerCase().trim();
  }

  function addressKey(value) {
    return texto(value).toLowerCase().replace(/\s+/g, " ");
  }

  function surnameKey(feature) {
    const name = texto((feature && feature.properties || {}).nombre_persona);
    const cut = name.indexOf(",");
    return [plainText(cut >= 0 ? name.slice(0, cut) : name),
      plainText(cut >= 0 ? name.slice(cut + 1) : "")];
  }

  function compareBySurname(first, second) {
    const a = surnameKey(first), b = surnameKey(second);
    return a[0].localeCompare(b[0], "es", { sensitivity: "base" }) ||
      a[1].localeCompare(b[1], "es", { sensitivity: "base" });
  }

  function upperName(value) {
    return texto(value).toLocaleUpperCase("es");
  }

  function located(feature) {
    const geometry = feature && feature.geometry || {}, coordinates = geometry.coordinates;
    return geometry.type === "Point" && Array.isArray(coordinates) && coordinates.length === 2;
  }

  function validarColeccion(geojson) {
    if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
      throw new Error("La base de alumnos no es una colección GeoJSON válida.");
    }
  }

  function mergeGrade(geojson, imported, grade) {
    const [course, division] = parseGrade(grade);
    validarColeccion(geojson);
    const retained = [], locatedStudents = [];
    let pending = 0;
    for (const feature of geojson.features) {
      const props = feature.properties || {};
      const sameGrade = student(feature) && texto(props.curso) === course &&
        texto(props.division).toUpperCase() === division;
      if (!sameGrade) retained.push(feature);
      else if (located(feature)) locatedStudents.push(feature);
      else pending += 1;
    }
    const indexes = { numero_alumno: new Map(), dni: new Map(), nombre: new Map() };
    for (const feature of locatedStudents) {
      const props = feature.properties || {};
      const keys = {
        numero_alumno: normalizeStudentNumber(props.numero_alumno),
        dni: studentDni(feature),
        nombre: plainText(props.nombre_persona)
      };
      for (const [name, key] of Object.entries(keys)) {
        if (!key) continue;
        if (!indexes[name].has(key)) indexes[name].set(key, []);
        indexes[name].get(key).push(feature);
      }
    }
    const used = new Set(), added = [];
    let changedAddresses = 0;
    for (const feature of imported) {
      const props = feature.properties || {};
      const keys = {
        numero_alumno: normalizeStudentNumber(props.numero_alumno),
        dni: studentDni(feature),
        nombre: plainText(props.nombre_persona)
      };
      const candidates = new Set();
      for (const [name, key] of Object.entries(keys)) {
        if (!key) continue;
        for (const match of indexes[name].get(key) || []) candidates.add(match);
      }
      const matches = [...candidates].filter(match => !used.has(match));
      if (matches.length === 1) {
        const match = matches[0];
        used.add(match);
        const before = addressKey((match.properties || {}).direccion_texto);
        const after = addressKey(props.direccion_texto);
        if (before && after && before !== after) changedAddresses += 1;
      } else added.push(feature);
    }
    return {
      geojson: { ...geojson, features: retained.concat(locatedStudents, added) },
      added,
      stats: { conservados: locatedStudents.length, agregados: added.length,
        reemplazados: pending, domicilios_distintos: changedAddresses }
    };
  }

  function replaceGrade(geojson, imported, grade) {
    const [course, division] = parseGrade(grade);
    validarColeccion(geojson);
    const retained = [];
    let removed = 0;
    for (const feature of geojson.features) {
      const props = feature.properties || {};
      const sameGrade = student(feature) && texto(props.curso) === course &&
        texto(props.division).toUpperCase() === division;
      if (sameGrade) removed += 1;
      else retained.push(feature);
    }
    return { geojson: { ...geojson, features: retained.concat(imported) }, removed };
  }

  return { texto, student, parseGrade, studentDni, normalizeStudentNumber,
    duplicateImportRows, plainText, addressKey, located, mergeGrade, replaceGrade,
    compareBySurname, upperName };
});
