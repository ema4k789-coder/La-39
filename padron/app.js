"use strict";
(function() {
  const T = window.TextoPadron;
  const Almacen = window.AlmacenPadron;
  const Excel = window.ExcelPadron;
  const Act = window.ActualizacionPadron;
  const Integracion = window.IntegracionPadron;
  const $ = id => document.getElementById(id);
  const $$ = (selector, raiz) => Array.from((raiz || document).querySelectorAll(selector));
  const GRADOS = ["1", "2", "3", "4", "5", "6"];
  const DIVISIONES = ["A", "B", "C", "D"];
  const CLAVES_COMPLETAS = ["dni", "nacimiento", "direccion", "telefono", "responsable"];
  const CLAVES_TEXTO = ["nombre", "dni", "nacimiento", "direccion", "telefono", "responsable", "nacionalidad", "actividad", "observaciones"];
  const VISTAS = { alumnos: "vistaAlumnos", cursos: "vistaCursos", estadisticas: "vistaEstadisticas", datos: "vistaDatos" };
  const IGNORAR_CONSULTA = new Set(["y", "e", "de", "del", "la", "las", "los", "el", "n", "nro", "num", "numero"]);
  const CLAVE_GUARDADO = "ep39.padron.guardado";
  const CLAVE_ETIQUETAS = "ep39.padron.etiquetas.v1";
  const ETIQUETAS_BASE = ["Proyecto de integración", "Cambio de trayectorias", "Viene de otra institución", "Repitente"];

  let datos;
  let indice = new Map();
  let filtros = filtrosIniciales();
  let vistaActual = "alumnos";
  let alumnoEditando = null;
  let armadoEliminar = false;
  let temporizadorEliminar = null;
  let filaArmada = null;
  let temporizadorFila = null;
  let armadoRestaurar = false;
  let temporizadorRestaurar = null;
  let copiaPendiente = null;
  let importacion = null;
  let temporizadorBusqueda = null;
  let temporizadorSincronizacion = null;
  let cursoImportacion = { grado: "1", division: "A" };
  let actualizacionPendiente = null;
  let armadoReemplazo = false;
  let temporizadorReemplazo = null;
  let etiquetasPadron = [];
  let toquesCreditos = 0;
  let temporizadorToquesCreditos = null;
  let temporizadorCreditos = null;

  const guardadoPrevio = Almacen.cargar();
  datos = guardadoPrevio || Almacen.inicial();
  if (!guardadoPrevio) {
    Almacen.guardar(datos);
    try {
      localStorage.setItem(CLAVE_GUARDADO, new Date().toISOString());
    } catch (error) {
      // Sin espacio o almacenamiento bloqueado: la app sigue funcionando en memoria.
    }
  }

  function filtrosIniciales() {
    return { consulta: "", grado: "", division: "", faltantes: new Set(), orden: "apellido" };
  }

  function crear(etiqueta, clase, texto) {
    const elemento = document.createElement(etiqueta);
    if (clase) elemento.className = clase;
    if (texto !== undefined && texto !== null) elemento.textContent = String(texto);
    return elemento;
  }

  function palabras(texto) {
    const limpio = T.normalizar(texto);
    return limpio ? limpio.split(" ") : [];
  }

  function cursoClave(alumno) {
    return String(alumno.grado) + String(alumno.division).toUpperCase();
  }

  function cursoValido(grado, division) {
    return /^[1-6]$/.test(String(grado)) && /^[A-D]$/.test(String(division));
  }

  function iniciales(nombre) {
    const partes = T.tokens(nombre).slice(0, 2);
    return partes.length ? partes.map(parte => parte.charAt(0).toUpperCase()).join("") : "?";
  }

  function fechaHora(valor) {
    if (!valor) return "—";
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return String(valor);
    return fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " · " + fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }

  function tokensConsulta(texto) {
    return T.tokens(texto).filter(token => token && !IGNORAR_CONSULTA.has(token));
  }

  function consultaApuntaADocumento(texto) {
    const letras = T.normalizar(String(texto || "").replace(/\d/g, " "));
    if (!letras) return true;
    const permitidas = new Set(["dni", "documento", "doc", "cuil", "tel", "telefono", "cel", "celular", "numero", "nro"]);
    return letras.split(" ").filter(Boolean).every(palabra => permitidas.has(palabra));
  }

  function cursoDeConsulta(texto) {
    const ordinales = { primero: "1", segundo: "2", tercero: "3", cuarto: "4", quinto: "5", sexto: "6" };
    const piezas = T.normalizar(texto).split(" ").filter(pieza => pieza && !["grado", "division", "div"].includes(pieza));
    const numero = pieza => /^[1-6]$/.test(pieza) ? pieza : ordinales[pieza] || "";
    if (piezas.length === 1) {
      const unido = piezas[0].match(/^([1-6])([a-d])$/);
      if (unido) return { grado: unido[1], division: unido[2].toUpperCase() };
      const grado = numero(piezas[0]);
      return grado ? { grado, division: "" } : null;
    }
    if (piezas.length === 2) {
      const grado = numero(piezas[0]);
      if (grado && /^[a-d]$/.test(piezas[1])) return { grado, division: piezas[1].toUpperCase() };
    }
    return null;
  }

  function guardarCambios() {
    const listo = Almacen.guardar(datos);
    if (listo) {
      try {
        localStorage.setItem(CLAVE_GUARDADO, new Date().toISOString());
      } catch (error) {
        // El padrón principal ya se guardó; la marca de fecha es secundaria.
      }
    }
    return listo;
  }

  function reconstruirIndice() {
    indice = new Map();
    datos.alumnos.forEach(alumno => {
      const nombre = T.normalizar(alumno.nombre);
      const curso = [
        alumno.grado, String(alumno.division).toLowerCase(),
        (String(alumno.grado) + String(alumno.division)).toLowerCase(),
        T.tokensCurso(alumno.grado, alumno.division)[3],
        "grado " + alumno.grado, "division " + String(alumno.division).toLowerCase(),
        T.normalizar(T.etiquetaCurso(alumno.grado, alumno.division))
      ].join(" ");
      const direccion = T.normalizar(alumno.direccion) + " " + T.tokensDireccion(alumno.direccion, true).join(" ");
      const responsable = T.normalizar(alumno.responsable);
      const extra = T.normalizar([alumno.nacionalidad, alumno.actividad, alumno.observaciones].join(" "));
      indice.set(alumno.id, {
        nombre,
        nombrePalabras: palabras(nombre),
        curso,
        cursoPalabras: palabras(curso),
        direccion,
        direccionPalabras: palabras(direccion),
        responsable,
        responsablePalabras: palabras(responsable),
        extra,
        extraPalabras: palabras(extra),
        dni: T.normalizarDni(alumno.dni),
        telefono: String(alumno.telefono || "").replace(/\D/g, "")
      });
    });
  }

  function algunaPalabraEmpieza(lista, token) {
    return lista.some(palabra => palabra.startsWith(token));
  }

  function coincideToken(registro, token, buscaDocumento) {
    if (!registro) return false;
    if (/^\d+$/.test(token)) {
      const enNumero = registro.cursoPalabras.includes(token) ||
        registro.direccionPalabras.some(palabra => palabra === token ||
          (token.length >= 3 && palabra.startsWith(token)));
      const enDocumento = (buscaDocumento || token.length >= 5) &&
        (registro.dni.includes(token) || registro.telefono.includes(token));
      return enNumero || enDocumento;
    }
    const canonico = T.tokenDireccion(token);
    const variantes = canonico === token ? [token] : [token, canonico];
    if (token.length === 1) {
      return registro.cursoPalabras.includes(token) ||
        registro.nombrePalabras.includes(token) ||
        registro.direccionPalabras.includes(token) ||
        registro.responsablePalabras.includes(token) ||
        registro.extraPalabras.includes(token);
    }
    for (const variante of variantes) {
      if (token.length <= 2) {
        if (algunaPalabraEmpieza(registro.nombrePalabras, variante) ||
            algunaPalabraEmpieza(registro.cursoPalabras, variante) ||
            algunaPalabraEmpieza(registro.direccionPalabras, variante) ||
            algunaPalabraEmpieza(registro.responsablePalabras, variante) ||
            algunaPalabraEmpieza(registro.extraPalabras, variante)) return true;
      } else {
        if (registro.nombre.includes(variante) ||
            registro.curso.includes(variante) ||
            registro.direccion.includes(variante) ||
            registro.responsable.includes(variante) ||
            registro.extra.includes(variante)) return true;
      }
    }
    return false;
  }

  function alumnosFiltrados() {
    const tokens = tokensConsulta(filtros.consulta);
    const buscaDocumento = consultaApuntaADocumento(filtros.consulta);
    const cursoConsulta = cursoDeConsulta(filtros.consulta);
    const faltantes = filtros.faltantes;
    const lista = datos.alumnos.filter(alumno => {
      if (filtros.grado && String(alumno.grado) !== filtros.grado) return false;
      if (filtros.division && String(alumno.division).toUpperCase() !== filtros.division) return false;
      if (cursoConsulta) {
        if (String(alumno.grado) !== cursoConsulta.grado) return false;
        if (cursoConsulta.division && String(alumno.division).toUpperCase() !== cursoConsulta.division) return false;
      }
      if (faltantes.has("dni") && alumno.dni) return false;
      if (faltantes.has("direccion") && alumno.direccion) return false;
      if (faltantes.has("nacimiento") && alumno.nacimiento) return false;
      if (!tokens.length) return true;
      const registro = indice.get(alumno.id);
      return tokens.every(token => coincideToken(registro, token, buscaDocumento));
    });
    lista.sort(compararAlumnos);
    return lista;
  }

  function compararAlumnos(uno, otro) {
    const nombreUno = T.normalizar(uno.nombre);
    const nombreOtro = T.normalizar(otro.nombre);
    if (filtros.orden === "curso") {
      return (String(uno.grado) + String(uno.division)).localeCompare(String(otro.grado) + String(otro.division), "es", { numeric: true }) ||
        nombreUno.localeCompare(nombreOtro, "es");
    }
    if (filtros.orden === "nacimiento") {
      if (!uno.nacimiento && !otro.nacimiento) return nombreUno.localeCompare(nombreOtro, "es");
      if (!uno.nacimiento) return 1;
      if (!otro.nacimiento) return -1;
      return uno.nacimiento.localeCompare(otro.nacimiento) || nombreUno.localeCompare(nombreOtro, "es");
    }
    if (filtros.orden === "modificado") {
      return String(otro.modificado || "").localeCompare(String(uno.modificado || "")) ||
        nombreUno.localeCompare(nombreOtro, "es");
    }
    return nombreUno.localeCompare(nombreOtro, "es", { sensitivity: "base" });
  }

  function sincronizarFiltros() {
    $("buscar").value = filtros.consulta;
    $("limpiarBusqueda").classList.toggle("oculto", !filtros.consulta);
    $$("#chipsGrado .chip").forEach(chip => {
      const activo = chip.dataset.grado === filtros.grado;
      chip.classList.toggle("activo", activo);
      chip.setAttribute("aria-pressed", activo ? "true" : "false");
    });
    $("filtroDivision").value = filtros.division;
    $("orden").value = filtros.orden;
    $$(".chip-faltante").forEach(chip => {
      const activo = filtros.faltantes.has(chip.dataset.falta);
      chip.classList.toggle("activo", activo);
      chip.setAttribute("aria-pressed", activo ? "true" : "false");
    });
    const conFiltros = Boolean(filtros.consulta || filtros.grado || filtros.division ||
      filtros.faltantes.size || filtros.orden !== "apellido");
    $("limpiarFiltros").classList.toggle("oculto", !conFiltros);
  }

  function renderAlumnos() {
    const lista = alumnosFiltrados();
    const total = datos.alumnos.length;
    $("contadorAlumnos").textContent = total;
    const contenedor = $("listaAlumnos");
    contenedor.textContent = "";
    const fragmento = document.createDocumentFragment();
    lista.forEach(alumno => fragmento.appendChild(filaAlumno(alumno)));
    contenedor.appendChild(fragmento);
    contenedor.classList.toggle("oculto", lista.length === 0);
    const vacio = $("sinResultados");
    vacio.classList.toggle("oculto", lista.length > 0);
    if (!lista.length) {
      const titulo = vacio.querySelector("h2");
      const texto = vacio.querySelector("p");
      const boton = $("btnLimpiarVacio");
      if (!total) {
        titulo.textContent = "El padrón está vacío";
        texto.textContent = "Agregá un alumno o importá un Excel de un curso.";
        boton.textContent = "Agregar alumno";
      } else {
        titulo.textContent = "No encontré alumnos";
        texto.textContent = "Probá con otro nombre, DNI, dirección o curso.";
        boton.textContent = "Ver todos";
      }
    }
    renderResumen(lista.length);
  }

  const ICONO_EDITAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  const ICONO_ELIMINAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

  function botonFila(accion, icono, etiqueta, peligro) {
    const boton = crear("button", "fila-accion" + (peligro ? " peligro" : ""));
    boton.type = "button";
    boton.dataset.accion = accion;
    boton.title = etiqueta;
    boton.setAttribute("aria-label", etiqueta);
    boton.innerHTML = icono;
    return boton;
  }

  function filaAlumno(alumno) {
    const item = crear("li", "fila-alumno");
    const boton = crear("button", "fila-boton");
    boton.type = "button";
    boton.dataset.id = alumno.id;
    boton.setAttribute("aria-label", alumno.nombre + ", " + T.etiquetaCurso(alumno.grado, alumno.division) + ". Abrir ficha.");

    const avatar = crear("span", "avatar", iniciales(alumno.nombre));
    if (!alumno.dni || !alumno.direccion) avatar.classList.add("incompleto");
    avatar.setAttribute("aria-hidden", "true");

    const caja = crear("span", "fila-datos");
    caja.appendChild(crear("span", "fila-nombre", alumno.nombre));

    const meta = crear("span", "fila-meta");
    const dni = crear("span", "dato" + (alumno.dni ? "" : " falta"), alumno.dni ? T.formatearDni(alumno.dni) : "Sin DNI");
    const direccion = crear("span", "dato direccion" + (alumno.direccion ? "" : " falta"), alumno.direccion || "Sin dirección");
    if (alumno.direccion) direccion.title = alumno.direccion;
    meta.append(dni, crear("span", "separador", "·"), direccion);
    caja.appendChild(meta);

    const curso = crear("span", "curso-pill", T.etiquetaCurso(alumno.grado, alumno.division));
    const chevron = crear("span", "chevron", "›");
    chevron.setAttribute("aria-hidden", "true");

    boton.append(avatar, caja, curso, chevron);

    const acciones = crear("span", "fila-acciones");
    const editar = botonFila("editar", ICONO_EDITAR, "Editar a " + alumno.nombre);
    const eliminar = botonFila("eliminar", ICONO_ELIMINAR, "Eliminar a " + alumno.nombre, true);
    editar.dataset.id = alumno.id;
    eliminar.dataset.id = alumno.id;
    eliminar.dataset.nombre = alumno.nombre;
    acciones.append(editar, eliminar);

    item.append(boton, acciones);
    return item;
  }

  function renderResumen(cantidad) {
    const total = datos.alumnos.length;
    const cursos = new Set(datos.alumnos.map(cursoClave)).size;
    const resumen = $("resumenResultados");
    if (!filtros.consulta && !filtros.grado && !filtros.division && !filtros.faltantes.size) {
      resumen.textContent = total
        ? total + " alumnos · " + cursos + " cursos · Año " + datos.anio
        : "Sin alumnos cargados";
      return;
    }
    const partes = [];
    if (filtros.grado) {
      partes.push(filtros.division ? T.etiquetaCurso(filtros.grado, filtros.division) : filtros.grado + "° grado");
    } else if (filtros.division) {
      partes.push("División " + filtros.division);
    }
    if (filtros.faltantes.size) {
      partes.push("sin " + Array.from(filtros.faltantes).map(clave =>
        clave === "dni" ? "DNI" : clave === "direccion" ? "dirección" : "nacimiento").join(" y "));
    }
    if (filtros.consulta) partes.push("“" + filtros.consulta + "”");
    resumen.textContent = cantidad + " de " + total + " · " + partes.join(" · ");
  }

  function destacar(id) {
    requestAnimationFrame(() => {
      const boton = $("listaAlumnos").querySelector('[data-id="' + CSS.escape(id) + '"]');
      if (!boton) return;
      boton.classList.add("destacado");
      boton.scrollIntoView({ block: "center" });
      setTimeout(() => boton.classList.remove("destacado"), 1800);
    });
  }

  function renderCursos() {
    const grilla = $("grillaCursos");
    grilla.textContent = "";
    const fragmento = document.createDocumentFragment();
    GRADOS.forEach(grado => {
      DIVISIONES.forEach(division => {
        const alumnos = datos.alumnos.filter(alumno =>
          String(alumno.grado) === grado && String(alumno.division).toUpperCase() === division);
        const conDni = alumnos.filter(alumno => alumno.dni).length;
        const porcentaje = alumnos.length ? Math.round(conDni * 100 / alumnos.length) : 0;
        const tarjeta = crear("article", "tarjeta-curso");
        tarjeta.dataset.grado = grado;
        tarjeta.dataset.division = division;

        const fila = crear("div", "curso-fila");
        fila.appendChild(crear("span", "curso-nombre", T.etiquetaCurso(grado, division)));
        fila.appendChild(crear("span", "curso-cantidad", alumnos.length + (alumnos.length === 1 ? " alumno" : " alumnos")));

        const barra = crear("div", "curso-barra");
        const relleno = crear("span");
        relleno.style.width = porcentaje + "%";
        barra.appendChild(relleno);
        barra.setAttribute("aria-hidden", "true");

        const detalle = crear("p", "curso-detalle", conDni + " de " + alumnos.length + " con DNI · " + porcentaje + " %");

        const acciones = crear("div", "curso-acciones");
        acciones.append(
          botonAccion("ver", "Ver"),
          botonAccion("importar", "Importar"),
          botonAccion("exportar", "Exportar")
        );

        tarjeta.append(fila, barra, detalle, acciones);
        fragmento.appendChild(tarjeta);
      });
    });
    grilla.appendChild(fragmento);
    const conAlumnos = new Set(datos.alumnos.map(cursoClave)).size;
    $("resumenCursos").textContent = "24 divisiones · " + conAlumnos + " con alumnos · " + datos.alumnos.length + " en total";
    $("contadorAlumnos").textContent = datos.alumnos.length;
  }

  function botonAccion(accion, texto) {
    const boton = crear("button", "boton", texto);
    boton.type = "button";
    boton.dataset.accion = accion;
    return boton;
  }

  function renderEstadisticas() {
    const total = datos.alumnos.length;
    const cuentas = { dni: 0, nacimiento: 0, direccion: 0, telefono: 0, responsable: 0, completos: 0 };
    datos.alumnos.forEach(alumno => {
      CLAVES_COMPLETAS.forEach(clave => {
        if (alumno[clave]) cuentas[clave]++;
      });
      if (CLAVES_COMPLETAS.every(clave => alumno[clave])) cuentas.completos++;
    });
    const cursos = new Set(datos.alumnos.map(cursoClave)).size;

    const tarjetas = $("tarjetasStats");
    tarjetas.textContent = "";
    [
      { rotulo: "Alumnos", valor: total, detalle: cursos + " cursos con alumnos" },
      { rotulo: "Ficha completa", valor: T.formatearPorcentaje(cuentas.completos, total), detalle: cuentas.completos + " de " + total },
      { rotulo: "Con DNI", valor: T.formatearPorcentaje(cuentas.dni, total), detalle: "Faltan " + (total - cuentas.dni) },
      { rotulo: "Con dirección", valor: T.formatearPorcentaje(cuentas.direccion, total), detalle: "Faltan " + (total - cuentas.direccion) }
    ].forEach(dato => {
      const tarjeta = crear("div", "tarjeta-stat");
      tarjeta.appendChild(crear("span", "rotulo", dato.rotulo));
      tarjeta.appendChild(crear("strong", "valor", dato.valor));
      tarjeta.appendChild(crear("span", "detalle", dato.detalle));
      tarjetas.appendChild(tarjeta);
    });

    renderTarjetasGrado();

    renderBarras($("barrasDivision"), DIVISIONES.map(division => ({
      clave: division,
      etiqueta: division,
      cantidad: datos.alumnos.filter(alumno => String(alumno.division).toUpperCase() === division).length
    })));

  }

  function renderTarjetasGrado() {
    const contenedor = $("tarjetasGrado");
    contenedor.textContent = "";
    GRADOS.forEach(grado => {
      const alumnos = datos.alumnos.filter(alumno => String(alumno.grado) === grado);
      const total = alumnos.length;
      const completos = alumnos.filter(alumno => CLAVES_COMPLETAS.every(clave => alumno[clave])).length;
      const tarjeta = crear("article", "tarjeta-grado");

      const cabecera = crear("div", "grado-cabecera");
      cabecera.appendChild(crear("h4", "grado-numero", grado + "°"));
      cabecera.appendChild(crear("span", "grado-total", total + (total === 1 ? " alumno" : " alumnos")));
      tarjeta.appendChild(cabecera);

      const divisiones = DIVISIONES.map(division => {
        const cantidad = alumnos.filter(alumno =>
          String(alumno.division).toUpperCase() === division).length;
        return cantidad ? division + " " + cantidad : "";
      }).filter(Boolean).join(" · ");
      tarjeta.appendChild(crear("p", "grado-divisiones", divisiones || "Sin alumnos"));

      const lista = crear("dl", "grado-datos");
      [
        ["DNI", alumnos.filter(alumno => alumno.dni).length],
        ["Dirección", alumnos.filter(alumno => alumno.direccion).length],
        ["Nacimiento", alumnos.filter(alumno => alumno.nacimiento).length],
        ["Ficha completa", completos]
      ].forEach(([rotulo, cantidad]) => {
        const grupo = crear("div");
        grupo.appendChild(crear("dt", null, rotulo));
        grupo.appendChild(crear("dd", null, cantidad + "/" + total + " · " +
          T.formatearPorcentaje(cantidad, total)));
        lista.appendChild(grupo);
      });
      tarjeta.appendChild(lista);

      const barra = crear("div", "grado-barra");
      barra.setAttribute("aria-hidden", "true");
      const relleno = crear("span");
      relleno.style.width = (total ? Math.round(completos * 100 / total) : 0) + "%";
      barra.appendChild(relleno);
      tarjeta.appendChild(barra);

      contenedor.appendChild(tarjeta);
    });
  }

  function renderBarras(contenedor, grupos) {
    contenedor.textContent = "";
    const maximo = Math.max(1, ...grupos.map(grupo => grupo.cantidad));
    grupos.forEach(grupo => {
      const fila = crear("div", "barra-fila");
      fila.setAttribute("aria-label", grupo.etiqueta + ": " + grupo.cantidad + " alumnos");
      fila.appendChild(crear("span", "barra-etiqueta", grupo.etiqueta));
      const pista = crear("div", "barra-pista");
      pista.setAttribute("aria-hidden", "true");
      const relleno = crear("span");
      relleno.style.width = Math.round(grupo.cantidad * 100 / maximo) + "%";
      pista.appendChild(relleno);
      fila.appendChild(pista);
      fila.appendChild(crear("span", "barra-valor", grupo.cantidad));
      contenedor.appendChild(fila);
    });
  }

  function renderDatos() {
    $("anioLectivo").value = datos.anio;
    const total = datos.alumnos.length;
    const cursos = new Set(datos.alumnos.map(cursoClave)).size;
    const conDni = datos.alumnos.filter(alumno => alumno.dni).length;
    $("infoAlumnos").textContent = total + " alumnos · " + cursos + " cursos · " +
      T.formatearPorcentaje(conDni, total) + " con DNI.";
    $("infoFuente").textContent = datos.fuente || "Actualización inicial";
    $("infoGenerado").textContent = fechaHora(datos.generado);
    let ultimo = "";
    try {
      ultimo = localStorage.getItem(CLAVE_GUARDADO) || "";
    } catch (error) {
      ultimo = "";
    }
    $("infoGuardado").textContent = fechaHora(ultimo);
  }

  function actualizarAnio() {
    $("anioCabecera").textContent = datos.anio;
    $("etiquetaAnio").textContent = "Año " + datos.anio;
    document.title = "Padrón " + datos.anio + " · Escuela Primaria 39";
  }

  function refrescarTodo() {
    reconstruirIndice();
    renderAlumnos();
    renderCursos();
    renderEstadisticas();
    renderDatos();
    actualizarAnio();
  }

  function mostrarVista(nombre, actualizarHash) {
    if (!VISTAS[nombre]) nombre = "alumnos";
    vistaActual = nombre;
    $$(".pestanas button").forEach(boton => {
      const activa = boton.dataset.vista === nombre;
      boton.setAttribute("aria-selected", activa ? "true" : "false");
      boton.tabIndex = activa ? 0 : -1;
    });
    Object.keys(VISTAS).forEach(clave => {
      const seccion = $(VISTAS[clave]);
      const activa = clave === nombre;
      seccion.classList.toggle("activa", activa);
      seccion.hidden = !activa;
    });
    if (nombre === "cursos") renderCursos();
    if (nombre === "estadisticas") renderEstadisticas();
    if (nombre === "datos") renderDatos();
    if (actualizarHash !== false) {
      try {
        history.replaceState(null, "", "#" + nombre);
      } catch (error) {
        // En algunos contextos no se puede cambiar la dirección; no es importante.
      }
    }
  }

  function vistaDesdeHash() {
    const nombre = (location.hash || "").replace("#", "");
    return VISTAS[nombre] ? nombre : "alumnos";
  }

  function aviso(texto, tipo) {
    const host = $("avisos");
    const dialogo = document.querySelector("dialog[open]");
    if (dialogo) {
      if (host.parentElement !== dialogo) dialogo.appendChild(host);
    } else if (host.parentElement !== document.body) {
      document.body.appendChild(host);
    }
    const elemento = crear("div", "toast" + (tipo ? " " + tipo : ""));
    elemento.setAttribute("role", tipo === "error" ? "alert" : "status");
    const contenido = crear("span", "toast-texto", texto);
    const cerrar = crear("button", "toast-cerrar", "×");
    cerrar.type = "button";
    cerrar.setAttribute("aria-label", "Cerrar aviso");
    cerrar.addEventListener("click", () => elemento.remove());
    elemento.append(contenido, cerrar);
    host.appendChild(elemento);
    while (host.children.length > 3) host.firstElementChild.remove();
    setTimeout(() => elemento.remove(), 6500);
  }

  function moverAvisosAlCuerpo() {
    const host = $("avisos");
    if (host.parentElement !== document.body) document.body.appendChild(host);
  }

  function cerrarCreditos() {
    clearTimeout(temporizadorCreditos);
    const dialogo = $("dialogoCreditos");
    if (dialogo.open) dialogo.close();
  }

  function mostrarCreditos() {
    const dialogo = $("dialogoCreditos");
    if (!dialogo.open) dialogo.showModal();
    clearTimeout(temporizadorCreditos);
    temporizadorCreditos = setTimeout(cerrarCreditos, 7000);
  }

  function tocarCreditos() {
    toquesCreditos++;
    clearTimeout(temporizadorToquesCreditos);
    temporizadorToquesCreditos = setTimeout(() => {
      toquesCreditos = 0;
    }, 1500);
    if (toquesCreditos >= 4) {
      toquesCreditos = 0;
      clearTimeout(temporizadorToquesCreditos);
      mostrarCreditos();
    }
  }

  function configurarCierreDeFondo(dialogo, cerrar) {
    dialogo.addEventListener("click", evento => {
      if (evento.target !== dialogo) return;
      const caja = dialogo.getBoundingClientRect();
      if (evento.clientX < caja.left || evento.clientX > caja.right ||
          evento.clientY < caja.top || evento.clientY > caja.bottom) {
        cerrar();
      }
    });
  }

  function cargarEtiquetas() {
    let guardadas = [];
    try {
      const crudo = JSON.parse(localStorage.getItem(CLAVE_ETIQUETAS) || "[]");
      if (Array.isArray(crudo)) guardadas = crudo;
    } catch (error) {
      // Si el guardado está roto se usan solo las etiquetas base.
    }
    const lista = ETIQUETAS_BASE.slice();
    guardadas.forEach(valor => {
      const etiqueta = T.limpiarEspacios(valor);
      if (etiqueta && !lista.some(item => T.normalizar(item) === T.normalizar(etiqueta))) lista.push(etiqueta);
    });
    return lista;
  }

  function guardarEtiquetas() {
    const base = new Set(ETIQUETAS_BASE.map(item => T.normalizar(item)));
    const propias = etiquetasPadron.filter(item => !base.has(T.normalizar(item)));
    try {
      localStorage.setItem(CLAVE_ETIQUETAS, JSON.stringify(propias));
    } catch (error) {
      // Sin espacio: las etiquetas nuevas valen para esta sesión.
    }
  }

  function partesObservacion(texto) {
    return String(texto || "").split(";").map(parte => parte.trim()).filter(Boolean);
  }

  function etiquetaMarcada(texto, etiqueta) {
    const clave = T.normalizar(etiqueta);
    return partesObservacion(texto).some(parte => T.normalizar(parte) === clave);
  }

  function sumarEtiqueta(texto, etiqueta) {
    const partes = partesObservacion(texto);
    if (!partes.some(parte => T.normalizar(parte) === T.normalizar(etiqueta))) partes.push(etiqueta);
    return partes.join("; ");
  }

  function quitarEtiqueta(texto, etiqueta) {
    const clave = T.normalizar(etiqueta);
    return partesObservacion(texto).filter(parte => T.normalizar(parte) !== clave).join("; ");
  }

  function sincronizarEtiquetasFicha() {
    const texto = $("campoObservaciones").value;
    $$("#listaEtiquetas input[type=checkbox]").forEach(casilla => {
      casilla.checked = etiquetaMarcada(texto, casilla.value);
      casilla.closest(".etiqueta-opcion").classList.toggle("activa", casilla.checked);
    });
  }

  function renderEtiquetasFicha() {
    const host = $("listaEtiquetas");
    host.textContent = "";
    const texto = $("campoObservaciones").value;
    etiquetasPadron.forEach(etiqueta => {
      const opcion = crear("label", "etiqueta-opcion");
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.value = etiqueta;
      casilla.checked = etiquetaMarcada(texto, etiqueta);
      opcion.classList.toggle("activa", casilla.checked);
      casilla.addEventListener("change", () => {
        const actual = $("campoObservaciones").value;
        $("campoObservaciones").value = casilla.checked
          ? sumarEtiqueta(actual, etiqueta)
          : quitarEtiqueta(actual, etiqueta);
        opcion.classList.toggle("activa", casilla.checked);
      });
      opcion.append(casilla, crear("span", null, etiqueta));
      host.appendChild(opcion);
    });
  }

  function agregarEtiquetaNueva() {
    const campo = $("nuevaEtiqueta");
    const etiqueta = T.limpiarEspacios(campo.value.replace(/;+/g, " "));
    if (!etiqueta) {
      campo.focus();
      return;
    }
    const existente = etiquetasPadron.find(item => T.normalizar(item) === T.normalizar(etiqueta));
    if (existente) {
      $("campoObservaciones").value = sumarEtiqueta($("campoObservaciones").value, existente);
    } else {
      etiquetasPadron.push(etiqueta);
      guardarEtiquetas();
      $("campoObservaciones").value = sumarEtiqueta($("campoObservaciones").value, etiqueta);
      renderEtiquetasFicha();
    }
    campo.value = "";
    sincronizarEtiquetasFicha();
    campo.focus();
  }

  function abrirFicha(id) {
    const alumno = id ? datos.alumnos.find(item => item.id === id) : null;
    alumnoEditando = alumno || null;
    $("formAlumno").reset();
    $("avisoDuplicado").classList.add("oculto");
    $("avisoDuplicado").textContent = "";
    if (alumno) {
      $("tituloDialogoAlumno").textContent = "Editar alumno";
      $("subtituloDialogoAlumno").textContent = T.etiquetaCurso(alumno.grado, alumno.division) +
        (alumno.dni ? " · DNI " + T.formatearDni(alumno.dni) : " · Sin DNI");
      $("campoNombre").value = alumno.nombre;
      $("campoDni").value = T.formatearDni(alumno.dni);
      $("campoNacimiento").value = alumno.nacimiento || "";
      $("campoGrado").value = alumno.grado;
      $("campoDivision").value = alumno.division;
      $("campoDireccion").value = alumno.direccion;
      $("campoTelefono").value = alumno.telefono;
      $("campoNacionalidad").value = alumno.nacionalidad;
      $("campoResponsable").value = alumno.responsable;
      $("campoActividad").value = alumno.actividad;
      $("campoObservaciones").value = alumno.observaciones;
      $("btnEliminar").classList.remove("oculto");
    } else {
      $("tituloDialogoAlumno").textContent = "Nuevo alumno";
      $("subtituloDialogoAlumno").textContent = "Completá los datos que tengas.";
      $("campoGrado").value = filtros.grado || "1";
      $("campoDivision").value = filtros.division || "A";
      $("btnEliminar").classList.add("oculto");
    }
    resetEliminar();
    $("nuevaEtiqueta").value = "";
    renderEtiquetasFicha();
    $("dialogoAlumno").showModal();
    setTimeout(() => $("campoNombre").focus(), 40);
  }

  function cerrarFicha() {
    if ($("dialogoAlumno").open) $("dialogoAlumno").close();
  }

  function mostrarAvisoEnFicha(texto) {
    const caja = $("avisoDuplicado");
    caja.textContent = texto;
    caja.classList.remove("oculto");
    caja.scrollIntoView({ block: "nearest" });
  }

  function resetEliminar() {
    clearTimeout(temporizadorEliminar);
    armadoEliminar = false;
    const boton = $("btnEliminar");
    boton.textContent = "Eliminar";
    boton.classList.remove("confirmar");
  }

  function armarEliminar() {
    armadoEliminar = true;
    const boton = $("btnEliminar");
    boton.textContent = "Tocá de nuevo para eliminar";
    boton.classList.add("confirmar");
    clearTimeout(temporizadorEliminar);
    temporizadorEliminar = setTimeout(resetEliminar, 5000);
  }

  function guardarAlumno(evento) {
    evento.preventDefault();
    const nombre = T.normalizarNombre($("campoNombre").value);
    if (!nombre) {
      mostrarAvisoEnFicha("Escribí el nombre y apellido del alumno.");
      $("campoNombre").focus();
      return;
    }
    const campoFecha = $("campoNacimiento");
    const nacimiento = campoFecha.validity.badInput ? "" : T.normalizarFecha(campoFecha.value);
    if (campoFecha.value && !nacimiento) {
      mostrarAvisoEnFicha("Revisá la fecha de nacimiento.");
      campoFecha.focus();
      return;
    }
    const dni = T.normalizarDni($("campoDni").value);
    if (dni && dni.length < 6) {
      mostrarAvisoEnFicha("El DNI parece incompleto.");
      $("campoDni").focus();
      return;
    }
    const idActual = alumnoEditando ? alumnoEditando.id : "";
    const choque = dni ? datos.alumnos.find(alumno => alumno.id !== idActual && alumno.dni === dni) : null;
    if (choque) {
      mostrarAvisoEnFicha("Ese DNI ya está cargado: " + choque.nombre + " (" +
        T.etiquetaCurso(choque.grado, choque.division) + ").");
      $("campoDni").focus();
      return;
    }
    const registro = {
      nombre,
      dni,
      nacimiento,
      grado: $("campoGrado").value,
      division: $("campoDivision").value,
      direccion: T.normalizarDireccion($("campoDireccion").value),
      telefono: T.normalizarTelefono($("campoTelefono").value),
      responsable: T.limpiarEspacios($("campoResponsable").value),
      nacionalidad: T.limpiarEspacios($("campoNacionalidad").value),
      actividad: T.limpiarEspacios($("campoActividad").value),
      observaciones: T.limpiarEspacios($("campoObservaciones").value),
      modificado: new Date().toISOString()
    };
    const anteriores = datos.alumnos;
    const eraNuevo = !alumnoEditando;
    let idFinal;
    if (alumnoEditando) {
      idFinal = alumnoEditando.id;
      datos.alumnos = anteriores.map(alumno => alumno.id === idFinal ? Object.assign({}, alumno, registro) : alumno);
    } else {
      idFinal = Almacen.nuevoId();
      datos.alumnos = anteriores.concat(Object.assign({ id: idFinal }, registro));
    }
    if (!guardarCambios()) {
      datos.alumnos = anteriores;
      mostrarAvisoEnFicha("No se pudo guardar en este dispositivo. Probá de nuevo.");
      return;
    }
    sincronizarCambios();
    alumnoEditando = null;
    cerrarFicha();
    if (eraNuevo) {
      filtros = filtrosIniciales();
      sincronizarFiltros();
    }
    refrescarTodo();
    mostrarVista("alumnos");
    aviso(eraNuevo ? "Alumno agregado." : "Cambios guardados.", "exito");
    destacar(idFinal);
  }

  function eliminarAlumno() {
    if (!alumnoEditando) return;
    if (!armadoEliminar) {
      armarEliminar();
      return;
    }
    const eliminado = alumnoEditando;
    const anteriores = datos.alumnos;
    datos.alumnos = anteriores.filter(alumno => alumno.id !== eliminado.id);
    if (!guardarCambios()) {
      datos.alumnos = anteriores;
      aviso("No se pudo eliminar en este dispositivo.", "error");
      return;
    }
    sincronizarCambios();
    resetEliminar();
    alumnoEditando = null;
    cerrarFicha();
    refrescarTodo();
    aviso("Se eliminó a " + eliminado.nombre + ".", "exito");
  }

  function cancelarEliminarFila() {
    clearTimeout(temporizadorFila);
    if (!filaArmada) return;
    const boton = $("listaAlumnos").querySelector('.fila-accion[data-accion="eliminar"][data-id="' + CSS.escape(filaArmada) + '"]');
    if (boton) {
      boton.classList.remove("confirmar");
      boton.title = "Eliminar a " + (boton.dataset.nombre || "alumno");
      boton.setAttribute("aria-label", boton.title);
    }
    filaArmada = null;
  }

  function eliminarDesdeLista(id, boton) {
    const alumno = datos.alumnos.find(item => item.id === id);
    if (!alumno) return;
    if (filaArmada !== id) {
      cancelarEliminarFila();
      filaArmada = id;
      boton.classList.add("confirmar");
      boton.title = "Tocá de nuevo para eliminar";
      boton.setAttribute("aria-label", "Tocá de nuevo para eliminar a " + alumno.nombre);
      temporizadorFila = setTimeout(cancelarEliminarFila, 5000);
      aviso("Tocá de nuevo la papelera para eliminar a " + alumno.nombre + ".", "error");
      return;
    }
    cancelarEliminarFila();
    const anteriores = datos.alumnos;
    datos.alumnos = anteriores.filter(item => item.id !== id);
    if (!guardarCambios()) {
      datos.alumnos = anteriores;
      aviso("No se pudo eliminar en este dispositivo.", "error");
      return;
    }
    sincronizarCambios();
    if (alumnoEditando && alumnoEditando.id === id) {
      alumnoEditando = null;
      cerrarFicha();
    }
    refrescarTodo();
    aviso("Se eliminó a " + alumno.nombre + ".", "exito");
  }

  function limpiarFiltros() {
    filtros = filtrosIniciales();
    sincronizarFiltros();
    renderAlumnos();
  }

  function exportarCurso(grado, division) {
    const alumnos = datos.alumnos.filter(alumno =>
      String(alumno.grado) === grado && String(alumno.division).toUpperCase() === division);
    if (!alumnos.length) {
      aviso("El curso " + T.etiquetaCurso(grado, division) + " no tiene alumnos para exportar.", "error");
      return;
    }
    const libro = Excel.construirLibro(alumnos, datos.anio, T.etiquetaCurso(grado, division));
    const destino = Excel.descargarXlsx(libro, "Padron_" + datos.anio + "_" + grado + division + ".xlsx");
    aviso(destino === "compartido"
      ? "Elegí dónde guardar el Excel del " + T.etiquetaCurso(grado, division) + "."
      : destino === "telefono"
        ? "Guardando el Excel del " + T.etiquetaCurso(grado, division) + " en Descargas."
        : "Descargando la planilla del " + T.etiquetaCurso(grado, division) + ".");
  }

  function exportarTodo() {
    if (!datos.alumnos.length) {
      aviso("Todavía no hay alumnos para exportar.", "error");
      return;
    }
    const libro = Excel.construirLibroPorCurso(datos.alumnos, datos.anio);
    const destino = Excel.descargarXlsx(libro, "Padron_EP39_" + datos.anio + ".xlsx");
    aviso(destino === "compartido"
      ? "Elegí dónde guardar el padrón completo."
      : destino === "telefono"
        ? "Guardando el padrón completo en Descargas."
        : "Descargando el padrón completo.");
  }

  function descargarModelo(grado, division) {
    const libro = Excel.construirPlantilla(grado, division, datos.anio);
    const destino = Excel.descargarXlsx(libro, "Modelo_" + datos.anio + "_" + grado + division + ".xlsx");
    aviso(destino === "compartido"
      ? "Elegí dónde guardar el modelo de planilla."
      : destino === "telefono"
        ? "Guardando el modelo en Descargas."
        : "Descargando el modelo de planilla.");
  }

  function guardarCopia() {
    const copia = {
      app: "Escuela39Padron",
      exportado: new Date().toISOString(),
      anio: datos.anio,
      generado: datos.generado,
      fuente: datos.fuente,
      alumnos: datos.alumnos
    };
    const destino = Excel.descargarJson(copia, "Respaldo_Padron_EP39_" + datos.anio + ".json");
    aviso(destino === "compartido"
      ? "Elegí dónde guardar la copia de seguridad."
      : destino === "telefono"
        ? "Guardando la copia de seguridad en Descargas."
        : "Descargando la copia de seguridad.");
  }

  function leerCopiaAlumnos(lista) {
    const vistos = new Set();
    const alumnos = [];
    let omitidos = 0;
    lista.forEach(item => {
      if (!item || typeof item !== "object") {
        omitidos++;
        return;
      }
      const nombre = T.normalizarNombre(item.nombre);
      const grado = String(item.grado === undefined ? "" : item.grado).trim();
      const division = String(item.division === undefined ? "" : item.division).trim().toUpperCase();
      if (!nombre || !/^[1-6]$/.test(grado) || !/^[A-D]$/.test(division)) {
        omitidos++;
        return;
      }
      let id = String(item.id || "");
      if (!id || vistos.has(id)) id = Almacen.nuevoId();
      vistos.add(id);
      alumnos.push({
        id,
        nombre,
        dni: T.normalizarDni(item.dni),
        nacimiento: T.normalizarFecha(item.nacimiento),
        grado,
        division,
        direccion: T.normalizarDireccion(item.direccion),
        telefono: T.normalizarTelefono(item.telefono),
        responsable: T.limpiarEspacios(item.responsable),
        nacionalidad: T.limpiarEspacios(item.nacionalidad),
        actividad: T.limpiarEspacios(item.actividad),
        observaciones: T.limpiarEspacios(item.observaciones),
        modificado: String(item.modificado || "")
      });
    });
    return { alumnos, omitidos };
  }

  function elegirCopia(archivo) {
    const lector = new FileReader();
    lector.onerror = () => aviso("No se pudo leer la copia.", "error");
    lector.onload = () => {
      try {
        const copia = JSON.parse(lector.result);
        if (!copia || !Array.isArray(copia.alumnos)) throw new Error("La copia no tiene una lista de alumnos.");
        const lectura = leerCopiaAlumnos(copia.alumnos);
        if (!lectura.alumnos.length) throw new Error("La copia no tiene alumnos válidos.");
        copiaPendiente = {
          anio: Number(copia.anio) || datos.anio,
          generado: String(copia.generado || ""),
          fuente: String(copia.fuente || ""),
          alumnos: lectura.alumnos,
          omitidos: lectura.omitidos
        };
        $("detalleCopia").textContent = "Copia válida: " + lectura.alumnos.length + " alumnos del año " +
          copiaPendiente.anio + "." + (lectura.omitidos ? " " + lectura.omitidos + " fila(s) no se pudieron leer." : "") +
          " Al reemplazar se pierde el padrón actual de este dispositivo.";
        $("confirmarCopia").classList.remove("oculto");
      } catch (error) {
        copiaPendiente = null;
        $("confirmarCopia").classList.add("oculto");
        aviso("No se pudo restaurar la copia: " + error.message, "error");
      }
      $("archivoCopia").value = "";
    };
    lector.readAsText(archivo, "utf-8");
  }

  function reemplazarConCopia() {
    if (!copiaPendiente) return;
    const anteriores = datos;
    datos = {
      version: 1,
      anio: copiaPendiente.anio,
      generado: copiaPendiente.generado,
      fuente: copiaPendiente.fuente,
      alumnos: copiaPendiente.alumnos
    };
    if (!guardarCambios()) {
      datos = anteriores;
      aviso("No se pudo guardar la copia en este dispositivo.", "error");
      return;
    }
    sincronizarCambios();
    copiaPendiente = null;
    $("confirmarCopia").classList.add("oculto");
    filtros = filtrosIniciales();
    sincronizarFiltros();
    refrescarTodo();
    aviso("Copia restaurada: " + datos.alumnos.length + " alumnos.", "exito");
  }

  function resetRestaurar() {
    clearTimeout(temporizadorRestaurar);
    armadoRestaurar = false;
    $("restaurarInicial").textContent = "Restaurar padrón inicial";
    $("restaurarInicial").classList.remove("confirmar");
    $("avisoRestaurar").classList.add("oculto");
    $("avisoRestaurar").textContent = "";
  }

  function restaurarInicial() {
    if (!armadoRestaurar) {
      armadoRestaurar = true;
      $("restaurarInicial").textContent = "Tocá de nuevo para restaurar";
      $("restaurarInicial").classList.add("confirmar");
      $("avisoRestaurar").textContent = "Se van a perder los cambios de este dispositivo y volverán los " +
        Almacen.inicial().alumnos.length + " alumnos iniciales.";
      $("avisoRestaurar").classList.remove("oculto");
      clearTimeout(temporizadorRestaurar);
      temporizadorRestaurar = setTimeout(resetRestaurar, 6000);
      return;
    }
    const anteriores = datos;
    datos = Almacen.inicial();
    if (!guardarCambios()) {
      datos = anteriores;
      aviso("No se pudo restaurar el padrón inicial.", "error");
      resetRestaurar();
      return;
    }
    sincronizarCambios();
    resetRestaurar();
    filtros = filtrosIniciales();
    sincronizarFiltros();
    refrescarTodo();
    aviso("Padrón inicial restaurado: " + datos.alumnos.length + " alumnos.", "exito");
  }

  function abrirImportar(grado, division) {
    cursoImportacion = { grado, division };
    importacion = null;
    $("formImportar").reset();
    $("archivoExcel").value = "";
    $("nombreArchivo").textContent = "Ningún archivo elegido";
    $("estadoArchivo").textContent = "";
    $("estadoArchivo").classList.remove("error");
    $("importarOpciones").classList.add("oculto");
    $("btnImportar").disabled = true;
    $("mapeoColumnas").textContent = "";
    $("ayudaMapeo").textContent = "";
    $("hojaImportar").textContent = "";
    $("cabeceraImportar").textContent = "";
    $("previaCuerpo").textContent = "";
    $("previaResumen").textContent = "";
    $("avisoImportar").classList.add("oculto");
    $("avisoImportar").textContent = "";
    $("cursoImportarEtiqueta").textContent = T.etiquetaCurso(grado, division) + " · Año " + datos.anio;
    $("dialogoImportar").showModal();
  }

  function cerrarImportar() {
    if ($("dialogoImportar").open) $("dialogoImportar").close();
  }

  function elegirHoja(indice) {
    if (!importacion) return;
    const hoja = importacion.hojas[indice];
    if (!hoja) return;
    importacion.indiceHoja = indice;
    importacion.filas = hoja.filas;
    importacion.cabecera = Excel.detectarCabecera(hoja.filas);
    const selector = $("cabeceraImportar");
    selector.textContent = "";
    const limite = Math.min(hoja.filas.length, 20);
    for (let posicion = 0; posicion < limite; posicion++) {
      const texto = hoja.filas[posicion]
        .filter(celda => T.limpiarEspacios(celda) !== "")
        .slice(0, 6)
        .map(celda => T.limpiarEspacios(celda))
        .join(" · ");
      const opcion = crear("option", null, "Fila " + (posicion + 1) + ": " +
        (texto.length > 90 ? texto.slice(0, 90) + "…" : texto || "(sin texto)"));
      opcion.value = String(posicion);
      selector.appendChild(opcion);
    }
    selector.value = String(importacion.cabecera);
    sugerirMapeo();
  }

  function sugerirMapeo() {
    if (!importacion) return;
    importacion.encabezados = Excel.encabezados(importacion.filas, importacion.cabecera);
    importacion.mapa = Excel.mapeoSugerido(importacion.encabezados);
    renderMapeo();
    actualizarPrevia();
  }

  function renderMapeo() {
    const contenedor = $("mapeoColumnas");
    contenedor.textContent = "";
    Excel.CAMPOS_IMPORTACION.forEach(campo => {
      const mapeado = importacion.mapa[campo.clave] !== undefined;
      const caja = crear("label", "mapeo-campo" + (mapeado ? "" : " sin-mapear"));
      caja.appendChild(document.createTextNode(campo.etiqueta));
      const selector = crear("select");
      selector.dataset.campo = campo.clave;
      selector.setAttribute("aria-label", "Columna para " + campo.etiqueta);
      const ninguna = crear("option", null, "— No importar —");
      ninguna.value = "-1";
      selector.appendChild(ninguna);
      importacion.encabezados.forEach((encabezado, indice) => {
        const opcion = crear("option", null, letraColumna(indice) + ". " + encabezado);
        opcion.value = String(indice);
        selector.appendChild(opcion);
      });
      if (mapeado) selector.value = String(importacion.mapa[campo.clave]);
      caja.appendChild(selector);
      contenedor.appendChild(caja);
    });
    $("ayudaMapeo").textContent = "Si el archivo no trae grado o división, se usa " +
      T.etiquetaCurso(cursoImportacion.grado, cursoImportacion.division) + ".";
  }

  function letraColumna(indice) {
    let letra = "";
    let numero = indice;
    do {
      letra = String.fromCharCode(65 + (numero % 26)) + letra;
      numero = Math.floor(numero / 26) - 1;
    } while (numero >= 0);
    return letra;
  }

  function modoImportacion() {
    const elegido = document.querySelector('input[name="modoImportar"]:checked');
    return elegido ? elegido.value : "actualizar";
  }

  function actualizarPrevia() {
    if (!importacion) return;
    const lectura = Excel.leerFilas(importacion.filas, importacion.cabecera, importacion.mapa, cursoImportacion);
    importacion.registros = lectura.registros;
    importacion.resumen = lectura.resumen;
    const modo = modoImportacion();
    const cuerpo = $("previaCuerpo");
    cuerpo.textContent = "";
    lectura.registros.slice(0, 8).forEach(registro => {
      const fila = crear("tr");
      fila.appendChild(crear("td", null, registro.nombre));
      fila.appendChild(crear("td", null, registro.dni ? T.formatearDni(registro.dni) : "—"));
      fila.appendChild(crear("td", null, T.formatearFecha(registro.nacimiento) || "—"));
      fila.appendChild(crear("td", null, modo === "reemplazar"
        ? T.etiquetaCurso(cursoImportacion.grado, cursoImportacion.division)
        : (cursoValido(registro.grado, registro.division) ? T.etiquetaCurso(registro.grado, registro.division) : "—")));
      fila.appendChild(crear("td", null, registro.direccion || "—"));
      cuerpo.appendChild(fila);
    });
    if (!lectura.registros.length) {
      const fila = crear("tr");
      const celda = crear("td", null, "Sin filas con nombre para mostrar.");
      celda.colSpan = 5;
      fila.appendChild(celda);
      cuerpo.appendChild(fila);
    }
    $("previaResumen").textContent = lectura.resumen.validos + " para importar" +
      (lectura.resumen.sinNombre ? " · " + lectura.resumen.sinNombre + " sin nombre" : "");

    const avisos = [];
    if (importacion.mapa.nombre === undefined) {
      avisos.push("Elegí la columna que tiene el nombre y apellido.");
    } else if (!lectura.registros.length) {
      avisos.push("No encontré filas con nombre. Revisá la fila de títulos y las columnas.");
    }
    if (lectura.resumen.sinNombre) {
      avisos.push(lectura.resumen.sinNombre + " fila(s) sin nombre no se van a importar.");
    }
    if (lectura.resumen.fechasInvalidas) {
      avisos.push(lectura.resumen.fechasInvalidas + " fecha(s) no se pudieron leer y quedarán vacías.");
    }
    if (importacion.mapa.curso !== undefined) {
      const cursos = new Set(lectura.registros.map(registro => registro.grado + registro.division));
      avisos.push(cursos.size > 1
        ? "El archivo trae varios cursos: al actualizar se respeta el curso de cada fila."
        : "El curso de las filas sale de la columna “Curso”.");
    }
    if (modo === "reemplazar") {
      const actuales = datos.alumnos.filter(alumno =>
        String(alumno.grado) === cursoImportacion.grado &&
        String(alumno.division) === cursoImportacion.division).length;
      avisos.unshift("Se van a borrar los " + actuales + " alumnos actuales de " +
        T.etiquetaCurso(cursoImportacion.grado, cursoImportacion.division) +
        " y se cargarán solo los del archivo, en ese curso.");
    }
    const caja = $("avisoImportar");
    if (avisos.length) {
      caja.textContent = avisos.join(" ");
      caja.className = "aviso" + (modo === "reemplazar" ? "" : " info");
    } else {
      caja.textContent = "";
      caja.className = "aviso oculto";
    }
    $("btnImportar").disabled = !lectura.registros.length || importacion.mapa.nombre === undefined;
  }

  function importarArchivo(evento) {
    evento.preventDefault();
    if (!importacion) return;
    const lectura = Excel.leerFilas(importacion.filas, importacion.cabecera, importacion.mapa, cursoImportacion);
    if (!lectura.registros.length) {
      aviso("No hay filas con nombre para importar.", "error");
      return;
    }
    const modo = modoImportacion();
    const registros = lectura.registros.map(registro => Object.assign({}, registro));
    if (modo === "reemplazar") {
      registros.forEach(registro => {
        registro.grado = cursoImportacion.grado;
        registro.division = cursoImportacion.division;
      });
    }
    const anteriores = datos.alumnos;
    const objetivo = { grado: cursoImportacion.grado, division: cursoImportacion.division };
    const enObjetivo = alumno =>
      String(alumno.grado) === objetivo.grado && String(alumno.division) === objetivo.division;
    let trabajo = modo === "reemplazar" ? anteriores.filter(alumno => !enObjetivo(alumno)) : anteriores.slice();
    const reemplazados = anteriores.length - trabajo.length;
    const firmas = new Set();
    let agregados = 0;
    let actualizados = 0;
    let duplicadas = 0;
    let conflictos = 0;
    const ahora = new Date().toISOString();

    registros.forEach(registro => {
      const firma = registro.dni || (T.normalizar(registro.nombre) + "|" + registro.grado + registro.division);
      if (firmas.has(firma)) {
        duplicadas++;
        return;
      }
      firmas.add(firma);
      const delCurso = alumno =>
        String(alumno.grado) === registro.grado && String(alumno.division) === registro.division;
      let encontrado = null;
      if (registro.dni) {
        encontrado = trabajo.find(alumno => alumno.dni === registro.dni && delCurso(alumno)) || null;
        if (!encontrado && anteriores.some(alumno => alumno.dni === registro.dni && !delCurso(alumno))) {
          conflictos++;
          return;
        }
      }
      if (!encontrado) {
        encontrado = trabajo.find(alumno =>
          delCurso(alumno) && T.normalizar(alumno.nombre) === T.normalizar(registro.nombre)) || null;
      }
      if (encontrado) {
        const cambios = {};
        CLAVES_TEXTO.forEach(clave => {
          if (registro[clave]) cambios[clave] = registro[clave];
        });
        cambios.modificado = ahora;
        const copia = Object.assign({}, encontrado, cambios);
        trabajo[trabajo.indexOf(encontrado)] = copia;
        actualizados++;
      } else {
        trabajo.push(Object.assign({ id: Almacen.nuevoId(), modificado: ahora }, registro));
        agregados++;
      }
    });

    if (!agregados && !actualizados) {
      aviso("No había filas nuevas para importar.", "error");
      return;
    }

    datos.alumnos = trabajo;
    if (!guardarCambios()) {
      datos.alumnos = anteriores;
      aviso("No se pudo guardar la importación en este dispositivo.", "error");
      return;
    }
    sincronizarCambios();

    const partes = [];
    if (agregados) partes.push(agregados + (agregados === 1 ? " nuevo" : " nuevos"));
    if (actualizados) partes.push(actualizados + (actualizados === 1 ? " actualizado" : " actualizados"));
    if (reemplazados) partes.push(reemplazados + " quitados del curso");
    let mensaje = "Importación lista: " + (partes.join(", ") || "sin cambios") + ".";
    const omitidos = [];
    if (lectura.resumen.sinNombre) omitidos.push(lectura.resumen.sinNombre + " sin nombre");
    if (duplicadas) omitidos.push(duplicadas + " repetidas");
    if (conflictos) omitidos.push(conflictos + " con DNI de otro curso");
    if (lectura.resumen.fechasInvalidas) omitidos.push(lectura.resumen.fechasInvalidas + " con fecha ilegible");
    if (omitidos.length) mensaje += " Omitidos: " + omitidos.join(", ") + ".";

    cerrarImportar();
    filtros = filtrosIniciales();
    filtros.grado = objetivo.grado;
    filtros.division = objetivo.division;
    sincronizarFiltros();
    refrescarTodo();
    mostrarVista("alumnos");
    aviso(mensaje, "exito");
  }

  function abrirActualizacion() {
    actualizacionPendiente = null;
    resetArmadoReemplazo();
    $("formActualizacion").reset();
    $("archivoActualizacion").value = "";
    $("nombreArchivoActualizacion").textContent = "Ningún archivo elegido";
    $("estadoActualizacion").textContent = "";
    $("estadoActualizacion").classList.remove("error");
    $("opcionesActualizacion").classList.add("oculto");
    $("detalleActualizacion").textContent = "";
    $("avisoActualizacion").classList.add("oculto");
    $("avisoActualizacion").textContent = "";
    $("previaActualizacion").textContent = "";
    $("previaActualizacionResumen").textContent = "";
    $("btnAplicarActualizacion").disabled = true;
    $("subtituloActualizacion").textContent = "Archivo .json de la app del mapa · Año " + datos.anio;
    $("dialogoActualizacion").showModal();
  }

  function cerrarActualizacion() {
    if ($("dialogoActualizacion").open) $("dialogoActualizacion").close();
  }

  function resetArmadoReemplazo() {
    clearTimeout(temporizadorReemplazo);
    armadoReemplazo = false;
    const boton = $("btnAplicarActualizacion");
    boton.textContent = "Aplicar actualización";
    boton.classList.remove("confirmar");
  }

  function modoActualizacion() {
    const elegido = document.querySelector('input[name="modoActualizacion"]:checked');
    return elegido ? elegido.value : "actualizar";
  }

  function leerActualizacion(archivo) {
    $("nombreArchivoActualizacion").textContent = archivo.name;
    $("estadoActualizacion").textContent = "Leyendo el archivo…";
    $("estadoActualizacion").classList.remove("error");
    $("opcionesActualizacion").classList.add("oculto");
    $("btnAplicarActualizacion").disabled = true;
    actualizacionPendiente = null;

    if (!/\.json$/i.test(archivo.name)) {
      $("estadoActualizacion").textContent = "Elegí el archivo .json de actualización.";
      $("estadoActualizacion").classList.add("error");
      $("archivoActualizacion").value = "";
      return;
    }
    if (archivo.size > 80 * 1024 * 1024) {
      $("estadoActualizacion").textContent = "El archivo es demasiado grande (máximo 80 MB).";
      $("estadoActualizacion").classList.add("error");
      $("archivoActualizacion").value = "";
      return;
    }

    const lector = new FileReader();
    lector.onerror = () => {
      $("estadoActualizacion").textContent = "No se pudo leer el archivo.";
      $("estadoActualizacion").classList.add("error");
      $("archivoActualizacion").value = "";
    };
    lector.onload = () => {
      try {
        const lectura = Act.leer(lector.result);
        if (!lectura.registros.length) {
          throw new Error("El archivo no tiene alumnos con curso y división.");
        }
        if (lectura.anio && Number(lectura.anio) !== Number(datos.anio)) {
          throw new Error("El archivo pertenece al año lectivo " + lectura.anio +
            " y el año en curso es " + datos.anio + ". No se puede cargar para no mezclar datos.");
        }
        actualizacionPendiente = lectura;
        $("estadoActualizacion").textContent = "Archivo leído: " +
          lectura.resumen.alumnos + " alumnos · " + lectura.resumen.cursos + " cursos" +
          (lectura.anio ? " · Año " + lectura.anio : " · Sin año indicado") +
          (lectura.generado ? " · Generado el " + fechaHora(lectura.generado) : "") + ".";
        $("opcionesActualizacion").classList.remove("oculto");
        actualizarResumenActualizacion();
      } catch (error) {
        $("estadoActualizacion").textContent = error.message;
        $("estadoActualizacion").classList.add("error");
      }
      $("archivoActualizacion").value = "";
    };
    lector.readAsText(archivo, "utf-8");
  }

  function agregarDetalleActualizacion(rotulo, valor) {
    const grupo = crear("div");
    grupo.appendChild(crear("dt", null, rotulo));
    grupo.appendChild(crear("dd", null, valor));
    $("detalleActualizacion").appendChild(grupo);
  }

  function actualizarResumenActualizacion() {
    if (!actualizacionPendiente) return;
    resetArmadoReemplazo();
    const modo = modoActualizacion();
    const lectura = actualizacionPendiente;
    const resumen = lectura.resumen;
    let plan;
    try {
      plan = Act.preparar(datos.alumnos, lectura, modo);
    } catch (error) {
      aviso(error.message, "error");
      $("btnAplicarActualizacion").disabled = true;
      return;
    }

    $("resumenActualizacion").textContent = resumen.alumnos + " alumnos · " +
      resumen.cursos + " cursos";
    const detalle = $("detalleActualizacion");
    detalle.textContent = "";
    if (modo === "reemplazar") {
      agregarDetalleActualizacion("Se reemplazan", datos.alumnos.length + " alumnos actuales");
      agregarDetalleActualizacion("Quedan", plan.alumnos.length + " alumnos del archivo");
    } else {
      agregarDetalleActualizacion("Nuevos", plan.agregados);
      agregarDetalleActualizacion("Actualizados", plan.actualizados);
      agregarDetalleActualizacion("Ya están igual", plan.sinCambios);
      agregarDetalleActualizacion("Se conservan", plan.conservados + " de los actuales");
    }
    agregarDetalleActualizacion("Con DNI", resumen.conDni + " de " + resumen.alumnos);
    agregarDetalleActualizacion("Con dirección", resumen.conDireccion + " de " + resumen.alumnos);
    agregarDetalleActualizacion("Con nacimiento", resumen.conNacimiento + " de " + resumen.alumnos);
    agregarDetalleActualizacion("Con teléfono", resumen.conTelefono + " de " + resumen.alumnos);

    const avisos = [];
    if (modo === "reemplazar") {
      avisos.push("Se borran los " + datos.alumnos.length +
        " alumnos de este dispositivo y quedan solo los del archivo. Antes se guarda una copia.");
    } else if (!plan.agregados && !plan.actualizados) {
      avisos.push("El archivo no trae cambios nuevos para este padrón.");
    }
    const omitidos = [];
    if (resumen.sinNombre) omitidos.push(resumen.sinNombre + " sin nombre");
    if (resumen.sinCurso) omitidos.push(resumen.sinCurso + " con curso o división fuera de 1° a 6° y A a D");
    if (resumen.otrosRoles) omitidos.push(resumen.otrosRoles + " que no son alumnos");
    if (omitidos.length) avisos.push("No se cargan: " + omitidos.join(", ") + ".");
    const caja = $("avisoActualizacion");
    caja.textContent = avisos.join(" ");
    caja.className = "aviso" + (modo === "reemplazar" ? "" : " info") +
      (avisos.length ? "" : " oculto");

    const cuerpo = $("previaActualizacion");
    cuerpo.textContent = "";
    lectura.registros.slice(0, 8).forEach(registro => {
      const fila = crear("tr");
      fila.appendChild(crear("td", null, registro.nombre));
      fila.appendChild(crear("td", null, registro.dni ? T.formatearDni(registro.dni) : "—"));
      fila.appendChild(crear("td", null, T.etiquetaCurso(registro.grado, registro.division)));
      fila.appendChild(crear("td", null, registro.direccion || "—"));
      fila.appendChild(crear("td", null, registro.responsable || "—"));
      cuerpo.appendChild(fila);
    });
    $("previaActualizacionResumen").textContent = lectura.registros.length > 8
      ? "Primeros 8 de " + lectura.registros.length
      : lectura.registros.length + " alumnos";

    $("btnAplicarActualizacion").disabled = modo === "actualizar" &&
      !plan.agregados && !plan.actualizados;
  }

  function armarReemplazo() {
    armadoReemplazo = true;
    const boton = $("btnAplicarActualizacion");
    boton.textContent = "Tocá de nuevo para reemplazar";
    boton.classList.add("confirmar");
    clearTimeout(temporizadorReemplazo);
    temporizadorReemplazo = setTimeout(resetArmadoReemplazo, 6000);
  }

  function aplicarActualizacion(evento) {
    evento.preventDefault();
    if (!actualizacionPendiente) return;
    const modo = modoActualizacion();
    if (modo === "reemplazar" && !armadoReemplazo) {
      armarReemplazo();
      return;
    }
    let plan;
    try {
      plan = Act.preparar(datos.alumnos, actualizacionPendiente, modo);
    } catch (error) {
      aviso(error.message, "error");
      return;
    }
    if (modo === "actualizar" && !plan.agregados && !plan.actualizados) {
      aviso("No hay cambios para aplicar.", "error");
      return;
    }

    const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const copia = {
      app: "Escuela39Padron",
      exportado: new Date().toISOString(),
      anio: datos.anio,
      generado: datos.generado,
      fuente: datos.fuente,
      alumnos: datos.alumnos
    };
    let destino;
    try {
      destino = Excel.descargarJson(copia,
        "Respaldo_antes_actualizacion_" + datos.anio + "_" + sello + ".json");
    } catch (error) {
      aviso("No se pudo guardar la copia de seguridad. No se cambiaron los datos.", "error");
      return;
    }

    const lectura = actualizacionPendiente;
    const anteriores = datos;
    datos = Object.assign({}, datos, {
      anio: lectura.anio || datos.anio,
      generado: lectura.generado || datos.generado,
      fuente: lectura.fuente,
      alumnos: plan.alumnos
    });
    if (!guardarCambios()) {
      datos = anteriores;
      aviso("No se pudo guardar la actualización en este dispositivo.", "error");
      return;
    }
    sincronizarCambios();

    const partes = [];
    if (modo === "reemplazar") {
      partes.push(plan.alumnos.length + " alumnos del archivo");
      if (plan.quitados) partes.push(plan.quitados + " reemplazados");
    } else {
      if (plan.agregados) partes.push(plan.agregados + (plan.agregados === 1 ? " nuevo" : " nuevos"));
      if (plan.actualizados) partes.push(plan.actualizados +
        (plan.actualizados === 1 ? " actualizado" : " actualizados"));
      if (plan.conservados) partes.push(plan.conservados + " conservados");
    }
    const donde = destino === "compartido"
      ? "el lugar que elegiste al compartir"
      : destino === "telefono" ? "Descargas" : "la carpeta de descargas";
    cerrarActualizacion();
    filtros = filtrosIniciales();
    sincronizarFiltros();
    refrescarTodo();
    mostrarVista("alumnos");
    aviso("Actualización aplicada: " + (partes.join(", ") || "sin cambios") +
      ". Copia anterior en " + donde + ".", "exito");
  }

  function configurarEventos() {
    const pestanas = document.querySelector(".pestanas");
    pestanas.addEventListener("click", evento => {
      const boton = evento.target.closest("button[data-vista]");
      if (boton) mostrarVista(boton.dataset.vista);
    });
    pestanas.addEventListener("keydown", evento => {
      const actual = evento.target.closest("button[data-vista]");
      if (!actual) return;
      const botones = $$("button[data-vista]", pestanas);
      let indice = botones.indexOf(actual);
      if (evento.key === "ArrowRight") indice = (indice + 1) % botones.length;
      else if (evento.key === "ArrowLeft") indice = (indice - 1 + botones.length) % botones.length;
      else if (evento.key === "Home") indice = 0;
      else if (evento.key === "End") indice = botones.length - 1;
      else return;
      evento.preventDefault();
      botones[indice].focus();
      mostrarVista(botones[indice].dataset.vista);
    });

    $("btnAgregar").addEventListener("click", () => abrirFicha(null));
    $("escudoCreditos").addEventListener("click", tocarCreditos);
    $("dialogoCreditos").addEventListener("click", cerrarCreditos);
    $("dialogoCreditos").addEventListener("close", () => clearTimeout(temporizadorCreditos));

    $("buscar").addEventListener("input", () => {
      $("limpiarBusqueda").classList.toggle("oculto", !$("buscar").value);
      clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = setTimeout(() => {
        filtros.consulta = $("buscar").value;
        renderAlumnos();
      }, 80);
    });
    $("buscar").addEventListener("keydown", evento => {
      if (evento.key !== "Enter") return;
      clearTimeout(temporizadorBusqueda);
      filtros.consulta = $("buscar").value;
      renderAlumnos();
    });
    $("limpiarBusqueda").addEventListener("click", () => {
      $("buscar").value = "";
      filtros.consulta = "";
      $("limpiarBusqueda").classList.add("oculto");
      renderAlumnos();
      $("buscar").focus();
    });

    $("chipsGrado").addEventListener("click", evento => {
      const chip = evento.target.closest("button[data-grado]");
      if (!chip) return;
      filtros.grado = chip.dataset.grado;
      sincronizarFiltros();
      renderAlumnos();
    });
    $("filtroDivision").addEventListener("change", () => {
      filtros.division = $("filtroDivision").value;
      syncBotonLimpiar();
      renderAlumnos();
    });
    $("orden").addEventListener("change", () => {
      filtros.orden = $("orden").value;
      syncBotonLimpiar();
      renderAlumnos();
    });
    $$(".chip-faltante").forEach(boton => {
      boton.addEventListener("click", () => {
        const clave = boton.dataset.falta;
        if (filtros.faltantes.has(clave)) filtros.faltantes.delete(clave);
        else filtros.faltantes.add(clave);
        sincronizarFiltros();
        renderAlumnos();
      });
    });
    $("limpiarFiltros").addEventListener("click", limpiarFiltros);
    $("btnLimpiarVacio").addEventListener("click", () => {
      if (!datos.alumnos.length) abrirFicha(null);
      else limpiarFiltros();
    });

    $("listaAlumnos").addEventListener("click", evento => {
      const accion = evento.target.closest(".fila-accion");
      if (accion) {
        if (accion.dataset.accion === "editar") abrirFicha(accion.dataset.id);
        else eliminarDesdeLista(accion.dataset.id, accion);
        return;
      }
      const boton = evento.target.closest(".fila-boton");
      if (boton) abrirFicha(boton.dataset.id);
    });

    $("grillaCursos").addEventListener("click", evento => {
      const boton = evento.target.closest("button[data-accion]");
      if (!boton) return;
      const tarjeta = boton.closest(".tarjeta-curso");
      const grado = tarjeta.dataset.grado;
      const division = tarjeta.dataset.division;
      const accion = boton.dataset.accion;
      if (accion === "ver") {
        filtros = filtrosIniciales();
        filtros.grado = grado;
        filtros.division = division;
        sincronizarFiltros();
        renderAlumnos();
        mostrarVista("alumnos");
        $("vistaAlumnos").scrollTop = 0;
        $("listaAlumnos").scrollTop = 0;
      } else if (accion === "importar") {
        abrirImportar(grado, division);
      } else if (accion === "exportar") {
        exportarCurso(grado, division);
      }
    });
    $("btnExportarTodo").addEventListener("click", exportarTodo);
    $("exportarTodoDatos").addEventListener("click", exportarTodo);

    $("formAlumno").addEventListener("submit", guardarAlumno);
    $("cerrarDialogoAlumno").addEventListener("click", cerrarFicha);
    $("btnCancelarAlumno").addEventListener("click", cerrarFicha);
    $("btnEliminar").addEventListener("click", eliminarAlumno);
    $("campoObservaciones").addEventListener("input", sincronizarEtiquetasFicha);
    $("btnAgregarEtiqueta").addEventListener("click", agregarEtiquetaNueva);
    $("nuevaEtiqueta").addEventListener("keydown", evento => {
      if (evento.key !== "Enter") return;
      evento.preventDefault();
      agregarEtiquetaNueva();
    });
    $("dialogoAlumno").addEventListener("close", () => {
      alumnoEditando = null;
      resetEliminar();
    });
    configurarCierreDeFondo($("dialogoAlumno"), cerrarFicha);

    $("formAnio").addEventListener("submit", evento => {
      evento.preventDefault();
      const anio = Number($("anioLectivo").value);
      if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
        aviso("Escribí un año entre 2000 y 2100.", "error");
        return;
      }
      if (anio === datos.anio) {
        aviso("El año lectivo ya es " + anio + ".");
        return;
      }
      datos.anio = anio;
      if (!guardarCambios()) {
        aviso("No se pudo guardar el año.", "error");
        return;
      }
      actualizarAnio();
      refrescarTodo();
      aviso("Año lectivo " + anio + " guardado.", "exito");
    });

    $("copiaJson").addEventListener("click", guardarCopia);
    $("elegirCopia").addEventListener("click", () => $("archivoCopia").click());
    $("archivoCopia").addEventListener("change", () => {
      const archivo = $("archivoCopia").files && $("archivoCopia").files[0];
      if (archivo) elegirCopia(archivo);
    });
    $("btnReemplazarCopia").addEventListener("click", reemplazarConCopia);
    $("btnCancelarCopia").addEventListener("click", () => {
      copiaPendiente = null;
      $("confirmarCopia").classList.add("oculto");
    });
    $("btnModelo").addEventListener("click", () => descargarModelo("1", "A"));
    $("restaurarInicial").addEventListener("click", restaurarInicial);

    $("abrirActualizacion").addEventListener("click", abrirActualizacion);
    $("archivoActualizacion").addEventListener("change", evento => {
      const archivo = evento.target.files && evento.target.files[0];
      if (archivo) leerActualizacion(archivo);
    });
    $$('input[name="modoActualizacion"]').forEach(radio =>
      radio.addEventListener("change", actualizarResumenActualizacion));
    $("formActualizacion").addEventListener("submit", aplicarActualizacion);
    $("cerrarActualizacion").addEventListener("click", cerrarActualizacion);
    $("btnCancelarActualizacion").addEventListener("click", cerrarActualizacion);
    $("dialogoActualizacion").addEventListener("close", () => {
      actualizacionPendiente = null;
      resetArmadoReemplazo();
      $("btnAplicarActualizacion").disabled = true;
      $("archivoActualizacion").value = "";
    });
    configurarCierreDeFondo($("dialogoActualizacion"), cerrarActualizacion);

    const selectorCursoDatos = $("cursoImportarDatos");
    const cursoVacio = crear("option", null, "Elegí un curso");
    cursoVacio.value = "";
    selectorCursoDatos.appendChild(cursoVacio);
    GRADOS.forEach(grado => DIVISIONES.forEach(division => {
      const opcion = crear("option", null, T.etiquetaCurso(grado, division));
      opcion.value = grado + division;
      selectorCursoDatos.appendChild(opcion);
    }));
    $("importarCursoDatos").addEventListener("click", () => {
      const valor = selectorCursoDatos.value;
      if (!cursoValido(valor.charAt(0), valor.charAt(1))) {
        aviso("Elegí el curso para importar el Excel.", "error");
        selectorCursoDatos.focus();
        return;
      }
      abrirImportar(valor.charAt(0), valor.charAt(1));
    });

    const puenteCompartir = window.AndroidApp;
    if (puenteCompartir && typeof puenteCompartir.compartirApp === "function") {
      $("panelCompartir").classList.remove("oculto");
      $("compartirApp").addEventListener("click", () => puenteCompartir.compartirApp());
    }

    $("archivoExcel").addEventListener("change", async evento => {
      const archivo = evento.target.files && evento.target.files[0];
      if (!archivo) return;
      $("nombreArchivo").textContent = archivo.name;
      $("estadoArchivo").textContent = "Leyendo el archivo…";
      $("estadoArchivo").classList.remove("error");
      $("importarOpciones").classList.add("oculto");
      $("btnImportar").disabled = true;
      importacion = null;
      try {
        const libro = await Excel.leerLibro(archivo);
        importacion = { hojas: libro.hojas, indiceHoja: 0, filas: [], cabecera: 0, encabezados: [], mapa: {}, archivo: archivo.name };
        $("estadoArchivo").textContent = libro.hojas.length + (libro.hojas.length === 1 ? " hoja leída." : " hojas leídas.");
        const selector = $("hojaImportar");
        selector.textContent = "";
        libro.hojas.forEach((hoja, indice) => {
          const opcion = crear("option", null, hoja.nombre + " · " + hoja.filas.length + " filas");
          opcion.value = String(indice);
          selector.appendChild(opcion);
        });
        selector.value = "0";
        $("importarOpciones").classList.remove("oculto");
        elegirHoja(0);
      } catch (error) {
        $("estadoArchivo").textContent = error.message;
        $("estadoArchivo").classList.add("error");
        $("btnImportar").disabled = true;
      }
    });
    $("hojaImportar").addEventListener("change", () => elegirHoja(Number($("hojaImportar").value)));
    $("cabeceraImportar").addEventListener("change", () => {
      if (!importacion) return;
      importacion.cabecera = Number($("cabeceraImportar").value) || 0;
      sugerirMapeo();
    });
    $("mapeoColumnas").addEventListener("change", evento => {
      const selector = evento.target.closest("select[data-campo]");
      if (!selector || !importacion) return;
      const columna = Number(selector.value);
      if (columna >= 0) importacion.mapa[selector.dataset.campo] = columna;
      else delete importacion.mapa[selector.dataset.campo];
      selector.closest(".mapeo-campo").classList.toggle("sin-mapear", columna < 0);
      actualizarPrevia();
    });
    $$('input[name="modoImportar"]').forEach(radio => radio.addEventListener("change", actualizarPrevia));
    $("btnModeloImportar").addEventListener("click", () => descargarModelo(cursoImportacion.grado, cursoImportacion.division));
    $("formImportar").addEventListener("submit", importarArchivo);
    $("cerrarImportar").addEventListener("click", cerrarImportar);
    $("btnCancelarImportar").addEventListener("click", cerrarImportar);
    $("dialogoImportar").addEventListener("close", () => {
      importacion = null;
      $("btnImportar").disabled = true;
    });
    configurarCierreDeFondo($("dialogoImportar"), cerrarImportar);

    $$("dialog").forEach(dialogo => {
      dialogo.addEventListener("close", moverAvisosAlCuerpo);
    });
  }

  function syncBotonLimpiar() {
    const conFiltros = Boolean(filtros.consulta || filtros.grado || filtros.division ||
      filtros.faltantes.size || filtros.orden !== "apellido");
    $("limpiarFiltros").classList.toggle("oculto", !conFiltros);
  }

  function aplicarMapa(lectura) {
    if (!lectura || !Array.isArray(lectura.alumnos)) return;
    datos = Object.assign({}, datos, {
      anio: lectura.anio || datos.anio,
      generado: lectura.generado || datos.generado,
      fuente: lectura.fuente || datos.fuente || "Mapa integrado EP 39",
      alumnos: lectura.alumnos
    });
    guardarCambios();
    refrescarTodo();
  }

  function sincronizarCambios() {
    if (!Integracion || !Integracion.disponible() || !Integracion.lista()) return;
    clearTimeout(temporizadorSincronizacion);
    temporizadorSincronizacion = setTimeout(() => {
      Integracion.sincronizar(datos.alumnos).then(resultado => {
        if (!resultado) return;
        if (resultado.error) {
          aviso("Quedó guardado en el padrón, pero el mapa no se actualizó: " + resultado.error, "error");
          return;
        }
        if (resultado.creados || resultado.actualizados || resultado.eliminados) guardarCambios();
      }).catch(error => {
        aviso("Quedó guardado en el padrón, pero el mapa no se actualizó: " + error.message, "error");
      });
    }, 150);
  }

  function recargarDesdeMapa() {
    if (!Integracion) return Promise.resolve(null);
    return Integracion.refrescar(datos.alumnos).catch(() => null);
  }

  // En el teléfono el mapa puede tardar en exponer su base: se espera y se
  // reintenta en vez de dejar el padrón con datos viejos.
  function sincronizarConMapa(intentos) {
    if (!Integracion) return;
    const paso = intentos || 0;
    if (!Integracion.disponible()) {
      if (paso < 600) setTimeout(() => sincronizarConMapa(paso + 1), 500);
      return;
    }
    recargarDesdeMapa().then(lectura => {
      if (!lectura && paso < 600) setTimeout(() => sincronizarConMapa(paso + 1), 2000);
    });
  }

  function iniciar() {
    etiquetasPadron = cargarEtiquetas();
    if (Integracion) Integracion.conectar(aplicarMapa);
    window.PadronApp = { recargarDesdeMapa };
    configurarEventos();
    reconstruirIndice();
    actualizarAnio();
    sincronizarFiltros();
    mostrarVista(vistaDesdeHash(), false);
    refrescarTodo();
    sincronizarConMapa(0);
  }

  iniciar();
})();
