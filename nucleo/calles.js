"use strict";
// Igual que la API de "MAPA CALLES LA PLATA OFFLINE", pero sin leer archivos:
// los datos se pasan ya cargados para poder usarla también en el navegador.
(function(root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./logica.js"), require("./tramos.js"));
  } else {
    root.NucleoCalles = factory(root.streetLogic, root.streetRoutes);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function(logica, tramos) {
  if (!logica || !tramos) throw new Error("Faltan los módulos de calles.");
  const { normalize, streetSearchName, heightsText, matchesHeight } = logica;
  const { findRoutes } = tramos;

  class ErrorConsulta extends Error {
    constructor(message) {
      super(message);
      this.name = "ErrorConsulta";
    }
  }

  function texto(value, name, required = false) {
    if (value === undefined && !required) return "";
    if (typeof value !== "string" || !value.trim() || value.length > 200) {
      throw new ErrorConsulta(name + " debe ser un texto no vacío de hasta 200 caracteres.");
    }
    return value.trim();
  }

  function entero(value, name, fallback, min, max) {
    if (value === undefined) return fallback;
    if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
      throw new ErrorConsulta(name + " debe ser un número entero.");
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
      throw new ErrorConsulta(name + " debe estar entre " + min + " y " + max + ".");
    }
    return number;
  }

  function paginar(items, options) {
    const limite = entero(options.limite, "limite", 50, 1, 200);
    const desde = entero(options.desde, "desde", 0, 0, Number.MAX_SAFE_INTEGER);
    return { total: items.length, desde, limite, resultados: items.slice(desde, desde + limite) };
  }

  function validarDatos(datos) {
    if (!datos || !Array.isArray(datos.roads) || !datos.localities ||
        !Array.isArray(datos.localities.features) || !Array.isArray(datos.places) || !datos.municipality) {
      throw new Error("Instantánea de calles inválida o incompatible.");
    }
    return datos;
  }

  function crearAPI(datos) {
    validarDatos(datos);
    const features = datos.localities.features;
    const grupos = new Map();
    for (const road of datos.roads) {
      const key = streetSearchName(road.name);
      if (!grupos.has(key)) grupos.set(key, { nombre: road.name, cuadras: [] });
      grupos.get(key).cuadras.push(road);
    }
    function localidad(value) {
      const name = texto(value, "localidad");
      if (!name) return null;
      const matches = features.filter(feature => normalize(feature.properties.name) === normalize(name));
      if (!matches.length) throw new ErrorConsulta("Localidad no encontrada: " + name + ".");
      const ids = matches.flatMap(feature => [feature.properties.index, ...(feature.properties.filtro_incluye || [])]);
      return new Set(ids);
    }
    function dentro(item, ids) {
      return !ids || item.localities.some(id => ids.has(id));
    }
    function grupo(value, name) {
      const key = streetSearchName(texto(value, name, true));
      if (!key) throw new ErrorConsulta(name + " debe incluir el nombre o número de la calle.");
      return grupos.get(key);
    }
    function cuadra(road) {
      return { id: road.id, nombre: road.name, categoria: road.category, calle_id: road.streetId,
        alturas: road.heights, localidades: road.localities.map(id => features[id].properties.name),
        geometria: { type: "MultiLineString", coordinates: road.coordinates },
        alturas_confiables: !road.observation };
    }
    return {
      metadatos() {
        return { version_formato: null, generada_en_utc: null, fuentes: [] };
      },
      datosCrudos() {
        return datos;
      },
      calles(options = {}) {
        const q = texto(options.q, "q", true);
        const normalized = normalize(q);
        const key = streetSearchName(q);
        if (!key) throw new ErrorConsulta("q debe incluir el nombre o número de la calle.");
        const ids = localidad(options.localidad);
        const resultados = [...grupos.values()].filter(group =>
          (normalize(group.nombre).includes(normalized) || streetSearchName(group.nombre).includes(key)) &&
          group.cuadras.some(road => dentro(road, ids)))
          .map(group => ({ nombre: group.nombre, cantidad_cuadras: group.cuadras.filter(road => dentro(road, ids)).length }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
        return paginar(resultados, options);
      },
      cuadras(options = {}) {
        const group = grupo(options.calle, "calle");
        const ids = localidad(options.localidad);
        const height = entero(options.altura, "altura", undefined, 1, Number.MAX_SAFE_INTEGER);
        const matching = group ? group.cuadras.filter(road => dentro(road, ids) &&
          (height === undefined || matchesHeight(road.heights, height))) : [];
        const excluidas = height === undefined ? 0 : matching.filter(road => road.observation).length;
        const results = matching.filter(road => height === undefined || !road.observation).map(cuadra);
        return { ...paginar(results, options), cuadras_excluidas_por_alturas_no_confiables: excluidas };
      },
      tramos(options = {}) {
        const mainName = texto(options.calle, "calle", true);
        const firstName = texto(options.entre1, "entre1", true);
        const secondName = texto(options.entre2, "entre2", true);
        const names = [mainName, firstName, secondName].map(streetSearchName);
        if (names.some(name => !name) || new Set(names).size !== 3) {
          throw new ErrorConsulta("Ingresá tres calles diferentes con nombre o número.");
        }
        const main = grupo(mainName, "calle"), first = grupo(firstName, "entre1"), second = grupo(secondName, "entre2");
        const ids = localidad(options.localidad);
        if (!main || !first || !second) return { resultados: [], limitado: false };
        const found = findRoutes(main.cuadras.filter(road => dentro(road, ids)), first.cuadras, second.cuadras);
        return { limitado: Boolean(found.limited), resultados: found.routes.map(route => ({
          inicio: route.start, fin: route.end, distancia_maxima_cruce_metros: route.gap,
          ramificado: route.branched, cuadras: route.edges.map(edge => ({
            id: edge.road.id, nombre: edge.road.name,
            localidades: edge.road.localities.map(id => features[id].properties.name),
            geometria: { type: "LineString", coordinates: edge.line }
          }))
        })) };
      },
      localidades(options = {}) {
        const q = texto(options.q, "q");
        const results = features.filter(feature => normalize(feature.properties.name).includes(normalize(q)))
          .slice().sort((a, b) => a.properties.name.localeCompare(b.properties.name, "es"));
        return paginar(results, options);
      },
      partido() {
        return datos.municipality;
      },
      lugares(options = {}) {
        const q = texto(options.q, "q");
        const ids = localidad(options.localidad);
        const results = datos.places.filter(place => dentro(place, ids) &&
          normalize(place.nombre + " " + place.tipo).includes(normalize(q)))
          .slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
          .map(place => ({ id: place.id, nombre: place.nombre, tipo: place.tipo,
            localidades: place.localities.map(id => features[id].properties.name),
            geometria: { type: "Point", coordinates: place.coordenadas } }));
        return paginar(results, options);
      }
    };
  }

  return { crearAPI, ErrorConsulta, normalize, streetSearchName, heightsText, matchesHeight, findRoutes };
});
