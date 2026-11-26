"use strict";
const $ = id => document.getElementById(id);
const esTelefono = () => window.matchMedia("(max-width: 650px)").matches;
const fields = ["nombre_persona", "numero_alumno", "dni", "fecha_nacimiento", "direccion_texto", "referente_familiar",
  "responsable_nacionalidad", "responsable_actividad", "telefono_contacto_familia", "observaciones"];
const importFields = [["numero_alumno", "Número de alumno"], ["nombre", "Nombre del alumno *"], ["dni", "DNI"], ["fecha_nacimiento", "Fecha de nacimiento"],
  ["responsable", "Responsable"], ["responsable_nacionalidad", "Nacionalidad responsable"],
  ["responsable_actividad", "Actividad responsable"], ["direccion", "Domicilio *"], ["telefono", "Teléfono"]];
let features = [], revision = 0, schoolYear = 0, graduationYear = 0, selectedId = null, pendingPoint = null, picking = false, dirty = false, inspected = null;
let idsSalidaActiva = null, nombreSalidaActiva = "";
let countRequest = 0;
let fichaDirty = false, locationSaving = false, formSaving = false;
let limitesPartido = L.latLngBounds([-35.2455, -58.2986], [-34.8251, -57.7433]);
let anilloPartido = null, ultimoCentroValido = null;
// Canvas: con cientos de puntos, el arrastre del mapa responde más fluido que con SVG.
const map = L.map("map", { maxZoom: 19, maxBounds: limitesPartido, maxBoundsViscosity: 1, preferCanvas: true })
  .setView([-34.94, -58.05], 13);
ultimoCentroValido = map.getCenter();
// El zoom mínimo encuadra el partido; se redondea hacia abajo para que los pasos sean enteros.
function ajustarZoomMinimo() {
  const size = map.getSize();
  if (!size.x || !size.y) return;
  const snap = map.options.zoomSnap;
  map.options.zoomSnap = 0;
  map.setMinZoom(0);
  const ajustado = map.getBoundsZoom(limitesPartido);
  map.options.zoomSnap = snap;
  if (Number.isFinite(ajustado)) map.setMinZoom(Math.min(map.getMaxZoom(), Math.floor(ajustado)));
}
map.on("resize", ajustarZoomMinimo);
if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe($("map"));
ajustarZoomMinimo();
// El rectángulo límite tiene esquinas fuera del partido: el centro nunca sale del polígono.
function dentroDelPartido(latlng) {
  if (!anilloPartido) return true;
  const x = latlng.lng, y = latlng.lat;
  let dentro = false;
  for (let i = 0, j = anilloPartido.length - 1; i < anilloPartido.length; j = i++) {
    const [latI, lngI] = anilloPartido[i], [latJ, lngJ] = anilloPartido[j];
    if ((latI > y) !== (latJ > y) && x < ((lngJ - lngI) * (y - latI)) / (latJ - latI) + lngI) dentro = !dentro;
  }
  return dentro;
}
map.on("moveend", () => {
  const centro = map.getCenter();
  if (dentroDelPartido(centro)) { ultimoCentroValido = centro; return; }
  if (ultimoCentroValido) map.setView(ultimoCentroValido, map.getZoom(), { animate: false });
});
map.createPane("baseZones").style.zIndex = "300";
map.createPane("baseGrid").style.zIndex = "340";
map.getPane("baseGrid").style.pointerEvents = "none";
map.createPane("baseStreets").style.zIndex = "350";
map.createPane("baseLabels").style.zIndex = "375";
map.getPane("baseLabels").style.pointerEvents = "none";
map.createPane("students").style.zIndex = "450";
const baseLayer = L.layerGroup().addTo(map);
const zoneLayer = L.geoJSON(null, { pane: "baseZones", interactive: false,
  style: { color: "#9e9e9e", weight: 1.2, fillColor: "#ececec", fillOpacity: 0.9 } }).addTo(baseLayer);
const streetLayer = L.geoJSON(null, {
  pane: "baseStreets", interactive: false,
  style: { color: "#2f2f2f", weight: 2.2 },
}).addTo(baseLayer);
const streetLabels = L.layerGroup().addTo(baseLayer);
const placesLayer = L.layerGroup().addTo(baseLayer);
const gridLayer = L.layerGroup();
let streetData = null, gridCounter = 0;
const pointLayer = L.layerGroup().addTo(map);
let previewLayer = null, requestCounter = 0, timer;
map.attributionControl.addAttribution("Calles: INDEC / Georef Argentina CC BY 4.0");
map.attributionControl.addAttribution('Zonas: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL), INDEC y ARBA');

// El municipio trae un polígono suelto lejos de La Plata: se toma el de mayor superficie.
function limitarAlPartido(municipio) {
  const geometry = (municipio && municipio.geometry) || {};
  const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates
    : geometry.type === "Polygon" ? [geometry.coordinates] : [];
  let limites = null, anillo = null, area = 0;
  for (const polygon of polygons) {
    const ring = polygon && polygon[0];
    if (!ring || ring.length < 3) continue;
    const candidate = L.latLngBounds(ring.map(([lng, lat]) => [lat, lng]));
    const superficie = (candidate.getNorth() - candidate.getSouth()) *
      (candidate.getEast() - candidate.getWest());
    if (superficie > area) {
      area = superficie;
      limites = candidate;
      anillo = ring.map(([lng, lat]) => [lat, lng]);
    }
  }
  if (!limites) return;
  limitesPartido = limites.pad(0.01);
  anilloPartido = anillo;
  map.setMaxBounds(limitesPartido);
  if (!dentroDelPartido(map.getCenter())) map.setView(limites.getCenter(), map.getZoom(), { animate: false });
  ultimoCentroValido = map.getCenter();
  ajustarZoomMinimo();
}

async function loadBase() {
  try {
    const data = await ApiApp.get("/api/mapa-base");
    zoneLayer.addData(data.municipio);
    limitarAlPartido(data.municipio);
    zoneLayer.addData({ type: "FeatureCollection", features: data.localidades.features.filter(f => f.properties.tipo !== "filtro_conjunto") });
    data.lugares.forEach(place => {
      if (!Array.isArray(place.coordenadas) || place.coordenadas.length !== 2) return;
      const marker = L.circleMarker([place.coordenadas[1], place.coordenadas[0]],
        { pane: "baseStreets", radius: 3, color: "#555", fillColor: "#555", fillOpacity: 0.9 });
      marker.bindTooltip(String(place.nombre || "Lugar"), { pane: "tooltipPane" });
      marker.addTo(placesLayer);
    });
  } catch (error) { status("Error en el mapa base offline: " + error.message); }
}
$("showBase").addEventListener("change", event => {
  if (event.target.checked) { baseLayer.addTo(map); loadStreets(); }
  else { map.removeLayer(baseLayer); ++requestCounter; }
});

const STATUS_SILENCE = /(\.\.\.|…)\s*$/;
const STATUS_ERROR = /^(?:Error|No se pudo|No se guardó|La ubicación no se guardó)|no se guardó/i;
const STATUS_OK = /^(?:✓|Ficha|Ubicación|Importados|Actualización|Promoción|Alumno trasladado|Año|Archivo exportado|Base )/;

function toast(message, type) {
  const box = $("toasts");
  if (!box || !message) return;
  const item = document.createElement("div"), text = document.createElement("span"),
    close = document.createElement("button");
  item.className = "toast " + (type || "info");
  text.textContent = message;
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Cerrar aviso");
  close.textContent = "✕";
  const remove = () => item.remove();
  close.addEventListener("click", remove);
  item.append(text, close);
  const host = document.querySelector("dialog[open]") || document.body;
  if (box.parentElement !== host) host.appendChild(box);
  box.appendChild(item);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(remove, 6000);
}

function status(message) {
  $("status").textContent = message;
  $("studentDialogStatus").textContent = message;
  if (!message || STATUS_SILENCE.test(message)) return;
  toast(message, STATUS_ERROR.test(message) ? "error" : STATUS_OK.test(message) ? "success" : "info");
}
function openStudentDialog() {
  $("studentDialogContent").appendChild($("detailContent"));
  $("studentDialogStatus").textContent = "";
  if (!$("studentDialog").open) $("studentDialog").showModal();
  $("studentDialog").scrollTop = 0;
}
function closeStudentDialog() {
  $("duplicateWarning").insertAdjacentElement("afterend", $("detailContent"));
  if ($("studentDialog").open) $("studentDialog").close();
}
$("closeStudentDialog").onclick = closeStudentDialog;
document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("close", () => document.body.appendChild($("toasts")));
});
$("studentDialog").addEventListener("cancel", event => { event.preventDefault(); closeStudentDialog(); });
$("studentDialog").addEventListener("click", event => {
  const dialog = $("studentDialog");
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
    closeStudentDialog();
  }
});
function post(path, body) {
  return ApiApp.post(path, body);
}
function student(f) { return f.properties && (f.properties.es_alumno_central === true || f.properties.rol === "alumno"); }
function gradeOf(p) { return String(p.curso || "") + "-" + String(p.division || "").toUpperCase(); }
function label(f) { return (f.properties.curso || "") + "° " + (f.properties.division || ""); }
function normalizedDni(p) { return String(p.dni || p.alumno_cuil || "").replace(/\D/g, ""); }
function duplicateDniGroups() {
  const groups = new Map();
  features.filter(student).forEach(f => {
    const dni = normalizedDni(f.properties);
    if (!dni) return;
    if (!groups.has(dni)) groups.set(dni, []);
    groups.get(dni).push(f);
  });
  return new Map([...groups].filter(([, students]) => students.length > 1));
}
function renderDuplicateWarning(groups) {
  const warning = $("duplicateWarning"), list = $("duplicateWarningList");
  warning.hidden = groups.size === 0;
  $("duplicateWarningTitle").textContent = "⚠ DNI repetidos: " + groups.size + " · revisar";
  list.textContent = "";
  groups.forEach((students, dni) => {
    const group = document.createElement("div"), heading = document.createElement("strong");
    heading.textContent = "DNI " + dni;
    group.appendChild(heading);
    const names = document.createElement("ul");
    students.forEach(feature => {
      const item = document.createElement("li"), p = feature.properties;
      item.textContent = (p.nombre_persona || "Sin nombre") + " · " + label(feature) +
        (p.numero_alumno ? " · N.º " + p.numero_alumno : "");
      names.appendChild(item);
    });
    group.appendChild(names);
    list.appendChild(group);
  });
}
function validGeometry(f) { return f.geometry && f.geometry.type === "Point" && Array.isArray(f.geometry.coordinates); }
function selectedFeature() { return features.find(f => f.properties && f.properties.persona_id === selectedId); }
function escapeText(value) { const el = document.createElement("span"); el.textContent = value || ""; return el.innerHTML; }

for (const select of [$("grade"), $("importGrade"), $("form").elements.grado]) {
  if (select !== $("grade")) select.add(new Option("Seleccionar grado", ""));
  for (let course = 1; course <= 6; course++) for (const division of "ABCD") {
    select.add(new Option(course + "° " + division, course + "-" + division));
  }
}

async function loadData(keepSelection = false) {
  const payload = await ApiApp.get("/api/datos");
  features = payload.datos.features;
  revision = payload.revision;
  schoolYear = Number(payload.anio) || 0;
  graduationYear = Number(payload.anio_egreso) || schoolYear;
  updateYearLabel();
  if (!keepSelection) selectedId = null;
  else if (selectedId && !selectedFeature()) selectedId = null;
  render();
}

let temporizadorEncuadre = null;

function encuadrarPuntos(animar) {
  const size = map.getSize();
  if (!size.x || !size.y) return false;
  const puntos = pointLayer.getLayers().map(layer => layer.getLatLng());
  if (!puntos.length) return false;
  map.fitBounds(L.latLngBounds(puntos).pad(0.15), { maxZoom: 16, animate: !!animar });
  return true;
}

function programarEncuadre() {
  clearTimeout(temporizadorEncuadre);
  temporizadorEncuadre = setTimeout(() => {
    map.invalidateSize();
    encuadrarPuntos(false);
  }, 350);
}

async function alMostrarMapa() {
  try {
    await loadData(true);
  } catch (error) {
    status("No se pudo refrescar la base: " + error.message);
  }
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
    map.invalidateSize();
  });
}

window.MapaApp = {
  alMostrar: alMostrarMapa,
  encuadrar: () => encuadrarPuntos(false),
  refrescar: () => loadData(true)
};

function updateYearLabel() {
  $("yearLabel").textContent = schoolYear
    ? "Año lectivo " + schoolYear + (graduationYear && graduationYear !== schoolYear ? " · egresos " + graduationYear : "") + " · mapa offline"
    : "Alumnos y domicilios · mapa offline";
}

function visibleStudents() {
  const term = $("search").value.trim().toLocaleLowerCase("es");
  return features.filter(f => {
    if (!student(f)) return false;
    const p = f.properties;
    if ($("grade").value && gradeOf(p) !== $("grade").value) return false;
    if ($("location").value === "pending" && validGeometry(f)) return false;
    if ($("location").value === "located" && !validGeometry(f)) return false;
    if (idsSalidaActiva && !idsSalidaActiva.has(p.persona_id)) return false;
    return !term || [p.nombre_persona, p.numero_alumno, p.dni, p.direccion_texto, p.referente_familiar].some(v =>
      String(v || "").toLocaleLowerCase("es").includes(term));
  });
}

function renderGradeStats() {
  const body = $("gradeStatsBody");
  const selected = $("grade").value;
  const totals = new Map();
  features.filter(student).forEach(f => {
    const key = gradeOf(f.properties), stats = totals.get(key) || { total: 0, located: 0 };
    stats.total++;
    if (validGeometry(f)) stats.located++;
    totals.set(key, stats);
  });
  const all = { total: 0, located: 0 };
  body.textContent = "";
  for (let course = 1; course <= 6; course++) {
    for (const division of "ABCD") {
      const key = course + "-" + division;
      if (selected && key !== selected) continue;
      const stats = totals.get(key) || { total: 0, located: 0 };
      all.total += stats.total;
      all.located += stats.located;
      const pending = stats.total - stats.located;
      const row = document.createElement("tr");
      if (selected === key) row.className = "active";
      row.tabIndex = 0;
      row.title = selected === key
        ? "Quitar el filtro y ver todos los grados"
        : "Ver " + gradeLabel(key) + " en la lista y el mapa";
      const toggle = () => {
        $("grade").value = $("grade").value === key ? "" : key;
        $("grade").dispatchEvent(new Event("change"));
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
      const cells = [course + "° " + division, stats.total, stats.located, pending,
        stats.total ? Math.round(stats.located / stats.total * 100) + "%" : "—"];
      cells.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 2) cell.className = "located";
        if (index === 3) cell.className = "pending";
        row.appendChild(cell);
      });
      body.appendChild(row);
    }
  }
  const yearPrefix = schoolYear ? "Año " + schoolYear + " · " : "";
  if (selected) {
    const stats = totals.get(selected) || { total: 0, located: 0 };
    const pending = stats.total - stats.located;
    const percent = stats.total ? Math.round(stats.located / stats.total * 100) + "% ubicado" : "sin alumnos";
    $("gradeStatsSummary").textContent = yearPrefix + gradeLabel(selected) + ": " + stats.total +
      " · " + stats.located + " ubic. · " + pending + " pend. · " + percent;
  } else {
    $("gradeStatsSummary").textContent = yearPrefix + "Total: " + all.total + " · " + all.located +
      " ubic. · " + (all.total - all.located) + " pend.";
  }
}

function setupStatsToggle() {
  const panel = document.querySelector(".grade-stats"), button = $("toggleStats");
  if (!panel || !button) return;
  let guardada = null;
  try { guardada = localStorage.getItem("escuela39.estadisticas.v2"); } catch {}
  const aplicar = abierta => {
    panel.classList.toggle("collapsed", !abierta);
    button.textContent = abierta ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-expanded", String(abierta));
  };
  aplicar(guardada ? guardada === "abierta" : window.innerWidth > 650);
  button.addEventListener("click", () => {
    const abierta = panel.classList.contains("collapsed");
    aplicar(abierta);
    try { localStorage.setItem("escuela39.estadisticas.v2", abierta ? "abierta" : "cerrada"); } catch {}
  });
}

// En el teléfono, alterna entre el reparto y la lista a pantalla completa.
let sincronizarVista = () => {};

function setupViewToggle() {
  const boton = $("toggleView"), main = document.querySelector("main");
  if (!boton || !main) return;
  const aplicar = () => {
    const lista = main.classList.contains("modo-lista");
    boton.textContent = lista ? "Ver mapa" : "Ver lista";
    boton.setAttribute("aria-pressed", lista ? "true" : "false");
    boton.title = lista ? "Volver al mapa" : "Ver la lista de alumnos a pantalla completa";
    setTimeout(() => map.invalidateSize(), 80);
  };
  sincronizarVista = aplicar;
  boton.addEventListener("click", () => {
    main.classList.toggle("modo-lista");
    aplicar();
    const panel = document.querySelector(".sidebar");
    if (panel) panel.scrollTop = 0;
  });
  aplicar();
}

function mostrarMapa() {
  const main = document.querySelector("main");
  if (main) main.classList.remove("modo-lista");
  sincronizarVista();
}

// Un toque en la lista lleva al punto; el doble toque abre además la ficha.
// El salto al mapa se demora lo justo para no mover el panel entre los dos toques.
let toqueLista = { id: null, timer: 0 };

function activarAlumno(p) {
  if (!esTelefono()) { selectStudent(p.persona_id); return; }
  const repetido = toqueLista.id === p.persona_id;
  clearTimeout(toqueLista.timer);
  toqueLista = { id: null, timer: 0 };
  if (!selectStudent(p.persona_id)) return;
  const elegido = selectedFeature();
  if (!elegido) return;
  if (!validGeometry(elegido)) { openStudentDialog(); return; }
  if (repetido) {
    enfocarPunto(elegido);
    openStudentDialog();
    return;
  }
  toqueLista = {
    id: p.persona_id,
    timer: setTimeout(() => {
      toqueLista = { id: null, timer: 0 };
      const actual = selectedFeature();
      if (actual) enfocarPunto(actual);
    }, 300)
  };
}

// Lleva la vista al punto del alumno y deja el mapa en primer plano.
function enfocarPunto(feature) {
  if (!validGeometry(feature)) return false;
  const [lng, lat] = feature.geometry.coordinates;
  mostrarMapa();
  priorizarMapa(0.65);
  // Al salir de «Ver lista» el mapa recién recupera su tamaño: centrar después.
  setTimeout(() => {
    map.invalidateSize();
    map.setView([lat, lng], Math.max(map.getZoom(), 17), { animate: true });
  }, 90);
  return true;
}

// Separador opciones/mapa de la vista de teléfono: arrastrarlo reparte el alto entre ambos.
let priorizarMapa = () => {};

function setupSplitter() {
  const splitter = $("splitter"), main = document.querySelector("main"),
    sidebar = document.querySelector(".sidebar"), workspace = document.querySelector(".workspace");
  if (!splitter || !main || !sidebar || !workspace) return;
  const CLAVE = "escuela39.reparto.v2", MIN_OPCIONES = 48, MIN_MAPA = 140, ALTO_FILA = 56;
  const filtros = document.querySelector(".filters");
  let reparto = 0.38;
  try {
    const guardado = parseFloat(localStorage.getItem(CLAVE));
    if (guardado > 0.05 && guardado < 0.95) reparto = guardado;
  } catch {}
  const visible = () => getComputedStyle(splitter).display !== "none";
  const totalDisponible = () => Math.max(0, main.clientHeight - splitter.offsetHeight);
  const fijar = (altoOpciones, total) => {
    // El arrastre llega casi a cualquier extremo: deja una franja de cada panel
    // para poder volver a tomar el separador.
    const minimoOpciones = Math.min(MIN_OPCIONES, Math.max(0, total - MIN_MAPA));
    const maximoOpciones = Math.max(minimoOpciones, total - MIN_MAPA);
    const alto = Math.round(Math.min(Math.max(altoOpciones, minimoOpciones), maximoOpciones));
    main.style.setProperty("--alto-opciones", alto + "px");
    main.style.setProperty("--alto-mapa", Math.max(0, total - alto) + "px");
    return alto;
  };
  // Al abrir la app no se restaura un reparto que deje la lista sin ninguna fila.
  const minimoInicial = total => {
    const altoFiltros = filtros ? filtros.offsetHeight : 0;
    return Math.min(altoFiltros + ALTO_FILA, Math.max(0, total - MIN_MAPA));
  };
  let cuadro = 0;
  const actualizarMapa = () => {
    if (cuadro) return;
    cuadro = requestAnimationFrame(() => {
      cuadro = 0;
      map.invalidateSize({ animate: false });
    });
  };
  const guardar = () => {
    reparto = sidebar.offsetHeight / (sidebar.offsetHeight + workspace.offsetHeight);
    try { localStorage.setItem(CLAVE, String(reparto)); } catch {}
  };
  const aplicar = ratio => {
    if (!visible()) return;
    const total = totalDisponible();
    if (!total) return;
    reparto = fijar(Math.max(total * ratio, minimoInicial(total)), total) / total;
  };
  // Al abrir un alumno desde la lista, el mapa puede ocupar más alto sin tocar el separador.
  priorizarMapa = fraccionMapa => {
    if (!visible()) return;
    const total = totalDisponible();
    if (!total) return;
    fijar(Math.min(sidebar.offsetHeight, Math.round(total * (1 - fraccionMapa))), total);
    guardar();
    actualizarMapa();
  };
  splitter.addEventListener("pointerdown", evento => {
    if (!visible()) return;
    evento.preventDefault();
    splitter.setPointerCapture(evento.pointerId);
    splitter.classList.add("dragging");
    const total = sidebar.offsetHeight + workspace.offsetHeight;
    const inicioY = evento.clientY, altoInicial = sidebar.offsetHeight;
    const mover = ev => {
      fijar(altoInicial + ev.clientY - inicioY, total);
      actualizarMapa();
    };
    const soltar = () => {
      splitter.classList.remove("dragging");
      splitter.removeEventListener("pointermove", mover);
      splitter.removeEventListener("pointerup", soltar);
      splitter.removeEventListener("pointercancel", soltar);
      guardar();
      map.invalidateSize({ animate: false });
    };
    splitter.addEventListener("pointermove", mover);
    splitter.addEventListener("pointerup", soltar);
    splitter.addEventListener("pointercancel", soltar);
  });
  splitter.addEventListener("keydown", evento => {
    if (evento.key !== "ArrowUp" && evento.key !== "ArrowDown") return;
    evento.preventDefault();
    const total = sidebar.offsetHeight + workspace.offsetHeight;
    fijar(sidebar.offsetHeight + (evento.key === "ArrowDown" ? 40 : -40), total);
    guardar();
    map.invalidateSize();
  });
  window.addEventListener("resize", () => {
    aplicar(reparto);
    actualizarMapa();
  });
  // Si el alto disponible cambia (barra del navegador, teclado, carga inicial),
  // se vuelve a repartir con la misma proporción en vez de quedar desfasado.
  if (window.ResizeObserver) {
    let altoConocido = 0;
    new ResizeObserver(() => {
      const total = totalDisponible();
      if (!total || Math.abs(total - altoConocido) < 8) return;
      altoConocido = total;
      aplicar(reparto);
      actualizarMapa();
    }).observe(main);
  }
  aplicar(reparto);
  requestAnimationFrame(() => {
    aplicar(reparto);
    actualizarMapa();
  });
}

function filtersActive() {
  return !!(idsSalidaActiva || $("search").value.trim() || $("grade").value || $("location").value);
}

function refrescarFiltroSalida() {
  const box = $("filtroSalida"), texto = $("filtroSalidaTexto");
  if (!box || !texto) return;
  box.hidden = !idsSalidaActiva;
  texto.textContent = idsSalidaActiva
    ? "Mostrando la salida «" + nombreSalidaActiva + "»: " + idsSalidaActiva.size + " alumnos"
    : "";
}

function aplicarFiltroSalida(ids, nombre) {
  idsSalidaActiva = new Set(ids || []);
  nombreSalidaActiva = nombre || "";
  refrescarFiltroSalida();
}

function quitarFiltroSalida() {
  idsSalidaActiva = null;
  nombreSalidaActiva = "";
  refrescarFiltroSalida();
  render();
}

function clearFilters() {
  $("search").value = "";
  $("grade").value = "";
  $("location").value = "";
  idsSalidaActiva = null;
  nombreSalidaActiva = "";
  refrescarFiltroSalida();
  render();
  $("search").focus();
}

function render() {
  const students = visibleStudents();
  const total = features.filter(student);
  const duplicates = duplicateDniGroups();
  const filtersOn = filtersActive();
  renderDuplicateWarning(duplicates);
  const located = total.filter(validGeometry).length;
  const shownLocated = students.filter(validGeometry).length;
  $("summary").textContent = total.length + " alumnos · " + located + " ubicados · " + (total.length - located) + " pendientes";
  $("resultCount").textContent = "Mostrando " + students.length + " de " + total.length +
    " alumnos · " + shownLocated + " en el mapa";
  $("clearFilters").hidden = !filtersOn;
  renderGradeStats();
  $("list").textContent = "";
  pointLayer.clearLayers();
  students.forEach(f => {
    const p = f.properties, item = document.createElement("button");
    item.className = "item" + (p.persona_id === selectedId ? " selected" : "");
    const name = document.createElement("strong"), info = document.createElement("span");
    name.textContent = p.nombre_persona || "Sin nombre";
    const locationStatus = validGeometry(f) ? "Ubicado" : (p.ubicacion_referencia || "Pendiente");
    info.textContent = (p.numero_alumno ? "N.º " + p.numero_alumno + " · " : "") + label(f) +
      (p.permanencia === true ? " · Permanece" : "") +
      (duplicates.has(normalizedDni(p)) ? " · DNI repetido: revisar" : "") + " · " +
      locationStatus + (p.direccion_texto ? " · " + p.direccion_texto : "");
    item.append(name, info);
    item.addEventListener("click", () => activarAlumno(p));
    $("list").appendChild(item);
    if (validGeometry(f)) {
      const [lng, lat] = f.geometry.coordinates;
      const resaltado = p.persona_id === selectedId;
      const marker = L.circleMarker([lat, lng], { pane: "students", radius: resaltado ? 9 : 7,
        color: resaltado ? "#111" : "#fff", weight: resaltado ? 3 : 2.5, fillColor: "#ff6b00", fillOpacity: 0.98 });
      marker.on("click", event => {
        L.DomEvent.stopPropagation(event);
        if (picking) {
          setPicking(false);
          preview([event.latlng.lng, event.latlng.lat], "Ubicación elegida manualmente");
          return;
        }
        if (selectStudent(p.persona_id)) openStudentDialog();
      });
      marker.addTo(pointLayer);
    }
  });
  if (!students.length) {
    const empty = document.createElement("div"), text = document.createElement("p");
    empty.className = "empty-state";
    text.textContent = total.length
      ? "Ningún alumno coincide con la búsqueda o los filtros."
      : "Todavía no hay alumnos cargados. Importá un Excel o creá un alumno nuevo.";
    empty.appendChild(text);
    if (filtersOn) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = "Limpiar filtros";
      clear.addEventListener("click", clearFilters);
      empty.appendChild(clear);
    }
    $("list").appendChild(empty);
  }
}

function clearPreview() {
  if (previewLayer) { previewLayer.remove(); previewLayer = null; }
  $("mapLocationActions").hidden = true;
}
function setPicking(value) {
  picking = value;
  $("pickMap").textContent = value ? "Cancelar selección en el mapa" : "Ubicar manualmente en el mapa";
  $("mapInstructions").hidden = !value;
  $("mapInstructions").textContent = value ? "Hacé clic en el mapa donde vive el alumno. Luego presioná «Guardar ubicación manual» en la ficha." : "";
  map.getContainer().classList.toggle("picking", value);
}
function selectStudent(id) {
  if (locationSaving || formSaving) { status("Esperá a que termine el guardado."); return; }
  if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos y seleccionar otro alumno?")) return;
  selectedId = id;
  const feature = selectedFeature(), p = feature.properties;
  $("form").hidden = false;
  fields.forEach(name => { $("form").elements[name].value = p[name] || ""; });
  const duplicate = duplicateDniGroups().has(normalizedDni(p));
  $("duplicateDni").hidden = !duplicate;
  $("duplicateDni").textContent = duplicate ? "Este DNI también figura en otra ficha. Revisalo y corregilo cuando corresponda." : "";
  $("form").elements.grado.value = gradeOf(p);
  $("form").elements.permanencia.checked = p.permanencia === true;
  const coords = validGeometry(feature) ? feature.geometry.coordinates : null;
  $("lat").value = coords ? coords[1] : "";
  $("lng").value = coords ? coords[0] : "";
  $("detailStatus").textContent = p.ubicacion_referencia || (coords ? "Ubicación guardada" : "Sin ubicación");
  pendingPoint = null; dirty = false; fichaDirty = false; setPicking(false); clearPreview();
  $("locationHelp").textContent = "Para cambiar la ubicación, elegí un punto en el mapa o ingresá latitud y longitud.";
  interpretAddress(); render();
  if (coords) map.setView([coords[1], coords[0]], Math.max(map.getZoom(), 15));
  updateMoveGrade();
  updateDeleteButton();
  return true;
}

function gradeLabel(value) {
  const [course, division] = String(value || "").split("-");
  return course ? course + "° " + (division || "") : "sin grado";
}

// El traslado sólo mueve el grado: si la ficha tiene otros cambios sin guardar,
// se piden antes para no perderlos al recargar los datos.
function formChangedBeyondGrade(feature) {
  const p = feature.properties;
  for (const name of fields) {
    if (String($("form").elements[name].value || "").trim() !== String(p[name] || "").trim()) return true;
  }
  if ($("form").elements.permanencia.checked !== (p.permanencia === true)) return true;
  if (pendingPoint) return true;
  const coords = validGeometry(feature) ? feature.geometry.coordinates : null;
  const read = value => { const text = value.trim(); return text === "" ? null : Number(text.replace(",", ".")); };
  const lat = read($("lat").value), lng = read($("lng").value);
  if (lat === null && lng === null) return !!coords;
  return !coords || lat !== coords[1] || lng !== coords[0];
}

function updateMoveGrade() {
  const button = $("moveGrade"), help = $("moveGradeHelp"), feature = selectedId ? selectedFeature() : null;
  if (!feature) {
    button.disabled = true;
    help.textContent = "Seleccioná un alumno guardado para trasladarlo.";
    return;
  }
  const target = $("form").elements.grado.value;
  if (!target || target === gradeOf(feature.properties)) {
    button.disabled = true;
    help.textContent = "Elegí otro grado en el selector para trasladar al alumno.";
    return;
  }
  button.disabled = false;
  help.textContent = "Pasará a " + gradeLabel(target) + "; se conservan sus datos y su ubicación.";
}

function updateDeleteButton() {
  const button = $("deleteStudent");
  button.disabled = !selectedId;
  button.closest(".delete-block").hidden = !selectedId;
  button.title = selectedId ? "" : "Seleccioná un alumno guardado para eliminarlo.";
}

$("deleteStudent").onclick = async () => {
  if (locationSaving || formSaving) { status("Esperá a que termine el guardado."); return; }
  const feature = selectedId ? selectedFeature() : null;
  if (!feature) { status("Seleccioná un alumno guardado para eliminarlo."); return; }
  const p = feature.properties, name = p.nombre_persona || "el alumno";
  const aviso = dirty ? " También se descartan los cambios sin guardar de esta ficha." : "";
  if (!confirm("¿Eliminar a " + name + " (" + gradeLabel(gradeOf(p)) + ")? Se borran su ficha y su ubicación. " +
      "Antes se guarda un respaldo." + aviso)) return;
  formSaving = true;
  $("deleteStudent").disabled = true;
  status("Eliminando a " + name + "...");
  try {
    const result = await post("/api/eliminar", { revision, id: selectedId });
    await loadData();
    pendingPoint = null; dirty = false; fichaDirty = false; setPicking(false); clearPreview();
    $("form").reset(); $("form").hidden = true;
    $("duplicateDni").hidden = true; $("duplicateDni").textContent = "";
    $("detailStatus").textContent = "Alumno eliminado. Seleccioná otro alumno o creá uno nuevo.";
    $("locationHelp").textContent = "Primero elegí un punto en el mapa o ingresá latitud y longitud.";
    updateMoveGrade(); updateDeleteButton();
    if ($("studentDialog").open) closeStudentDialog();
    status("Alumno eliminado del padrón. Respaldo guardado: " + (result.respaldo || "sí") + ".");
  } catch (error) {
    status("No se pudo eliminar: " + error.message);
    updateDeleteButton();
  } finally {
    formSaving = false;
  }
};

$("form").elements.grado.addEventListener("change", updateMoveGrade);
$("moveGrade").onclick = async () => {
  if (locationSaving || formSaving) return;
  const feature = selectedId ? selectedFeature() : null, target = $("form").elements.grado.value;
  if (!feature || !target || target === gradeOf(feature.properties)) return;
  if (formChangedBeyondGrade(feature)) {
    status("Guardá los demás cambios de la ficha antes de trasladar de grado."); return;
  }
  const name = feature.properties.nombre_persona || "el alumno", destino = gradeLabel(target);
  if (!confirm("¿Trasladar a " + name + " a " + destino +
      "? Se conservan sus datos y su ubicación, y se guarda un respaldo antes de moverlo.")) return;
  $("moveGrade").disabled = true;
  status("Trasladando a " + name + " a " + destino + "...");
  try {
    await post("/api/trasladar", { revision, id: selectedId, grado: target });
    await loadData(true);
    dirty = false; fichaDirty = false; pendingPoint = null;
    $("grade").value = target;
    $("location").value = "";
    selectStudent(selectedId);
    status("Alumno trasladado a " + destino + ". Ahora aparece en la lista y en las estadísticas de ese grado. Respaldo guardado.");
  } catch (error) {
    status("No se pudo trasladar: " + error.message);
    updateMoveGrade();
  }
};

const HEIGHT_MARK = "(?:n\\s*[°º]|nro\\.?|n\\.?)";

function heightAddress(text) {
  return new RegExp("(?:^|\\s)" + HEIGHT_MARK + "\\s*\\d", "i").test(text);
}

function wholeAddress(text) {
  return heightAddress(text) || /(?:^|\s)(?:bis|bi|bz)\.?\s*$/i.test(text);
}

function cleanStreet(value) {
  return String(value || "").replace(/(\d)\s*-?\s*(?:bis|bi|bz|b)\b\.?/gi, "$1 BIS")
    .replace(/\s+/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "").trim();
}

function interpretAddress() {
  const text = $("address").value.trim();
  const crossByN = text.match(new RegExp("^(.+?)\\s+" + HEIGHT_MARK + "\\s*(\\d+)\\s+y\\s+(.+)$", "i"));
  if (crossByN) {
    $("street").value = cleanStreet(crossByN[1]);
    $("cross1").value = crossByN[2];
    $("cross2").value = cleanStreet(crossByN[3]);
    $("candidates").textContent = "";
    return;
  }
  const heightRef = text.match(new RegExp("^(.+?)\\s+y\\s+(.+?)\\s+" + HEIGHT_MARK + "\\s*(\\d+)$", "i"));
  const heightOnly = heightRef ? null : text.match(new RegExp("^(.+?)\\s+" + HEIGHT_MARK + "\\s*(\\d+)$", "i"));
  if (heightOnly || heightRef) {
    const match = heightOnly || heightRef;
    $("street").value = cleanStreet(match[1]);
    $("cross1").value = heightRef ? cleanStreet(heightRef[2]) : "";
    $("cross2").value = "";
    $("candidates").textContent = "Domicilio con altura: «Buscar domicilio» usa el texto completo.";
    return;
  }
  const parts = text.split(/\s*e\s*\/\s*|\s*\/\s*|\s+entre(?:\s+las?)?\s+|\s+esq(?:uina)?\.?\s+|\s+y\s+|(?<=\d)\s*y\s*(?=\d)/i)
    .map(cleanStreet).filter(Boolean);
  const hasBetween = /\be\s*\/|\bentre(?:\s+las?)?\b/i.test(text);
  const values = [];
  for (const part of parts) {
    if (/^(?:bis|bi|bz)$/i.test(part) && values.length) {
      if (hasBetween) values.push(values[values.length - 1] + " BIS");
      else values[values.length - 1] += " BIS";
    } else values.push(part);
  }
  $("street").value = values[0] || "";
  $("cross1").value = values[1] || "";
  $("cross2").value = values[2] || "";
  $("candidates").textContent = values.length > 3 ? "Revisá el domicilio: tiene más de tres calles." : "";
}

function addressChanged() {
  pendingPoint = null; $("lat").value = ""; $("lng").value = ""; clearPreview();
  $("locationHelp").textContent = "Domicilio modificado: elegí un punto o guardá la ficha como pendiente.";
  $("detailStatus").textContent = "Domicilio modificado: elegí un punto o guardá como pendiente.";
}

function preview(coords, reference) {
  pendingPoint = { coords, reference };
  $("lng").value = coords[0].toFixed(6);
  $("lat").value = coords[1].toFixed(6);
  pendingPoint.coords = [Number($("lng").value), Number($("lat").value)];
  clearPreview();
  previewLayer = L.marker([coords[1], coords[0]], { pane: "students", interactive: false, keyboard: false,
    icon: L.divIcon({ className: "selected-location-pin", html: '<span aria-hidden="true">📍</span>',
      iconSize: [36, 44], iconAnchor: [18, 40] }) }).addTo(map);
  if (reference !== "Ubicación elegida manualmente") map.setView([coords[1], coords[0]], Math.max(map.getZoom(), 16));
  $("mapLocationActions").hidden = false;
  $("mapSaveLocation").hidden = false;
  $("mapLocationState").textContent = "📍 Punto seleccionado: todavía no está guardado.";
  $("mapSaveLocation").textContent = selectedId && reference === "Ubicación elegida manualmente"
    ? "Guardar este punto" : "Ir a guardar ficha y ubicación";
  dirty = true;
  $("locationHelp").textContent = selectedId
    ? (reference === "Ubicación elegida manualmente"
      ? "Punto elegido. Presioná «Guardar ubicación manual» o «Guardar ficha y ubicación»."
      : "Resultado elegido. Presioná «Guardar ficha y ubicación».")
    : "Alumno nuevo: presioná «Guardar ficha y ubicación» para guardar la ficha y el punto.";
  $("detailStatus").textContent = reference + " · Guardá la ficha para confirmar.";
}

$("newStudent").onclick = () => {
  if (locationSaving || formSaving) { status("Esperá a que termine el guardado."); return; }
  if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos?")) return;
  selectedId = null; pendingPoint = null; dirty = false; fichaDirty = false; setPicking(false); clearPreview();
  $("locationHelp").textContent = "Alumno nuevo: elegí un punto y usá «Guardar ficha y ubicación».";
  $("form").reset(); $("form").hidden = false;
  $("duplicateDni").hidden = true; $("duplicateDni").textContent = "";
  $("form").elements.grado.value = $("grade").value;
  updateMoveGrade();
  updateDeleteButton();
  $("detailStatus").textContent = "Nueva ficha"; $("candidates").textContent = ""; render();
  if (esTelefono()) openStudentDialog();
};
$("form").addEventListener("input", event => {
  dirty = true;
  if (fields.includes(event.target.name) || event.target.name === "grado" || event.target.name === "permanencia") fichaDirty = true;
  if (event.target.id === "address") {
    addressChanged();
    interpretAddress();
  }
  if (["street", "cross1", "cross2"].includes(event.target.id)) {
    const calle = $("street").value.trim(), first = $("cross1").value.trim(), second = $("cross2").value.trim();
    $("address").value = second ? [calle, [first, second].filter(Boolean).join(" y ")].filter(Boolean).join(" e/ ")
      : [calle, first].filter(Boolean).join(" y ");
    fichaDirty = true;
    addressChanged();
    $("candidates").textContent = "";
  }
  if (event.target.id === "lat" || event.target.id === "lng") {
    pendingPoint = null; clearPreview();
    $("locationHelp").textContent = "Ingresá ambas coordenadas y presioná «Guardar ubicación manual».";
  }
});
["grade", "location"].forEach(id => $(id).addEventListener("change", () => {
  render();
  programarEncuadre();
}));
$("search").addEventListener("input", () => {
  render();
  programarEncuadre();
});
$("fit").onclick = () => {
  const bounds = pointLayer.getLayers().map(layer => layer.getLatLng());
  if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 16 });
  else status("No hay puntos para los filtros seleccionados.");
};
$("pickMap").onclick = () => {
  if (locationSaving) return;
  setPicking(!picking);
  if (picking && $("studentDialog").open) closeStudentDialog();
  status(picking ? "Hacé clic en el mapa para elegir la ubicación." : "Selección de punto cancelada.");
  if (picking && window.matchMedia("(max-width: 1100px)").matches) {
    map.getContainer().scrollIntoView({ behavior: "smooth", block: "center" });
  }
};
map.on("click", event => {
  if (!picking) return;
  setPicking(false);
  preview([event.latlng.lng, event.latlng.lat], "Ubicación elegida manualmente");
});
$("mapChooseAgain").onclick = () => { if (!picking) $("pickMap").click(); };
$("mapShowForm").onclick = () => openStudentDialog();
$("mapSaveLocation").onclick = () => {
  $("saveLocation").click();
};
$("saveLocation").onclick = async () => {
  if (locationSaving || formSaving) return;
  if (!selectedId || fichaDirty || (pendingPoint && pendingPoint.reference !== "Ubicación elegida manualmente")) {
    if (!$("form").reportValidity()) {
      if (!$("studentDialog").open) openStudentDialog();
      status("Completá los campos obligatorios para guardar la ficha.");
      return;
    }
    $("form").requestSubmit();
    return;
  }
  const feature = selectedFeature(), current = validGeometry(feature) ? feature.geometry.coordinates : null;
  const lat = $("lat").value.trim(), lng = $("lng").value.trim();
  const coords = pendingPoint ? pendingPoint.coords :
    lat && lng ? [Number(lng.replace(",", ".")), Number(lat.replace(",", "."))] : null;
  if (!coords || !coords.every(Number.isFinite) || (!pendingPoint && current && coords[0] === current[0] && coords[1] === current[1])) {
    const message = "Primero elegí un punto diferente en el mapa o ingresá latitud y longitud válidas.";
    $("locationHelp").textContent = message; status(message); return;
  }
  if ($("address").value.trim() !== String(selectedFeature().properties.direccion_texto || "").trim()) {
    status("El domicilio fue modificado. Usá «Guardar ficha y ubicación» para guardar ambos juntos.");
    $("detailStatus").textContent = "Guardá la ficha completa para conservar el domicilio modificado y su ubicación.";
    return;
  }
  const button = $("saveLocation"), id = selectedId;
  locationSaving = true; button.disabled = true;
  $("mapSaveLocation").disabled = true;
  $("mapLocationState").textContent = "Guardando ubicación...";
  $("locationHelp").textContent = "Guardando ubicación...";
  $("pickMap").disabled = true; $("lat").disabled = true; $("lng").disabled = true;
  try {
    const result = await post("/api/ubicacion", { revision, id, coordenadas: coords });
    revision = result.revision;
    feature.geometry = { type: "Point", coordinates: coords };
    feature.properties.coordenadas_pendientes = false;
    feature.properties.ubicacion_referencia = "Ubicación elegida manualmente";
    pendingPoint = null; clearPreview(); dirty = fichaDirty;
    if ($("location").value === "pending") $("location").value = "";
    render();
    $("mapLocationActions").hidden = false;
    $("mapSaveLocation").hidden = true;
    $("mapLocationState").textContent = "✓ Ubicación guardada en la base. El punto seleccionado está marcado en el mapa.";
    $("locationHelp").textContent = "Ubicación guardada. Podés elegir otro punto si necesitás corregirlo.";
    $("detailStatus").textContent = fichaDirty ? "Ubicación guardada. La ficha tiene otros cambios sin guardar." : "Ubicación manual guardada en la base.";
    status("Ubicación manual guardada en la base local.");
  } catch (error) {
    $("locationHelp").textContent = "La ubicación no se guardó. Revisá el error y volvé a intentar.";
    $("mapLocationState").textContent = "No se guardó: " + error.message;
    status("No se pudo guardar la ubicación: " + error.message);
    $("detailStatus").textContent = "No se guardó la ubicación: " + error.message;
  } finally {
    locationSaving = false;
    $("mapSaveLocation").disabled = false;
    button.disabled = false;
    $("pickMap").disabled = false; $("lat").disabled = false; $("lng").disabled = false;
  }
};
$("searchAddress").onclick = async () => {
  const address = $("address").value.trim();
  const calle = $("street").value.trim(), entre1 = $("cross1").value.trim(), entre2 = $("cross2").value.trim();
  const complete = calle && entre1 && !wholeAddress(address);
  if (!complete && !wholeAddress(address)) {
    $("candidates").textContent = address ? "Indicá la calle principal y una calle de cruce." : "Escribí el domicilio o indicá las calles.";
    return;
  }
  $("candidates").textContent = "Buscando calles offline...";
  try {
    const result = await post("/api/buscar", wholeAddress(address)
      ? { tipo: "domicilio", domicilio: address }
      : { tipo: entre2 ? "tramo" : "cruce", calle, entre1, entre2 });
    $("candidates").textContent = result.resultados.length
      ? "Elegí una referencia aproximada:"
      : (result.motivo || "Sin coincidencias; probá corregir las calles o elegí el punto en el mapa.");
    result.resultados.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.descripcion + " · " + ((item.zonas || []).join(", ") || "zona no identificada");
      const warning = /revisar domicilio/i.test(item.descripcion || "") ? "" : " (revisar domicilio)";
      button.onclick = () => preview(item.coordenadas, item.descripcion + warning);
      $("candidates").appendChild(button);
    });
    if (result.limitado) $("candidates").append(" Resultados limitados: revisá manualmente.");
  } catch (error) { $("candidates").textContent = "Error: " + error.message; }
};

$("form").onsubmit = async event => {
  event.preventDefault();
  if (locationSaving || formSaving) { status("Esperá a que termine el guardado."); return; }
  const form = $("form"), data = {};
  fields.forEach(name => { data[name] = form.elements[name].value; });
  data.permanencia = form.elements.permanencia.checked;
  const lat = $("lat").value.trim(), lng = $("lng").value.trim();
  if (!!lat !== !!lng) { status("Completá las dos coordenadas o dejá ambas vacías."); return; }
  let coords = pendingPoint ? pendingPoint.coords : null;
  const current = selectedFeature();
  const previousGrade = current ? gradeOf(current.properties) : "";
  const old = current && validGeometry(current) ? current.geometry.coordinates : null;
  if (lat && lng && (!old || Number(lat.replace(",", ".")) !== old[1] || Number(lng.replace(",", ".")) !== old[0])) {
    coords = [Number(lng.replace(",", ".")), Number(lat.replace(",", "."))];
    if (!coords.every(Number.isFinite)) { status("Las coordenadas no son válidas."); return; }
  }
  if (!lat && !lng && old && data.direccion_texto.trim() === String(current.properties.direccion_texto || "").trim()) {
    status("Para borrar un punto, modificá el domicilio o elegí otra ubicación."); return;
  }
  const save = form.querySelector('button[type="submit"]');
  formSaving = true; form.inert = true; save.disabled = true; $("mapSaveLocation").disabled = true;
  let reference = pendingPoint ? pendingPoint.reference : "", geocodeMessage = "";
  try {
    const addressChanged = data.direccion_texto.trim() !== String(current ? current.properties.direccion_texto || "" : "").trim();
    if (addressChanged && data.direccion_texto.trim() && !coords && !lat && !lng) {
      status("Buscando la ubicación del domicilio corregido...");
      const results = await post("/api/buscar", { tipo: "lote", domicilios: [data.direccion_texto.trim()] });
      if (!Array.isArray(results) || results.length !== 1 || !["aproximada", "pendiente"].includes(results[0].estado)) {
        throw new Error("Respuesta inválida al buscar el domicilio.");
      }
      if (results[0].estado === "aproximada") {
        coords = results[0].coordenadas;
        reference = results[0].descripcion;
        geocodeMessage = " Ubicación aproximada calculada; revisala en el mapa.";
      } else {
        geocodeMessage = " Sin ubicación automática: " + results[0].motivo + ". Podés ubicarla manualmente.";
      }
    }
    const targetGrade = form.elements.grado.value, moved = !!previousGrade && targetGrade !== previousGrade;
    const result = await post("/api/guardar", { revision, id: selectedId, grado: targetGrade,
      campos: data, coordenadas: coords, referencia: reference });
    dirty = false;
    if (moved) { $("grade").value = targetGrade; $("location").value = ""; }
    await loadData(); formSaving = false; selectStudent(result.id);
    if (coords && $("location").value === "pending") { $("location").value = ""; render(); }
    if (coords) {
      $("mapLocationActions").hidden = false;
      $("mapSaveLocation").hidden = true;
      $("mapLocationState").textContent = "✓ Ficha y ubicación guardadas en la base.";
    }
    status((moved ? "Ficha guardada. El alumno pasó a " + gradeLabel(targetGrade) +
      " y aparece en la lista de ese grado." : "Ficha y cambios guardados en la base local.") + geocodeMessage);
  } catch (error) { status("No se pudo guardar: " + error.message); }
  finally { formSaving = false; form.inert = false; save.disabled = false; $("mapSaveLocation").disabled = false; }
};

$("autoLocate").onclick = async () => {
  const grade = $("grade").value;
  if (!grade) { status("Elegí un grado para ubicar sus alumnos pendientes."); return; }
  if (dirty) { status("Guardá o descartá la ficha antes de ubicar alumnos."); return; }
  if (!confirm("Se ubicarán los alumnos sin punto de " + grade + ". Se guardará un respaldo y se conservarán las ubicaciones existentes. ¿Continuar?")) return;
  $("autoLocate").disabled = true; status("Buscando domicilios offline...");
  try {
    const result = await post("/api/ubicar", { revision, grado: grade });
    await loadData(true);
    if (selectedId && selectedFeature()) selectStudent(selectedId);
    $("fit").click();
    status("Ubicados aproximadamente: " + result.ubicados + " · Pendientes: " + result.pendientes + ". Revisá los puntos.");
  } catch (error) { status("No se pudo ubicar: " + error.message); }
  finally { $("autoLocate").disabled = false; }
};

$("openImport").onclick = () => {
  if (dirty) { status("Guardá o descartá la ficha antes de importar."); return; }
  $("importGrade").value = $("grade").value;
  $("importYearNote").textContent = schoolYear
    ? "Año lectivo " + schoolYear + ": solo se importan alumnos de este año; la Memoria de años anteriores no se modifica."
    : "Solo se importan alumnos del año lectivo en curso; la Memoria de años anteriores no se modifica.";
  $("import").disabled = false;
  $("importDialog").showModal();
};
function clearInspection() {
  inspected = null; ++countRequest; $("mappingArea").hidden = true;
  $("studentCount").textContent = "La fila de encabezados nunca se importa. Asigná la columna de nombre para contar alumnos.";
}
$("excel").onchange = () => { clearInspection(); $("sheet").innerHTML = '<option value="">Primera hoja</option>'; };
$("sheet").onchange = clearInspection;
$("headerRow").oninput = clearInspection;
$("inspect").onclick = async () => {
  const file = $("excel").files[0], row = Number($("headerRow").value);
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024 || !Number.isInteger(row) || row < 1) {
    $("importStatus").textContent = "Seleccioná un Excel .xlsx de hasta 10 MB y una fila válida."; return;
  }
  $("inspect").disabled = true; $("importStatus").textContent = "Leyendo columnas...";
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
      reader.readAsDataURL(file);
    });
    const result = await post("/api/columnas", { archivo: base64, hoja: $("sheet").value, fila: row });
    if (file !== $("excel").files[0] || row !== Number($("headerRow").value)) throw new Error("Cambió el archivo o la fila. Volvé a examinar.");
    $("sheet").textContent = "";
    result.hojas.forEach(name => $("sheet").add(new Option(name, name)));
    $("sheet").value = result.hoja;
    $("lastRow").value = result.ultima_fila;
    $("mapping").textContent = "";
    importFields.forEach(([key, title]) => {
      const label = document.createElement("label"), select = document.createElement("select");
      label.textContent = title; select.dataset.field = key;
      select.add(new Option("Sin asignar", ""));
      result.columnas.forEach(col => select.add(new Option(col.letra + " · " + (col.encabezado || "sin encabezado"), col.indice)));
      label.appendChild(select); $("mapping").appendChild(label);
    });
    const fileYears = result.anio_lectivo ? result.anio_lectivo.valores : [];
    const yearConflict = !!(schoolYear && fileYears.length &&
      fileYears.some(value => Number(value) !== schoolYear));
    inspected = { archivo: base64, nombre: file.name, hoja: result.hoja, fila: row,
      anioConflicto: yearConflict, anioLectivo: fileYears };
    $("mappingArea").hidden = false;
    $("import").disabled = yearConflict;
    $("importStatus").textContent = yearConflict
      ? "El archivo indica el año lectivo " + fileYears.join(", ") + " y el año en curso es " +
        schoolYear + ". No se puede importar para no mezclar datos."
      : fileYears.length
        ? "Año lectivo del archivo: " + fileYears.join(", ") + ". Seleccioná las columnas correspondientes."
        : "El archivo no indica año lectivo; se importará en " + (schoolYear || "el año en curso") +
          ". Seleccioná las columnas correspondientes.";
    updateStudentCount();
  } catch (error) { $("importStatus").textContent = error.message; }
  finally { $("inspect").disabled = false; }
};
async function updateStudentCount() {
  const request = ++countRequest, mapping = {};
  $("mapping").querySelectorAll("select").forEach(select => {
    if (select.value) mapping[select.dataset.field] = Number(select.value);
  });
  const last = Number($("lastRow").value);
  if (!inspected || !mapping.nombre || !Number.isInteger(last) || last <= inspected.fila) {
    $("studentCount").textContent = "Asigná la columna de nombre y verificá la última fila para contar alumnos.";
    return;
  }
  $("studentCount").textContent = "Contando alumnos (se excluye el encabezado)...";
  try {
    const result = await post("/api/contar-alumnos", {
      archivo: inspected.archivo, hoja: inspected.hoja, fila: inspected.fila, ultima: last, columnas: mapping
    });
    if (request === countRequest) $("studentCount").textContent = "Alumnos detectados para importar: " + result.alumnos;
  } catch (error) {
    if (request === countRequest) $("studentCount").textContent = "No se pudo contar: " + error.message;
  }
}
$("mapping").addEventListener("change", updateStudentCount);
$("lastRow").addEventListener("input", updateStudentCount);
function askLocated(located, grade) {
  return new Promise(resolve => {
    const dialog = $("locatedDialog");
    $("locatedText").textContent = "En " + grade + " hay " + located +
      " alumnos con ubicación. Podés conservarlos sin cambios o reemplazar todo el grado.";
    let answered = false;
    const answer = value => {
      if (answered) return;
      answered = true;
      dialog.close();
      resolve(value);
    };
    dialog.querySelectorAll("button").forEach(button => { button.onclick = () => answer(button.value); });
    dialog.oncancel = () => answer("cancel");
    dialog.showModal();
  });
}
$("import").onclick = async () => {
  const grade = $("importGrade").value, mapping = {};
  $("mapping").querySelectorAll("select").forEach(select => { if (select.value) mapping[select.dataset.field] = Number(select.value); });
  const last = Number($("lastRow").value);
  if (!grade || !inspected || !mapping.nombre || !mapping.direccion || !Number.isInteger(last) || last <= inspected.fila) {
    $("importStatus").textContent = "Elegí grado, columnas de nombre y domicilio, y última fila válida."; return;
  }
  if (inspected.anioConflicto) {
    $("importStatus").textContent = "El archivo pertenece a otro año lectivo (" + inspected.anioLectivo.join(", ") +
      "). No se importa para no mezclar datos."; return;
  }
  $("import").disabled = true;
  const yearText = schoolYear ? " del año lectivo " + schoolYear : "";
  try {
    const located = features.filter(f => student(f) && gradeOf(f.properties) === grade && validGeometry(f)).length;
    let conservar = true;
    if (located) {
      const mode = await askLocated(located, grade);
      if (mode === "cancel") return;
      conservar = mode !== "overwrite";
      if (!conservar && !confirm("Se reemplazarán " + located + " alumnos ya ubicados de " + grade + yearText +
          " y se volverán a ubicar. Esta acción no se puede deshacer salvo por el respaldo. ¿Sobrescribir?")) return;
    } else if (!confirm("Se actualizarán los alumnos sin ubicación de " + grade + yearText +
        " y se creará un respaldo. Los demás grados no se modificarán. ¿Continuar?")) return;
    $("importStatus").textContent = "Importando y buscando domicilios...";
    const result = await post("/api/importar", { revision, grado: grade, ...inspected, ultima: last,
      columnas: mapping, conservar_ubicados: conservar });
    $("importDialog").close(); $("grade").value = grade; dirty = false; await loadData();
    $("form").hidden = true; $("fit").click();
    const duplicateRows = result.filas_dni_duplicado || [];
    let message = "Importados: " + result.importados + " · Conservados: " + result.conservados +
      " · Nuevos: " + result.agregados + " · Ubicados nuevos: " + result.ubicados + " · Pendientes nuevos: " + result.pendientes + ".";
    if (result.domicilios_distintos) message += " Revisá " + result.domicilios_distintos +
      " alumnos conservados cuyo domicilio figura distinto en la lista.";
    if (duplicateRows.length) message += " DNI repetidos para revisar en filas del Excel: " + duplicateRows.join(", ") + ".";
    status(message);
  } catch (error) { $("importStatus").textContent = error.message; }
  finally { $("import").disabled = false; }
};

let updateFile = null;
function leerTexto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsText(file);
  });
}
function resumenActualizacion(contenido) {
  let contenidoJson;
  try { contenidoJson = JSON.parse(contenido); }
  catch { throw new Error("El archivo no es un JSON válido."); }
  const datos = contenidoJson && contenidoJson.formato === "actualizacion-datos"
    ? contenidoJson.datos : contenidoJson;
  if (!datos || datos.type !== "FeatureCollection" || !Array.isArray(datos.features)) {
    throw new Error("El archivo no tiene una colección de alumnos válida.");
  }
  const alumnos = datos.features.filter(student);
  const ubicados = alumnos.filter(validGeometry).length;
  let memoriaAlumnos = 0;
  let ciclos = [];
  if (contenidoJson && Array.isArray(contenidoJson.memoria)) {
    contenidoJson.memoria.forEach(item => {
      const feats = item && item.datos && Array.isArray(item.datos.features) ? item.datos.features : [];
      memoriaAlumnos += feats.filter(student).length;
      if (item && Number(item.anio)) ciclos.push(Number(item.anio));
    });
  }
  if (contenidoJson && Array.isArray(contenidoJson.ciclos_lectivos)) {
    contenidoJson.ciclos_lectivos.forEach(a => { if (Number(a)) ciclos.push(Number(a)); });
  }
  ciclos = Array.from(new Set(ciclos)).sort((a,b)=>a-b);
  return { generado: typeof contenidoJson.generado === "string" ? contenidoJson.generado : "",
    anio: Number(contenidoJson.anio) || 0,
    alumnos: alumnos.length, ubicados, pendientes: alumnos.length - ubicados,
    memoriaAlumnos, ciclos, tieneMemoria: !!(contenidoJson && contenidoJson.memoria) };
}
function fechaDelArchivo(valor) {
  const fecha = valor ? new Date(valor) : null;
  return fecha && !Number.isNaN(fecha.getTime())
    ? fecha.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";
}
$("openUpdate").onclick = () => {
  updateFile = null; $("updateFile").value = ""; $("applyUpdate").disabled = true; $("mergeUpdate").disabled = true;
  $("updateInfo").textContent = "Elegí el archivo que te enviaron.";
  $("updateYearNote").textContent = schoolYear
    ? "Año lectivo en curso: " + schoolYear + ". La exportación incluye la memoria de todos los ciclos lectivos guardados. Al fusionar podés combinar archivos de distintos ciclos."
    : "La exportación incluye todos los ciclos lectivos guardados. Al fusionar podés combinar archivos.";
  $("updateStatus").textContent = "";
  $("updateDialog").showModal();
};
$("updateFile").onchange = async () => {
  const file = $("updateFile").files[0];
  updateFile = null; $("applyUpdate").disabled = true; $("mergeUpdate").disabled = true;
  if (!file) { $("updateInfo").textContent = "Elegí el archivo que te enviaron."; return; }
  if (!/\.json$/i.test(file.name) || file.size > 80 * 1024 * 1024) {
    $("updateInfo").textContent = "Seleccioná un archivo de actualización .json de hasta 80 MB."; return;
  }
  $("updateInfo").textContent = "Leyendo el archivo...";
  try {
    const contenido = await leerTexto(file);
    if (file !== $("updateFile").files[0]) return;
    const resumen = resumenActualizacion(contenido);
    if (!resumen.alumnos && !resumen.memoriaAlumnos) throw new Error("El archivo no contiene alumnos ni memoria.");
    updateFile = { nombre: file.name, contenido, ...resumen };
    const fecha = fechaDelArchivo(resumen.generado);
    const yearInfo = resumen.anio ? "Año lectivo activo " + resumen.anio : "Archivo sin año activo indicado";
    const ciclosInfo = resumen.ciclos && resumen.ciclos.length ? " · Ciclos: " + resumen.ciclos.join(", ") : "";
    const memoriaInfo = resumen.memoriaAlumnos ? " · Memoria: " + resumen.memoriaAlumnos + " alumnos" : "";
    const distinto = resumen.anio && schoolYear && resumen.anio !== schoolYear ? " (distinto del año en curso " + schoolYear + "; para ese año usá Fusionar)" : "";
    $("updateInfo").textContent = yearInfo + distinto + " · " + (fecha ? "Exportado el " + fecha + " · " : "") +
      resumen.alumnos + " alumnos activos · " + resumen.ubicados + " ubicados · " +
      resumen.pendientes + " pendientes" + memoriaInfo + ciclosInfo + ".";
    $("applyUpdate").disabled = false; $("mergeUpdate").disabled = false;
  } catch (error) { $("updateInfo").textContent = error.message; }
};
$("exportUpdate").onclick = async () => {
  $("exportUpdate").disabled = true; $("updateStatus").textContent = "Preparando el archivo...";
  try {
    await ApiApp.descargar("/api/actualizacion.json");
    $("updateStatus").textContent = "Archivo exportado (incluye todos los ciclos lectivos/memoria). Compartilo con la otra persona.";
  } catch (error) { $("updateStatus").textContent = "No se pudo exportar: " + error.message; }
  finally { $("exportUpdate").disabled = false; }
};
async function enviarActualizacion(fusionar) {
  if (!updateFile) return;
  if (dirty || fichaDirty) {
    $("updateStatus").textContent = "Guardá o descartá la ficha antes de cargar una actualización."; return;
  }
  const yearText = schoolYear ? " del año lectivo " + schoolYear : "";
  const msg = fusionar
    ? "Se fusionará el archivo con los datos actuales (alumnos activos y memoria por ciclo lectivo). Los registros coincidentes se actualizarán y se agregarán los nuevos. Se guardará un respaldo antes. ¿Fusionar?"
    : "Se reemplazarán los datos actuales" + yearText + " (" + features.filter(student).length +
      " alumnos activos) por la actualización (" + updateFile.alumnos +
      " alumnos activos). Si el archivo no incluye memoria, se conservará la memoria existente. Se guardará un respaldo antes. ¿Reemplazar?";
  if (!confirm(msg)) return;
  $("applyUpdate").disabled = true; $("mergeUpdate").disabled = true;
  $("updateStatus").textContent = fusionar ? "Fusionando datos..." : "Cargando la actualización...";
  try {
    const result = await post("/api/datos-actualizacion", { revision, contenido: updateFile.contenido, fusionar: fusionar });
    $("updateStatus").textContent = ""; $("updateDialog").close(); dirty = false; await loadData();
    $("form").hidden = true; $("fit").click();
    const detalle = fusionar
      ? (" (activos +" + (result.activos_agregados||0) + " / actualizados " + (result.activos_actualizados||0) +
         ", memoria +" + (result.memoria_agregados||0) + " / actualizada " + (result.memoria_actualizados||0) + ")")
      : "";
    status((fusionar ? "Datos fusionados: " : "Actualización cargada: ") + result.alumnos + " alumnos · " + result.ubicados +
      " ubicados · " + result.pendientes + " pendientes" + detalle + ". Respaldo: " + result.respaldo + ".");
  } catch (error) { $("updateStatus").textContent = "No se pudo cargar: " + error.message; }
  finally { $("applyUpdate").disabled = !updateFile; $("mergeUpdate").disabled = !updateFile; }
}
$("applyUpdate").onclick = () => enviarActualizacion(false);
$("mergeUpdate").onclick = () => enviarActualizacion(true);

function renderYear() {
  $("yearValue").value = schoolYear ? String(schoolYear) : "";
  $("yearCurrent").textContent = schoolYear
    ? "Año en curso: " + schoolYear + " · Memoria de egresados: " + (graduationYear || schoolYear) + "."
    : "Todavía no se cargó el año lectivo.";
  const pending = !!schoolYear && !!graduationYear && schoolYear > graduationYear;
  $("yearNextInfo").textContent = pending
    ? "El año " + schoolYear + " ya está abierto. Antes de abrir otro, promocioná los grupos para archivar a los egresados de " + graduationYear + "."
    : schoolYear
      ? "Se abrirá el año " + (schoolYear + 1) + " y los grados se mantienen hasta que apliques la Promoción. La promoción archivará a los egresados de 6.° en la memoria de " + (graduationYear || schoolYear) + "."
      : "Primero establecé el año en curso.";
  $("openNextYear").disabled = !schoolYear || pending;
}

async function saveYear(nuevo, mensaje) {
  $("yearStatus").textContent = "Guardando el año lectivo...";
  try {
    const result = await post("/api/anio", { revision, anio: nuevo });
    revision = result.revision;
    schoolYear = Number(result.anio) || schoolYear;
    graduationYear = Number(result.anio_egreso) || schoolYear;
    updateYearLabel(); renderYear();
    $("yearStatus").textContent = mensaje + " Año en curso: " + schoolYear +
      (result.respaldo ? " · Respaldo: " + result.respaldo : " · Sin cambios en los datos.");
  } catch (error) { $("yearStatus").textContent = "No se pudo guardar el año: " + error.message; }
}

$("openYear").onclick = () => {
  $("yearStatus").textContent = "";
  renderYear();
  $("yearDialog").showModal();
};
$("saveYear").onclick = () => {
  const nuevo = Number($("yearValue").value);
  if (!Number.isInteger(nuevo) || nuevo < 2000 || nuevo > 2100) {
    $("yearStatus").textContent = "Ingresá un año entre 2000 y 2100."; return;
  }
  if (nuevo === schoolYear) { $("yearStatus").textContent = "El año en curso ya es " + schoolYear + "."; return; }
  const extra = nuevo < graduationYear ? " También se ajustará el año de egresos pendientes a " + nuevo + "." : "";
  if (!confirm("Se establecerá " + nuevo + " como año lectivo en curso." + extra + " Se guarda un respaldo. ¿Continuar?")) return;
  saveYear(nuevo, "Año establecido.");
};
$("openNextYear").onclick = () => {
  if (!$("openNextYear").disabled) {
    if (!confirm("Se abrirá el año lectivo " + (schoolYear + 1) +
        ". Los grados no cambian hasta que promociones y se guarda un respaldo. ¿Continuar?")) return;
    saveYear(schoolYear + 1, "Año nuevo abierto.");
  }
};

function promotionPlan() {
  const rows = [];
  for (let course = 1; course <= 6; course++) rows.push({ course, alumnos: 0, promueven: 0, permanecen: 0 });
  let sinGrado = 0;
  features.filter(student).forEach(f => {
    const course = Number(f.properties.curso);
    if (!Number.isInteger(course) || course < 1 || course > 6) { sinGrado++; return; }
    const row = rows[course - 1];
    row.alumnos++;
    if (f.properties.permanencia === true) row.permanecen++;
    else row.promueven++;
  });
  const pasan = rows.slice(0, 5).reduce((total, row) => total + row.promueven, 0);
  const egresan = rows[5].promueven;
  const permanecen = rows.reduce((total, row) => total + row.permanecen, 0);
  return { rows, alumnos: pasan + egresan + permanecen + sinGrado, pasan, egresan, permanecen, sinGrado };
}

function renderPromotion() {
  const plan = promotionPlan(), box = $("promotionSummary");
  const anioEgreso = graduationYear || schoolYear;
  box.textContent = "";
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = (anioEgreso ? "Promoción · egresos " + anioEgreso : "Promoción") + " · " +
    plan.alumnos + " alumnos · " + plan.pasan + " pasan de grado · " + plan.permanecen + " permanecen · " +
    plan.egresan + " egresan a la memoria." +
    (schoolYear && anioEgreso && schoolYear !== anioEgreso
      ? " El año en curso " + schoolYear + " se mantiene y se archivan los egresados de " + anioEgreso + "." : "");
  box.appendChild(intro);
  const table = document.createElement("table");
  table.className = "promotion-table";
  const head = table.createTHead().insertRow();
  ["Curso", "Alumnos", "Promueven", "Permanecen", "Destino"].forEach(text => {
    const cell = document.createElement("th");
    cell.textContent = text;
    head.appendChild(cell);
  });
  const body = table.createTBody();
  plan.rows.forEach(row => {
    const line = body.insertRow();
    const destino = row.course === 6 ? "Memoria" + (anioEgreso ? " " + anioEgreso : "") : (row.course + 1) + ".°";
    [row.course + ".°", row.alumnos, row.promueven, row.permanecen, destino].forEach(value => {
      const cell = line.insertCell();
      cell.textContent = value;
    });
  });
  box.appendChild(table);
  if (plan.sinGrado) {
    const warning = document.createElement("p");
    warning.className = "hint";
    warning.textContent = plan.sinGrado + " alumnos sin grado válido no se modifican.";
    box.appendChild(warning);
  }
  if (!plan.alumnos) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No hay alumnos para promocionar.";
    box.appendChild(empty);
  }
  $("applyPromotion").disabled = plan.alumnos === 0;
}

$("openPromotion").onclick = () => {
  if (dirty || fichaDirty) { status("Guardá o descartá la ficha antes de promocionar."); return; }
  $("promotionStatus").textContent = "";
  renderPromotion();
  $("promotionDialog").showModal();
};
$("applyPromotion").onclick = async () => {
  const plan = promotionPlan();
  if (!plan.alumnos) return;
  if (dirty || fichaDirty) {
    $("promotionStatus").textContent = "Guardá o descartá la ficha antes de promocionar."; return;
  }
  const resumen = "Se promoverán " + plan.alumnos + " alumnos: " + plan.pasan + " pasan de grado, " +
    plan.permanecen + " permanecen y " + plan.egresan + " de 6.° pasan a la memoria " +
    (graduationYear || schoolYear) + ". Se guardará un respaldo antes de aplicar los cambios. ¿Continuar?";
  if (!confirm(resumen)) return;
  $("applyPromotion").disabled = true;
  $("promotionStatus").textContent = "Promoviendo grupos...";
  try {
    const result = await post("/api/promocion", { revision });
    revision = result.revision;
    $("promotionDialog").close();
    dirty = false; fichaDirty = false; pendingPoint = null; selectedId = null;
    $("grade").value = ""; $("location").value = ""; $("form").hidden = true;
    clearPreview();
    await loadData();
    $("fit").click();
    status("Promoción realizada: " + result.promovidos + " pasaron de grado · " + result.permanecen +
      " permanecen · " + result.egresados + " egresaron a la memoria " + result.anio_anterior +
      ". Respaldo: " + result.respaldo + ".");
  } catch (error) {
    $("promotionStatus").textContent = "No se pudo promover: " + error.message;
  } finally {
    renderPromotion();
  }
};

let memoryRequest = 0;
async function loadMemory(anio) {
  const request = ++memoryRequest, table = $("memoryTable");
  $("memoryInfo").textContent = "Cargando...";
  table.textContent = "";
  try {
    const data = await ApiApp.get("/api/memoria" + (anio ? "?anio=" + encodeURIComponent(anio) : ""));
    if (request !== memoryRequest) return;
    const select = $("memoryYear");
    select.textContent = "";
    data.anios.forEach(item => select.add(new Option(String(item.anio), String(item.anio))));
    if (data.anio != null) select.value = String(data.anio);
    select.disabled = !data.anios.length;
    if (data.anio == null) {
      $("memoryInfo").textContent = "Todavía no hay años guardados. La memoria se completa cuando promocionás los grupos y egresan los alumnos de 6.°.";
      return;
    }
    const year = data.anios.find(item => item.anio === data.anio);
    $("memoryInfo").textContent = "Año " + data.anio + " · " + (year ? year.alumnos : data.registros.length) +
      " alumnos · " + (year ? year.ubicados : 0) + " con ubicación guardada.";
    if (!data.registros.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No hay alumnos guardados para ese año.";
      table.appendChild(empty);
      return;
    }
    const grid = document.createElement("table");
    grid.className = "memory-table-data";
    const head = grid.createTHead().insertRow();
    ["Nombre", "DNI", "Curso", "Domicilio", "Teléfono"].forEach(text => {
      const cell = document.createElement("th");
      cell.textContent = text;
      head.appendChild(cell);
    });
    const body = grid.createTBody();
    data.registros.forEach(record => {
      const line = body.insertRow();
      [record.nombre, record.dni, record.grado, record.direccion, record.telefono].forEach(value => {
        const cell = line.insertCell();
        cell.textContent = value || "";
      });
    });
    table.appendChild(grid);
  } catch (error) {
    if (request === memoryRequest) $("memoryInfo").textContent = "No se pudo cargar la memoria: " + error.message;
  }
}
$("openMemory").onclick = () => {
  $("memoryDialog").showModal();
  loadMemory($("memoryYear").value ? Number($("memoryYear").value) : null);
};
$("memoryYear").onchange = () => loadMemory(Number($("memoryYear").value));

function loadStreets() {  clearTimeout(timer);
  const request = ++requestCounter;
  if (!$("showBase").checked && !$("showGrid").checked) return;
  timer = setTimeout(async () => {
    const b = map.getBounds();
    try {
      const data = await post("/api/calles", { bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
      if (request === requestCounter) {
        streetData = data;
        streetLayer.clearLayers(); streetLabels.clearLayers(); streetLayer.addData(data);
        if ($("showGrid").checked) updateGrid();
        if (map.getZoom() >= 14) {
          const cells = new Set();
          streetLayer.eachLayer(layer => {
            const name = layer.feature.properties.nombre, bounds = layer.getBounds();
            if (!name || !bounds.isValid()) return;
            const center = bounds.getCenter();
            if (!map.getBounds().contains(center)) return;
            const point = map.latLngToContainerPoint(center), cell = Math.floor(point.x / 100) + ":" + Math.floor(point.y / 35);
            if (cells.has(cell)) return;
            cells.add(cell);
            L.marker(center, { pane: "baseLabels", interactive: false, keyboard: false,
              icon: L.divIcon({ className: "street-name", html: escapeText(name), iconSize: [100, 18], iconAnchor: [50, 9] }) }).addTo(streetLabels);
          });
        }
      }
    } catch (error) { if (request === requestCounter) status("No se pudieron cargar las calles: " + error.message); }
  }, 200);
}
const GRID_STYLE = { pane: "baseGrid", color: "#666", weight: 1.6, opacity: 0.85, dashArray: "7 7", interactive: false };
// Igual que en la búsqueda de domicilios, no conviene prolongar una calle más
// de ~8 cuadras: más lejos la orientación deja de ser una referencia segura.
const MAX_GRID_CONTINUATION = 800;

function gridProjection() {
  const center = map.getCenter();
  const kx = 111320 * Math.cos(center.lat * Math.PI / 180), ky = 111320;
  const toXY = point => [(point[0] - center.lng) * kx, (point[1] - center.lat) * ky];
  const toLL = point => [center.lat + point[1] / ky, center.lng + point[0] / kx];
  const bounds = map.getBounds();
  const first = toXY([bounds.getWest(), bounds.getSouth()]), second = toXY([bounds.getEast(), bounds.getNorth()]);
  return {
    toXY, toLL,
    view: { minX: Math.min(first[0], second[0]), maxX: Math.max(first[0], second[0]),
      minY: Math.min(first[1], second[1]), maxY: Math.max(first[1], second[1]) }
  };
}

function gridSegments(toXY) {
  const result = [];
  for (const feature of (streetData && streetData.features) || []) {
    const geometry = feature.geometry || {}, name = (feature.properties && feature.properties.nombre) || "";
    const lines = geometry.type === "MultiLineString" ? geometry.coordinates
      : geometry.type === "LineString" ? [geometry.coordinates] : [];
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = toXY(line[i - 1]), b = toXY(line[i]);
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length >= 15) result.push({ a, b, length, name, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI });
      }
    }
  }
  return result;
}

// El número se usa sólo para interpolar entre calles numéricas consecutivas;
// las calles con nombre o BIS se rotulan con su propia denominación.
function gridStreetNumber(name) {
  const match = String(name || "").toUpperCase().match(/^(?:CALLE\s+)?(\d+)$/);
  return match ? Number(match[1]) : null;
}

function gridStreetLabel(name) {
  const match = String(name || "").toUpperCase().match(/\b\d+(?:\s+(?:BIS|[A-Z]))?\b/);
  return match ? match[0].replace(/\s+/g, " ") : "";
}

const gridAngle = value => ((value % 180) + 180) % 180;
const gridGap = (first, second) => {
  const gap = Math.abs(gridAngle(first) - gridAngle(second));
  return Math.min(gap, 180 - gap);
};
const gridMedian = values => {
  const sorted = [...values].sort((first, second) => first - second), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// La orientación dominante surge de las calles existentes; la grilla usa esa
// dirección y su perpendicular, como las manzanas del lugar.
function gridDominantAngle(segments) {
  const bins = new Array(36).fill(0);
  for (const segment of segments) bins[Math.floor(gridAngle(segment.angle) / 5) % 36] += segment.length;
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  const seed = best * 5 + 2.5;
  let x = 0, y = 0;
  for (const segment of segments) {
    if (gridGap(segment.angle, seed) > 15) continue;
    const angle = gridAngle(segment.angle) * Math.PI / 180;
    x += Math.cos(2 * angle) * segment.length;
    y += Math.sin(2 * angle) * segment.length;
  }
  return x || y ? gridAngle(Math.atan2(y, x) * 90 / Math.PI) : seed;
}

function gridAxes(segments, angle) {
  const radians = angle * Math.PI / 180;
  const direction = [Math.cos(radians), Math.sin(radians)], normal = [-Math.sin(radians), Math.cos(radians)];
  const items = segments.map(segment => {
    const start = segment.a[0] * direction[0] + segment.a[1] * direction[1];
    const end = segment.b[0] * direction[0] + segment.b[1] * direction[1];
    return {
      offset: ((segment.a[0] + segment.b[0]) * normal[0] + (segment.a[1] + segment.b[1]) * normal[1]) / 2,
      min: Math.min(start, end), max: Math.max(start, end), length: segment.length, name: segment.name
    };
  }).sort((first, second) => first.offset - second.offset);
  const axes = [];
  for (const item of items) {
    const last = axes[axes.length - 1];
    if (last && Math.abs(item.offset - last.offset) <= 30) {
      last.offset = (last.offset * last.length + item.offset * item.length) / (last.length + item.length);
      last.length += item.length;
      last.min = Math.min(last.min, item.min);
      last.max = Math.max(last.max, item.max);
      last.names.set(item.name, (last.names.get(item.name) || 0) + item.length);
    } else axes.push({ ...item, names: new Map([[item.name, item.length]]) });
  }
  for (const axis of axes) {
    let name = "", length = 0;
    for (const [candidate, weight] of axis.names) {
      if (weight > length) { name = candidate; length = weight; }
    }
    axis.name = name;
    axis.number = gridStreetNumber(name);
    axis.label = gridStreetLabel(name);
  }
  return { direction, normal, axes };
}

function gridRange(base, direction, view) {
  let low = -Infinity, high = Infinity;
  const bounds = [-direction[0], direction[0], -direction[1], direction[1]];
  const limits = [base[0] - view.minX, view.maxX - base[0], base[1] - view.minY, view.maxY - base[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(bounds[i]) < 1e-9) { if (limits[i] < 0) return null; continue; }
    const value = limits[i] / bounds[i];
    if (bounds[i] < 0) low = Math.max(low, value); else high = Math.min(high, value);
  }
  return low <= high ? [low, high] : null;
}

const gridPoint = (base, direction, value) => [base[0] + value * direction[0], base[1] + value * direction[1]];

function updateGrid() {
  const request = ++gridCounter;
  gridLayer.clearLayers();
  if (!$("showGrid").checked || !streetData) return;
  const projection = gridProjection();
  const segments = gridSegments(projection.toXY);
  if (!segments.length) return;
  const baseAngle = gridDominantAngle(segments);
  const families = [{ angle: baseAngle, segments: [] }, { angle: gridAngle(baseAngle + 90), segments: [] }];
  for (const segment of segments) {
    const gaps = families.map(family => gridGap(segment.angle, family.angle));
    const index = gaps[0] <= gaps[1] ? 0 : 1;
    if (gaps[index] <= 15) families[index].segments.push(segment);
  }
  const lines = [], axisLabels = [], labelTexts = new Set();
  for (const family of families) {
    if (request !== gridCounter) return;
    if (!family.segments.length) continue;
    const { direction, normal, axes } = gridAxes(family.segments, family.angle);
    if (!axes.length) continue;
    const chords = axes.map(axis => {
      const base = [normal[0] * axis.offset, normal[1] * axis.offset];
      return { axis, base, range: gridRange(base, direction, projection.view) };
    }).filter(item => item.range);
    const gaps = [];
    for (let i = 1; i < axes.length; i++) {
      const gap = axes[i].offset - axes[i - 1].offset;
      if (gap >= 40 && gap <= 400) gaps.push(gap);
    }
    const spacing = gaps.length ? gridMedian(gaps) : 0;
    const added = [];
    const hasAxis = offset => axes.some(axis => Math.abs(axis.offset - offset) <= 20);
    let numberDirection = 0;
    if (spacing >= 60) {
      const numbered = axes.filter(axis => axis.number !== null);
      if (numbered.length >= 2) {
        const meanOffset = numbered.reduce((sum, axis) => sum + axis.offset, 0) / numbered.length;
        const meanNumber = numbered.reduce((sum, axis) => sum + axis.number, 0) / numbered.length;
        let covariance = 0, variance = 0;
        for (const axis of numbered) {
          covariance += (axis.offset - meanOffset) * (axis.number - meanNumber);
          variance += (axis.offset - meanOffset) ** 2;
        }
        numberDirection = variance ? Math.sign(covariance) : 0;
      }
      // Las calles dibujadas sin nombre también reciben número estimado cuando
      // están a un paso de una calle numérica y la secuencia es consistente.
      const usedLabels = new Set(axes.map(axis => axis.label).filter(Boolean));
      if (numberDirection) {
        for (const axis of axes) {
          if (axis.label) continue;
          let nearest = null;
          for (const neighbor of axes) {
            if (neighbor === axis || neighbor.number === null) continue;
            const gap = Math.abs(neighbor.offset - axis.offset);
            if (gap < spacing * 0.6 || gap > spacing * 1.6) continue;
            if (!nearest || gap < nearest.gap) nearest = { neighbor, gap };
          }
          if (!nearest) continue;
          const number = nearest.neighbor.number + Math.sign(axis.offset - nearest.neighbor.offset) * numberDirection;
          if (number <= 0 || usedLabels.has(String(number))) continue;
          axis.label = String(number);
          axis.inferred = true;
          usedLabels.add(axis.label);
        }
      }
      for (let i = 1; i < axes.length; i++) {
        const first = axes[i - 1], second = axes[i], gap = second.offset - first.offset;
        if (gap <= spacing * 1.9 || gap >= spacing * 6) continue;
        const count = Math.min(4, Math.max(1, Math.round(gap / spacing) - 1));
        const numberedPair = first.number !== null && second.number !== null &&
          Math.abs(second.number - first.number) === count + 1;
        for (let k = 1; k <= count; k++) {
          const offset = first.offset + gap * k / (count + 1);
          if (hasAxis(offset)) continue;
          const number = numberedPair ? Math.round(first.number + (second.number - first.number) * k / (count + 1)) : null;
          added.push({ offset, text: number === null ? "" : number + " est." });
        }
      }
      for (const side of [-1, 1]) {
        const edge = side < 0 ? axes[0] : axes[axes.length - 1];
        let text = "";
        if (edge.number !== null && numberDirection) text = (edge.number + side * numberDirection) + " est.";
        const offset = edge.offset + side * spacing;
        if (!hasAxis(offset)) added.push({ offset, text });
      }
    }
    for (const item of chords) {
      const [low, high] = item.range;
      if (item.axis.min > low && Math.min(item.axis.min, high) - low <= MAX_GRID_CONTINUATION) {
        lines.push({ from: gridPoint(item.base, direction, low), to: gridPoint(item.base, direction, Math.min(item.axis.min, high)), axis: item.axis });
      }
      if (item.axis.max < high && high - Math.max(item.axis.max, low) <= MAX_GRID_CONTINUATION) {
        lines.push({ from: gridPoint(item.base, direction, Math.max(item.axis.max, low)), to: gridPoint(item.base, direction, high), axis: item.axis });
      }
      if (item.axis.inferred) {
        const middle = (low + high) / 2;
        axisLabels.push({ point: projection.toLL(gridPoint(item.base, direction, middle)), text: item.axis.label + " est." });
      }
    }
    for (const item of added) {
      const base = [normal[0] * item.offset, normal[1] * item.offset];
      const range = gridRange(base, direction, projection.view);
      if (range) lines.push({ from: gridPoint(base, direction, range[0]), to: gridPoint(base, direction, range[1]), added: true, label: item.text });
    }
  }
  let drawnLines = 0;
  const candidates = [];
  for (const line of lines) {
    if (drawnLines >= 300) break;
    const length = Math.hypot(line.to[0] - line.from[0], line.to[1] - line.from[1]);
    if (length < 25) continue;
    gridLayer.addLayer(L.polyline([projection.toLL(line.from), projection.toLL(line.to)],
      line.added ? { ...GRID_STYLE, color: "#111", weight: 2.4 } : GRID_STYLE));
    drawnLines++;
    if (length < 60) continue;
    // En los ejes deducidos el rótulo central (axisLabels) ubica mejor el número.
    if (line.axis && line.axis.inferred) continue;
    const text = line.added ? line.label
      : line.axis && line.axis.label ? line.axis.label + " est." : "";
    if (!text || labelTexts.has(text)) continue;
    labelTexts.add(text);
    // El origen de la proyección es el centro del mapa: se ancla el rótulo en
    // el punto de la línea más cercano al centro, no en un extremo lejano.
    const dx = line.to[0] - line.from[0], dy = line.to[1] - line.from[1];
    const near = Math.max(0, Math.min(1, -(line.from[0] * dx + line.from[1] * dy) / (dx * dx + dy * dy || 1)));
    candidates.push({ point: projection.toLL([line.from[0] + near * dx, line.from[1] + near * dy]), text });
  }
  for (const label of axisLabels) {
    if (labelTexts.has(label.text)) continue;
    labelTexts.add(label.text);
    candidates.push(label);
  }
  // Los números se muestran en todos los zooms; si dos se superponen, se
  // conserva el más cercano al centro del mapa para que sigan siendo legibles.
  const center = map.latLngToContainerPoint(map.getCenter());
  const distanceToCenter = item => {
    const point = map.latLngToContainerPoint(item.point);
    return Math.hypot(point.x - center.x, point.y - center.y);
  };
  candidates.sort((first, second) => distanceToCenter(first) - distanceToCenter(second));
  const placed = [];
  for (const label of candidates) {
    if (placed.length >= 40) break;
    const point = map.latLngToContainerPoint(label.point);
    const width = Math.round(label.text.length * 6.2) + 12;
    const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - 8, bottom: point.y + 8 };
    if (placed.some(other => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom)) continue;
    placed.push(box);
    L.marker(label.point, { pane: "baseLabels", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "grid-name", html: escapeText(label.text), iconSize: [width, 16], iconAnchor: [width / 2, 8] }) })
      .addTo(gridLayer);
  }
}

$("showGrid").addEventListener("change", event => {
  if (event.target.checked) {
    gridLayer.addTo(map);
    if (streetData) updateGrid();
    loadStreets();
  } else {
    map.removeLayer(gridLayer);
    gridLayer.clearLayers();
  }
});

for (const [id, ruta] of [["exportExcel", "/api/exportar.xlsx"], ["exportGeoJSON", "/api/exportar.geojson"]]) {
  $(id).addEventListener("click", event => {
    if (!ApiApp.local) return;
    event.preventDefault();
    ApiApp.descargar(ruta).catch(error => status("No se pudo exportar: " + error.message));
  });
}

// Salir: en el teléfono cierra la app; en la PC detiene el servidor local.
function mostrarPantallaCerrada() {
  document.body.textContent = "";
  const box = document.createElement("div"), title = document.createElement("h1"), text = document.createElement("p");
  box.className = "pantalla-cerrada";
  title.textContent = "LA 39";
  text.textContent = "La aplicación se cerró. Podés cerrar esta ventana.";
  box.append(title, text);
  document.body.appendChild(box);
}

$("salirApp").onclick = async () => {
  if (!confirm("¿Cerrar LA 39?")) return;
  if (window.AndroidApp && typeof window.AndroidApp.salir === "function") {
    window.AndroidApp.salir();
    return;
  }
  const boton = $("salirApp");
  boton.disabled = true;
  try {
    if (window.ApiApp && !ApiApp.local) await ApiApp.post("/api/salir", {});
  } catch (error) {
    boton.disabled = false;
    status("No se pudo cerrar: " + error.message);
    return;
  }
  mostrarPantallaCerrada();
};

$("exportGrade").onclick = () => {
  const grade = $("grade").value;
  if (!grade) { status("Elegí un grado para descargar su Excel."); return; }
  const ruta = "/api/exportar.xlsx?grado=" + encodeURIComponent(grade);
  if (ApiApp.local) ApiApp.descargar(ruta).catch(error => status("No se pudo exportar: " + error.message));
  else location.href = ruta;
};

map.on("moveend", loadStreets);
function setupMoreMenu() {
  const menu = $("moreMenu"), panel = $("morePanel"), toggle = $("moreToggle");
  if (!menu || !panel || !toggle) return;
  const close = () => {
    panel.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    panel.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    const first = panel.querySelector("a, button");
    if (first) first.focus({ preventScroll: true });
  };
  toggle.addEventListener("click", event => {
    event.stopPropagation();
    if (panel.classList.contains("open")) close(); else open();
  });
  menu.addEventListener("click", event => {
    if (event.target !== toggle && event.target.closest("a, button")) close();
  });
  document.addEventListener("click", event => {
    if (!menu.contains(event.target)) close();
  });
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape") { close(); toggle.focus(); }
  });
  window.addEventListener("resize", () => { if (!esTelefono()) close(); });
}

let toquesCreditos = 0;
let temporizadorToquesCreditos = null;
let temporizadorCreditos = null;

function cerrarCreditos() {
  clearTimeout(temporizadorCreditos);
  const dialogo = $("creditosDialog");
  if (dialogo && dialogo.open) dialogo.close();
}

function mostrarCreditos() {
  const dialogo = $("creditosDialog");
  if (!dialogo) return;
  if (!dialogo.open) dialogo.showModal();
  clearTimeout(temporizadorCreditos);
  temporizadorCreditos = setTimeout(cerrarCreditos, 7000);
}

function tocarCreditos() {
  toquesCreditos++;
  clearTimeout(temporizadorToquesCreditos);
  temporizadorToquesCreditos = setTimeout(() => { toquesCreditos = 0; }, 1500);
  if (toquesCreditos >= 4) {
    toquesCreditos = 0;
    clearTimeout(temporizadorToquesCreditos);
    mostrarCreditos();
  }
}

function setupCreditos() {
  const marca = $("creditos39"), dialogo = $("creditosDialog");
  if (!marca || !dialogo) return;
  marca.addEventListener("click", tocarCreditos);
  dialogo.addEventListener("click", cerrarCreditos);
  dialogo.addEventListener("close", () => clearTimeout(temporizadorCreditos));
}

$("clearFilters").addEventListener("click", clearFilters);
$("quitarFiltroSalida").addEventListener("click", quitarFiltroSalida);
window.aplicarFiltroSalida = aplicarFiltroSalida;
setupMoreMenu();
setupCreditos();
setupStatsToggle();
setupSplitter();
setupViewToggle();
loadBase();
loadStreets();
loadData().then(() => {
  map.invalidateSize();
  $("fit").click();
  status((ApiApp.local ? "Base local lista. " : "Base conectada. ") + "Elegí un alumno o importá un Excel.");
}).catch(error => status("Error al abrir la base: " + error.message));
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
