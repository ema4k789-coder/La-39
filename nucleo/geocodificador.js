"use strict";
// Mismo buscador que usar_calles_offline.js, pero sin Node: recibe la API ya creada
// y sirve igual para el servidor de PC y para la app standalone.
(function(root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./calles.js").streetSearchName);
  } else {
    root.Geocodificador = factory(root.NucleoCalles.streetSearchName);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function(streetSearchName) {
const SX = 91300, SY = 111320, TOLERANCE = 12;
// Una aproximación solo se acepta dentro del entorno esperable de la cuadra.
// Más lejos es preferible dejarlo pendiente antes que inventar un punto.
const MAX_APPROACH = 200;
const MAX_CORNER_SPAN = 200;
const MAX_BIS_SPAN = 200;
const MAX_HEIGHT_REFERENCE = 300;
const MAX_HEIGHT_CLUSTER = 150;
const MAX_REORDER_CLUSTER = 50;
// Algunas calles están dibujadas sólo hasta la cuadra anterior al cruce (por
// ejemplo 528 termina en 173 y las listas usan 528 y 179). La prolongación se
// acepta sólo si el cruce queda alineado con ambas calles y a menos de ~6 cuadras.
const MAX_STREET_EXTRAPOLATION = 900;

const xy = p => [p[0] * SX, p[1] * SY];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];

// "524bis", "524 bi", "524 b.", "524-b", "524 B" se leen siempre como 524 BIS.
// "Nro. 7252", "N. 7252", "Nº 7252" se leen como altura "N° 7252".
function normalizeStreet(value) {
  let text = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/\b(?:nro|no|n)\.?\s*(?=\d)/gi, "N° ");
  text = text.replace(/\bn\s*[°º]\s*/gi, "N° ");
  text = text.replace(/(\d)\s*-?\s*(?:bis|bi|bz)\b\.?/gi, "$1 BIS");
  text = text.replace(/(\d)\s*-?\s*b\b\.?/gi, "$1 BIS");
  text = text.replace(/\bbis\s+([a-z])\b/gi, (_, letter) => "BIS " + letter.toUpperCase());
  text = text.replace(/\b(?:bis|bi|bz)\b/gi, "BIS");
  text = text.replace(/\s*\.\s*/g, " ");
  return text.replace(/\s+/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "").trim();
}

function suffixKey(value) {
  const match = normalizeStreet(value).toUpperCase()
    .match(/^(?:(?:CALLE|AVENIDA|AV\.?|C\.?)\s*)?(\d+)\s*(BIS(?:\s*[A-Z])?|TER|[A-Z])$/);
  return match ? match[1] + " " + match[2].replace(/\s+/g, "") : null;
}

function streetKey(value) {
  return suffixKey(value) || streetSearchName(value);
}

function numericVariants(value) {
  const match = String(value || "").toUpperCase().trim()
    .match(/^(?:(?:CALLE|AVENIDA|AV|C)\s*)?(\d+)\s*((?:BIS|BI|BZ|TER)(?:\s*[A-Z])?|[A-Z])?$/);
  if (!match || match[1].length < 2) return [];
  const number = match[1], suffix = match[2] ? " " + match[2].replace(/\s+/g, " ") : "";
  const result = new Set();
  const add = candidate => {
    if (candidate !== number && candidate.length <= 5 && !candidate.startsWith("0") && Number(candidate) > 0) {
      result.add(candidate + suffix);
    }
  };
  // Solo cambios de un dígito y un dígito de más al principio: son los errores
  // que aparecen en las listas reales. Otras variantes generan demasiadas ambigüedades.
  for (let i = 0; i < number.length; i++) {
    for (let digit = 0; digit <= 9; digit++) add(number.slice(0, i) + digit + number.slice(i + 1));
  }
  if (number.length >= 3) add(number.slice(1));
  return [...result];
}

function streetExists(api, value) {
  try {
    return api.cuadras({ calle: value, limite: 1 }).total > 0;
  } catch {
    return false;
  }
}

const suffixCache = new WeakMap();

function streetVariants(api, value) {
  const key = suffixKey(value);
  if (!key || typeof api.calles !== "function") return [value];
  if (!suffixCache.has(api)) suffixCache.set(api, new Map());
  const cache = suffixCache.get(api);
  if (cache.has(key)) return cache.get(key);
  const number = key.split(" ")[0], names = [];
  let page, offset = 0;
  do {
    page = api.calles({ q: number, desde: offset, limite: 200 });
    names.push(...page.resultados.map(item => item.nombre).filter(name => suffixKey(name) === key));
    offset += page.resultados.length;
    if (!page.resultados.length && offset < page.total) throw new Error("Respuesta incompleta al buscar calles.");
  } while (offset < page.total);
  const variants = [...new Map(names.map(name => [streetSearchName(name), name])).values()];
  cache.set(key, variants.length ? variants : [value]);
  return cache.get(key);
}

function closestPoint(p, a, b) {
  const v = sub(b, a), length = v[0] * v[0] + v[1] * v[1];
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / length)) : 0;
  return [a[0] + t * v[0], a[1] + t * v[1]];
}

function nearestSegment(list, point) {
  let best = null;
  for (const [a, b] of list) {
    const dd = distance(point, closestPoint(point, a, b));
    if (!best || dd < best.distance) best = { a, b, distance: dd };
  }
  return best;
}

function lineAngle(first, second) {
  const a = sub(first.b, first.a), b = sub(second.b, second.a);
  const denominator = Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]);
  return denominator ? Math.acos(Math.min(1, Math.abs((a[0] * b[0] + a[1] * b[1]) / denominator))) * 180 / Math.PI : 90;
}

function closestPair(a, b, c, d) {
  const pairs = [[a, closestPoint(a, c, d)], [b, closestPoint(b, c, d)],
    [c, closestPoint(c, a, b)], [d, closestPoint(d, a, b)]];
  let best = pairs[0];
  for (const pair of pairs) {
    if (distance(pair[0], pair[1]) < distance(best[0], best[1])) best = pair;
  }
  return {
    distance: distance(best[0], best[1]),
    point: [(best[0][0] + best[1][0]) / 2, (best[0][1] + best[1][1]) / 2]
  };
}

function segmentCrossing(a, b, c, d) {
  const v = sub(b, a), w = sub(d, c), denominator = cross(v, w);
  if (Math.abs(denominator) > 1e-8) {
    const t = cross(sub(c, a), w) / denominator, u = cross(sub(c, a), v) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [a[0] + t * v[0], a[1] + t * v[1]];
  }
  const pair = closestPair(a, b, c, d);
  if (pair.distance > TOLERANCE) return null;
  return pair.point;
}

function allBlocks(api, street) {
  let items = [], page;
  do {
    page = api.cuadras({ calle: street, desde: items.length, limite: 200 });
    items = items.concat(page.resultados);
  } while (items.length < page.total);
  return items;
}

function segments(blocks) {
  const result = [];
  for (const block of blocks) {
    for (const line of block.geometria.coordinates) {
      for (let i = 1; i < line.length; i++) result.push([xy(line[i - 1]), xy(line[i]), block.localidades]);
    }
  }
  return result;
}

function closestBetween(first, second) {
  let best = null;
  for (const [p, q, zones] of first) {
    for (const [r, s] of second) {
      if (Math.max(p[0], q[0]) + MAX_APPROACH < Math.min(r[0], s[0]) ||
          Math.max(r[0], s[0]) + MAX_APPROACH < Math.min(p[0], q[0]) ||
          Math.max(p[1], q[1]) + MAX_APPROACH < Math.min(r[1], s[1]) ||
          Math.max(r[1], s[1]) + MAX_APPROACH < Math.min(p[1], q[1])) continue;
      const pair = closestPair(p, q, r, s);
      if (!best || pair.distance < best.distance) best = { ...pair, zonas: zones };
    }
  }
  return best;
}

function closestPairBetween(first, second) {
  let best = null;
  for (const [p, q, zones] of first) {
    for (const [r, s] of second) {
      const pair = closestPair(p, q, r, s);
      if (!best || pair.distance < best.distance) best = { ...pair, a: p, b: q, c: r, d: s, zonas: zones };
    }
  }
  return best;
}

function lineCrossingPoint(a, b, c, d) {
  const v = sub(b, a), w = sub(d, c), denominator = cross(v, w);
  if (Math.abs(denominator) < 1e-8) return null;
  const t = cross(sub(c, a), w) / denominator;
  return {
    point: [a[0] + t * v[0], a[1] + t * v[1]],
    angle: Math.abs(Math.atan2(denominator, v[0] * w[0] + v[1] * w[1]) * 180 / Math.PI)
  };
}

function extrapolatedCrossing(first, second) {
  const near = closestPairBetween(first, second);
  if (!near || near.distance > MAX_STREET_EXTRAPOLATION) return null;
  const crossing = lineCrossingPoint(near.a, near.b, near.c, near.d);
  if (!crossing || crossing.angle < 30 || crossing.angle > 150) return null;
  const gaps = [
    distance(crossing.point, closestPoint(crossing.point, near.a, near.b)),
    distance(crossing.point, closestPoint(crossing.point, near.c, near.d))
  ];
  if (Math.max(...gaps) > MAX_STREET_EXTRAPOLATION) return null;
  return { point: crossing.point, zonas: near.zonas, gaps };
}

function intersections(api, first, second) {
  const a = segments(allBlocks(api, first)), b = segments(allBlocks(api, second)), found = [];
  for (const [p, q, zones] of a) {
    for (const [r, s] of b) {
      if (Math.max(p[0], q[0]) + TOLERANCE < Math.min(r[0], s[0]) ||
          Math.max(r[0], s[0]) + TOLERANCE < Math.min(p[0], q[0]) ||
          Math.max(p[1], q[1]) + TOLERANCE < Math.min(r[1], s[1]) ||
          Math.max(r[1], s[1]) + TOLERANCE < Math.min(p[1], q[1])) continue;
      const point = segmentCrossing(p, q, r, s);
      if (point && !found.some(item => distance(item.point, point) < 25)) {
        found.push({ point, zonas: zones });
      }
    }
  }
  if (found.length) {
    return { limitado: found.length > 100, resultados: found.slice(0, 100).map(item => ({
      coordenadas: [item.point[0] / SX, item.point[1] / SY], zonas: item.zonas,
      descripcion: "Cruce aproximado"
    })) };
  }
  const near = closestBetween(a, b);
  if (near && near.distance <= MAX_APPROACH) {
    return { limitado: false, resultados: [{
      coordenadas: [near.point[0] / SX, near.point[1] / SY],
      zonas: near.zonas,
      descripcion: `Calles no dibujadas en el mapa: punto más cercano entre ${first} y ${second} (${Math.round(near.distance)} m)`,
      distancia_aproximacion: Math.round(near.distance)
    }] };
  }
  const far = extrapolatedCrossing(a, b);
  if (!far) return { limitado: false, resultados: [] };
  const gap = Math.round(Math.max(...far.gaps));
  const short = far.gaps[0] >= far.gaps[1] ? first : second;
  const other = short === first ? second : first;
  return { limitado: false, resultados: [{
    coordenadas: [far.point[0] / SX, far.point[1] / SY],
    zonas: far.zonas,
    descripcion: `Cruce estimado por prolongación: ${short} no está dibujada hasta ${other} (${gap} m)`,
    distancia_aproximacion: gap
  }] };
}

function routeMidpoint(route) {
  const parts = [];
  let current = route.inicio;
  for (const block of route.cuadras) {
    let line = block.geometria.coordinates;
    if (distance(xy(current), xy(line[line.length - 1])) < distance(xy(current), xy(line[0]))) line = line.slice().reverse();
    for (let i = 1; i < line.length; i++) parts.push([line[i - 1], line[i], distance(xy(line[i - 1]), xy(line[i]))]);
    current = line[line.length - 1];
  }
  const total = parts.reduce((sum, item) => sum + item[2], 0);
  let remaining = total / 2;
  for (const [a, b, length] of parts) {
    if (remaining <= length && length > 0) {
      const t = remaining / length;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= length;
  }
  throw new Error("El tramo no tiene geometría válida.");
}

// Cuando una entrecalle no está dibujada (por ejemplo 174), se busca otro tramo
// de esa misma calle dibujado en la zona, se proyecta su traza paralela y se
// cruza con la calle del domicilio. El paso de la cuadra vecina sirve de control:
// si la proyección no coincide con un ancho de cuadra conocido, no se usa.
function estimatedTramoMidpoint(api, query, first, second) {
  const numbers = [query.entre1, query.entre2].map(value => {
    const match = normalizeStreet(value).match(/^\d+$/);
    return match ? Number(match[0]) : null;
  });
  if (numbers.some(value => !Number.isSafeInteger(value)) || Math.abs(numbers[0] - numbers[1]) !== 1) return null;
  if (first.limitado || second.limitado) return null;
  let corner, anchor;
  if (first.resultados.length === 1 && !second.resultados.length) {
    corner = first.resultados[0];
    anchor = numbers[0];
  } else if (second.resultados.length === 1 && !first.resultados.length) {
    corner = second.resultados[0];
    anchor = numbers[1];
  } else return null;
  const missing = anchor === numbers[0] ? query.entre2 : query.entre1;
  const awayName = String(2 * anchor - Number(missing));
  const away = intersections(api, query.calle, awayName);
  if (away.resultados.length !== 1) return null;
  const cornerPoint = xy(corner.coordenadas), awayPoint = xy(away.resultados[0].coordenadas);
  const span = distance(cornerPoint, awayPoint);
  if (span < 40 || span > MAX_CORNER_SPAN) return null;

  // La paralela se acepta sólo si conserva la orientación de la cuadra vecina
  // y su cruce proyectado queda a un ancho de cuadra del extremo conocido.
  let projected = null, reference = null;
  const calleLine = nearestSegment(segments(allBlocks(api, query.calle)), cornerPoint);
  const missingName = resolveStreet(api, missing);
  const parallelLine = missingName && nearestSegment(segments(allBlocks(api, missingName)), cornerPoint);
  const awayNameResolved = resolveStreet(api, awayName);
  const awayLine = awayNameResolved && nearestSegment(segments(allBlocks(api, awayNameResolved)), cornerPoint);
  if (calleLine && parallelLine && awayLine) {
    const crossing = lineCrossingPoint(calleLine.a, calleLine.b, parallelLine.a, parallelLine.b);
    if (crossing && crossing.angle >= 60 && crossing.angle <= 120 &&
        lineAngle(parallelLine, awayLine) <= 10 &&
        Math.abs(distance(crossing.point, cornerPoint) - span) <= 40) {
      projected = crossing.point;
      reference = parallelLine.distance;
    }
  }
  const midpoint = projected
    ? [(cornerPoint[0] + projected[0]) / 2, (cornerPoint[1] + projected[1]) / 2]
    : [(3 * cornerPoint[0] - awayPoint[0]) / 2, (3 * cornerPoint[1] - awayPoint[1]) / 2];
  const detail = projected
    ? `se proyectó la traza paralela de ${missing} dibujada a ${reference >= 1000 ? (reference / 1000).toFixed(1).replace(".", ",") + " km" : Math.round(reference) + " m"}`
    : `se usó el ancho de la cuadra vecina (${Math.round(span)} m)`;
  return {
    coordenadas: [midpoint[0] / SX, midpoint[1] / SY],
    zonas: [...new Set([...corner.zonas, ...away.resultados[0].zonas])],
    descripcion: `Punto medio estimado de la cuadra entre ${query.entre1} y ${query.entre2}: ${missing} no está dibujada en el mapa; ${detail}`,
    estimado_entre: true
  };
}

function searchExact(api, query) {
  if (query.tipo === "cruce") {
    if (!query.calle || !query.entre1 || streetKey(query.calle) === streetKey(query.entre1)) {
      throw new Error("Ingresá dos calles diferentes para buscar el cruce.");
    }
    return intersections(api, query.calle, query.entre1);
  }
  if (query.tipo !== "tramo") throw new Error("Tipo de búsqueda inválido.");
  const result = api.tramos({ calle: query.calle, entre1: query.entre1, entre2: query.entre2 });
  if (!result.resultados.length) {
    const first = intersections(api, query.calle, query.entre1);
    const second = intersections(api, query.calle, query.entre2);
    const corner = (item, cross, label) => ({
      ...item, entrecalle: cross,
      descripcion: item.distancia_aproximacion
        ? item.descripcion + " (extremo, no punto medio)"
        : "Esquina aproximada con " + label + " (extremo, no punto medio)"
    });
    const candidates = [
      ...first.resultados.map(item => corner(item, 1, query.entre1)),
      ...second.resultados.map(item => corner(item, 2, query.entre2))
    ];
    const midpoint = estimatedTramoMidpoint(api, query, first, second);
    if (midpoint) return { limitado: false, resultados: [midpoint] };
    return { limitado: first.limitado || second.limitado || candidates.length > 100, resultados: candidates.slice(0, 100) };
  }
  return { limitado: result.limitado, resultados: result.resultados.map(route => ({
    coordenadas: routeMidpoint(route),
    zonas: [...new Set(route.cuadras.flatMap(block => block.localidades))],
    descripcion: route.ramificado ? "Punto medio aproximado de recorrido ramificado" : "Punto medio aproximado del tramo"
  })) };
}

function pointAlong(line, fraction) {
  const lengths = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const length = distance(xy(line[i - 1]), xy(line[i]));
    lengths.push(length);
    total += length;
  }
  if (!total) return line[0].slice();
  let remaining = fraction * total;
  for (let i = 1; i < line.length; i++) {
    const length = lengths[i - 1];
    if (remaining <= length) {
      const t = length ? remaining / length : 0;
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
    }
    remaining -= length;
  }
  return line[line.length - 1].slice();
}

function heightPoint(block, height) {
  const candidates = [];
  for (const side of ["izquierda", "derecha"]) {
    const start = block.alturas && block.alturas.inicio && block.alturas.inicio[side];
    const end = block.alturas && block.alturas.fin && block.alturas.fin[side];
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) continue;
    const low = Math.min(start, end), high = Math.max(start, end);
    if (height < low || height > high) continue;
    const fraction = start === end ? 0.5 : (height - start) / (end - start);
    const parity = start % 2 === end % 2 ? start % 2 : null;
    candidates.push({ fraction: Math.max(0, Math.min(1, fraction)), parity });
  }
  if (!candidates.length) return null;
  // Si la numeración de un lado mantiene la paridad del domicilio, ese lado
  // ubica mejor la altura que el promedio de ambos lados.
  const matching = candidates.filter(item => item.parity === height % 2);
  const fractions = [...new Set((matching.length ? matching : candidates).map(item => item.fraction))];
  const points = [];
  for (const line of block.geometria.coordinates) {
    if (line.length < 2) continue;
    for (const fraction of fractions) points.push(pointAlong(line, fraction));
  }
  if (!points.length) return null;
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

function heightSearch(api, query) {
  if (!Number.isSafeInteger(query.altura) || query.altura <= 0) {
    return { limitado: false, resultados: [], motivo: "La altura del domicilio no es válida" };
  }
  const name = normalizeStreet(query.calle);
  if (!name) return { limitado: false, resultados: [], motivo: "Falta el nombre de la calle" };
  const page = api.cuadras({ calle: name, altura: query.altura, limite: 200 });
  const blocks = page.resultados || [];
  if (!blocks.length) {
    return {
      limitado: false, resultados: [],
      motivo: page.cuadras_excluidas_por_alturas_no_confiables
        ? "La altura cae en cuadras sin numeración confiable; revisar manualmente"
        : "No hay datos de numeración para la altura " + query.altura + " de " + name
    };
  }
  let points = [];
  for (const block of blocks) {
    const point = heightPoint(block, query.altura);
    if (point) points.push({ point, zonas: block.localidades || [] });
  }
  if (!points.length) {
    return { limitado: false, resultados: [], motivo: "No se pudo ubicar la altura dentro de la cuadra" };
  }
  if (query.referencia) {
    // La numeración se usa junto con el cruce indicado: solo sirve la cuadra
    // que realmente está cerca de esa esquina, no otra cuadra lejana de la calle.
    const references = intersections(api, name, query.referencia).resultados;
    if (!references.length) {
      return { limitado: false, resultados: [], motivo: "No se encontró el cruce " + query.referencia + " de " + name };
    }
    points = points.filter(item => references.some(reference =>
      distance(xy(item.point), xy(reference.coordenadas)) <= MAX_HEIGHT_REFERENCE));
    if (!points.length) {
      return { limitado: false, resultados: [], motivo: "La altura no coincide con el cruce indicado" };
    }
  }
  const clusters = [];
  for (const item of points) {
    const cluster = clusters.find(group => distance(xy(group.point), xy(item.point)) <= MAX_HEIGHT_CLUSTER);
    if (cluster) cluster.zonas.push(...item.zonas);
    else clusters.push({ point: item.point, zonas: [...item.zonas] });
  }
  if (clusters.length > 1) {
    return { limitado: true, resultados: [], motivo: "La altura coincide con varias cuadras; revisar manualmente" };
  }
  const cluster = clusters[0];
  return { limitado: false, resultados: [{
    coordenadas: cluster.point,
    zonas: [...new Set(cluster.zonas)],
    descripcion: "Altura " + query.altura + " aproximada dentro de la cuadra de " + name +
      (query.referencia ? ", cerca de " + query.referencia : "")
  }] };
}

// Solo acepta interpretaciones con evidencia suficiente: un tramo resuelto por la API
// o un cruce exacto. Un único extremo de tramo no alcanza cuando la interpretación es dudosa.
function collapse(found, strict) {
  if (!found || found.limitado || !found.resultados.length) return null;
  if (found.resultados.length === 1 && !found.resultados[0].entrecalle &&
      !found.resultados[0].distancia_aproximacion && !found.resultados[0].estimado_entre) {
    return found.resultados[0];
  }
  if (strict || found.resultados.length !== 2) return null;
  const first = found.resultados.find(item => item.entrecalle === 1);
  const second = found.resultados.find(item => item.entrecalle === 2);
  if (!first || !second || distance(xy(first.coordenadas), xy(second.coordenadas)) > MAX_CORNER_SPAN) return null;
  const a = first.coordenadas, b = second.coordenadas;
  return { coordenadas: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    zonas: [...new Set(found.resultados.flatMap(item => item.zonas || []))] };
}

function estimatedBis(api, query, fields) {
  const missing = fields.map(field => {
    const match = suffixKey(query[field])?.match(/^(\d+) BIS$/);
    if (!match) return null;
    const variants = streetVariants(api, query[field]);
    return variants.some(name => allBlocks(api, name).length) ? null : { field, number: Number(match[1]) };
  }).filter(Boolean);
  if (missing.length !== 1 || !Number.isSafeInteger(missing[0].number + 1)) return null;
  const { field, number } = missing[0];
  const first = { ...query, [field]: String(number) };
  const second = { ...query, [field]: String(number + 1) };
  const resolve = candidateQuery => {
    const keys = fields.map(key => streetKey(candidateQuery[key]));
    if (new Set(keys).size !== keys.length) return null;
    return collapse(searchExact(api, candidateQuery));
  };
  const a = resolve(first), b = resolve(second);
  if (!a || !b || distance(xy(a.coordenadas), xy(b.coordenadas)) > MAX_BIS_SPAN) return null;
  return {
    coordenadas: [(a.coordenadas[0] + b.coordenadas[0]) / 2, (a.coordenadas[1] + b.coordenadas[1]) / 2],
    zonas: [...new Set([...a.zonas, ...b.zonas])],
    descripcion: `Estimación sin calle bis en el mapa: punto medio entre ${number} y ${number + 1}; ubicación no comprobada`
  };
}

function samePoint(results, tolerance) {
  if (!results.length) return null;
  const first = results[0].coordenadas;
  return results.every(item => distance(xy(item.coordenadas), xy(first)) <= tolerance) ? results[0] : null;
}

function searchReordered(api, query) {
  if (query.tipo !== "tramo") return null;
  const order = [["entre1", "calle", "entre2"], ["entre1", "entre2", "calle"],
    ["entre2", "calle", "entre1"], ["entre2", "entre1", "calle"]];
  const results = [];
  for (const [main, first, second] of order) {
    const candidate = { tipo: "tramo", calle: query[main], entre1: query[first], entre2: query[second] };
    let point;
    try { point = collapse(searchExact(api, candidate), true); } catch { continue; }
    if (!point) continue;
    results.push({ ...point,
      descripcion: `Orden reinterpretado: ${candidate.calle} entre ${candidate.entre1} y ${candidate.entre2}; ${point.descripcion || "punto medio aproximado del tramo"}` });
  }
  const result = samePoint(results, MAX_REORDER_CLUSTER);
  return result ? { limitado: false, resultados: [result] } : null;
}

function searchCorrected(api, query, fields) {
  const missing = fields.filter(field => !streetExists(api, query[field]));
  if (!missing.length) return null;
  const options = missing.map(field => {
    const variants = numericVariants(query[field]).filter(name => streetExists(api, name));
    return variants.length ? { field, variants } : null;
  });
  if (options.some(option => !option)) return null;
  let combinations = [{}];
  for (const { field, variants } of options) {
    combinations = combinations.flatMap(combo => variants.map(variant => ({ ...combo, [field]: variant })));
    if (combinations.length > 250) return null;
  }
  const results = [];
  for (const combination of combinations) {
    let point;
    try { point = collapse(searchExact(api, { ...query, ...combination }), true); } catch { continue; }
    if (!point) continue;
    const note = Object.entries(combination).map(([field, value]) => `${query[field]} por ${value}`).join(" y ");
    results.push({ ...point,
      descripcion: `Se interpretó ${note}; ${point.descripcion || "punto medio aproximado del tramo"}` });
  }
  const result = samePoint(results, MAX_REORDER_CLUSTER);
  return result ? { limitado: false, resultados: [result] } : null;
}

function search(api, query) {
  if (query.tipo === "altura") return heightSearch(api, query);
  const fields = query.tipo === "tramo" ? ["calle", "entre1", "entre2"] : ["calle", "entre1"];
  const normalized = { ...query };
  for (const field of fields) normalized[field] = normalizeStreet(query[field]);
  const keys = fields.map(field => streetKey(normalized[field]));
  if (keys.some(key => !key) || new Set(keys).size !== keys.length) {
    throw new Error("Ingresá calles diferentes con nombre o número.");
  }
  let queries = [normalized];
  for (const field of fields) {
    const variants = streetVariants(api, normalized[field]);
    queries = queries.flatMap(item => variants.map(name => ({ ...item, [field]: name })));
  }
  const results = queries.map(item => searchExact(api, item));
  let candidates = results.flatMap(item => item.resultados);
  const limitado = results.some(item => item.limitado);
  if (!candidates.length && !limitado) {
    // Una calle inexistente es más probablemente un error de tipeo que un orden distinto.
    const corrected = searchCorrected(api, normalized, fields);
    if (corrected) return corrected;
    const reordered = searchReordered(api, normalized);
    if (reordered) return reordered;
    const estimate = estimatedBis(api, normalized, fields);
    if (estimate) candidates.push(estimate);
  }
  if (!candidates.length && !limitado) {
    return { limitado: false, resultados: [], motivo: explainMissing(api, normalized) };
  }
  return { limitado: limitado || candidates.length > 100, resultados: candidates.slice(0, 100) };
}

function parseAddress(address) {
  const raw = String(address || "").trim();
  if (!raw) return { error: "Sin domicilio" };
  const text = normalizeStreet(raw);
  if (!text) return { error: "Sin domicilio" };

  const heightCross = text.match(/^(.+?)\s+N°\s*(\d+)\s+y\s+(.+)$/i);
  if (heightCross) {
    return buildQuery([heightCross[1], heightCross[2], heightCross[3]].map(normalizeStreet));
  }
  const heightReference = text.match(/^(.+?)\s+y\s+(.+?)\s+N°\s*(\d+)$/i);
  if (heightReference) {
    const calle = normalizeStreet(heightReference[1]), referencia = normalizeStreet(heightReference[2]);
    const altura = Number(heightReference[3]);
    if (!calle || !referencia || !Number.isSafeInteger(altura) || altura <= 0) {
      return { error: "Domicilio no interpretable automáticamente" };
    }
    return { tipo: "altura", calle, altura, referencia };
  }
  const heightOnly = text.match(/^(.+?)\s+N°\s*(\d+)$/i);
  if (heightOnly) {
    const calle = normalizeStreet(heightOnly[1]), altura = Number(heightOnly[2]);
    if (!calle || !Number.isSafeInteger(altura) || altura <= 0) {
      return { error: "Domicilio no interpretable automáticamente" };
    }
    return { tipo: "altura", calle, altura };
  }

  const streets = text.split(/\s*e\s*\/\s*|\s*\/\s*|\s+entre(?:\s+las?)?\s+|\s+esq(?:uina)?\.?\s+|\s+y\s+|(?<=\d)\s*y\s*(?=\d)/i)
    .map(normalizeStreet).filter(Boolean);
  const hasBetween = /\be\s*\/|\bentre(?:\s+las?)?\b/i.test(text);
  const merged = [];
  for (const street of streets) {
    if (/^(?:BIS|BI|B)$/.test(street) && merged.length) {
      // "A e/ B y Bi" significa A entre B y B bis: el bis es otra entrecalle.
      if (hasBetween) merged.push(merged[merged.length - 1] + " BIS");
      else merged[merged.length - 1] += " BIS";
    } else {
      merged.push(street);
    }
  }
  return buildQuery(merged);
}

function buildQuery(streets) {
  if (streets.length < 2 || streets.length > 3 || streets.some(street => !street)) {
    return { error: "Domicilio no interpretable automáticamente" };
  }
  const names = streets.map(street => streetKey(street));
  if (names.some(name => !name) || new Set(names).size !== names.length) {
    return { error: "Calles repetidas o inválidas" };
  }
  return streets.length === 2
    ? { tipo: "cruce", calle: streets[0], entre1: streets[1] }
    : { tipo: "tramo", calle: streets[0], entre1: streets[1], entre2: streets[2] };
}

function closestStreetMeters(api, first, second) {
  const a = segments(allBlocks(api, first)), b = segments(allBlocks(api, second));
  let best = Infinity;
  for (const [p, q] of a) {
    for (const [r, s] of b) {
      const pair = closestPair(p, q, r, s);
      if (pair.distance < best) best = pair.distance;
    }
  }
  return Number.isFinite(best) ? Math.round(best) : null;
}

function resolveStreet(api, name) {
  try {
    for (const variant of streetVariants(api, name)) {
      if (allBlocks(api, variant).length) return variant;
    }
  } catch {}
  return allBlocks(api, name).length ? name : null;
}

function explainMissing(api, query) {
  const names = query.tipo === "tramo" ? [query.calle, query.entre1, query.entre2] : [query.calle, query.entre1];
  const resolved = names.map(name => ({ name, road: resolveStreet(api, name) }));
  const missing = resolved.find(item => !item.road);
  if (missing) return "La calle " + missing.name + " no figura en el mapa; puede ser un error de escritura";
  if (query.tipo === "cruce") {
    const meters = closestStreetMeters(api, resolved[0].road, resolved[1].road);
    if (meters !== null) {
      return `Las calles no se cruzan en el mapa; el punto más cercano está a ${meters} m (revisar el domicilio)`;
    }
  } else {
    const first = closestStreetMeters(api, resolved[0].road, resolved[1].road);
    const second = closestStreetMeters(api, resolved[0].road, resolved[2].road);
    if (first !== null && second !== null) {
      return `El tramo no coincide con el mapa: ${query.calle} está a ${first} m de ${query.entre1} y a ${second} m de ${query.entre2}`;
    }
  }
  return "Sin coincidencias en el mapa offline";
}

function geocodeAddress(api, address) {
  const query = parseAddress(address);
  if (query.error) return { estado: "pendiente", motivo: query.error };
  const result = search(api, query);
  if (result.limitado) {
    return { estado: "pendiente", motivo: result.motivo || "Demasiados resultados; revisar manualmente" };
  }
  const candidates = result.resultados;
  if (!candidates.length) {
    const detail = result.motivo ||
      (query.tipo === "cruce" || query.tipo === "tramo" ? explainMissing(api, query) : "Sin coincidencias en el mapa offline");
    return { estado: "pendiente", motivo: detail };
  }
  if (candidates.length === 1) {
    return { estado: "aproximada", coordenadas: candidates[0].coordenadas, zonas: candidates[0].zonas || [],
      descripcion: "Automática: " + candidates[0].descripcion + " (revisar domicilio)" };
  }
  if (query.tipo === "tramo" && candidates.length === 2 &&
      candidates[0].entrecalle === 1 && candidates[1].entrecalle === 2) {
    const [a, b] = candidates.map(item => item.coordenadas);
    if (distance(xy(a), xy(b)) <= MAX_CORNER_SPAN) {
      return { estado: "aproximada", coordenadas: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        zonas: [...new Set(candidates.flatMap(item => item.zonas))],
        descripcion: candidates.some(item => item.distancia_aproximacion)
          ? "Automática: punto medio entre aproximaciones a las entrecalles; calles no dibujadas en el mapa (revisar domicilio)"
          : "Automática: punto medio en línea recta entre esquinas aproximadas; tramo no comprobado (revisar domicilio)" };
    }
  }
  return { estado: "pendiente", motivo: "Varias ubicaciones posibles; revisar manualmente" };
}
function buscar(api, query) {
  if (!query || typeof query !== "object") throw new Error("Consulta inválida.");
  if (query.tipo === "lote") {
    if (!Array.isArray(query.domicilios) || query.domicilios.some(value => typeof value !== "string")) {
      throw new Error("La lista de domicilios es inválida.");
    }
    return query.domicilios.map(address => geocodeAddress(api, address));
  }
  if (query.tipo === "domicilio") {
    if (typeof query.domicilio !== "string") throw new Error("El domicilio es inválido.");
    const match = geocodeAddress(api, query.domicilio);
    return match.estado === "aproximada"
      ? { limitado: false, resultados: [{ coordenadas: match.coordenadas, zonas: match.zonas || [],
        descripcion: match.descripcion }] }
      : { limitado: false, resultados: [], motivo: match.motivo };
  }
  return search(api, query);
}

return { buscar, search, geocodeAddress, parseAddress, segmentCrossing, routeMidpoint,
  normalizarCalle: normalizeStreet };
});
