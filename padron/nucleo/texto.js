"use strict";
// Normalización de textos, fechas, documentos y direcciones para la búsqueda
// y para acomodar los datos que vienen de Excel.
(function() {

  const ORDINALES = { "1": "primero", "2": "segundo", "3": "tercero", "4": "cuarto", "5": "quinto", "6": "sexto" };
  const TIPOS = {
    av: "avenida", avda: "avenida", avenida: "avenida",
    calle: "calle", c: "calle",
    bv: "bulevar", bvd: "bulevar", bulevar: "bulevar", bu: "bulevar",
    pje: "pasaje", psje: "pasaje", pasaje: "pasaje",
    diag: "diagonal", diagonal: "diagonal",
    pza: "plaza", plaza: "plaza",
    ruta: "ruta", r: "ruta",
    nro: "numero", num: "numero", numero: "numero", n: "numero",
    e: "entre"
  };
  const TIPOS_REALES = new Set(["avenida", "calle", "bulevar", "pasaje", "diagonal", "plaza", "ruta"]);
  const MESES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
    agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
  };

  function limpiarEspacios(texto) {
    return String(texto === null || texto === undefined ? "" : texto)
      .replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function sinAcentos(texto) {
    return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalizar(texto) {
    return sinAcentos(texto).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function tokens(texto) {
    const limpio = normalizar(texto);
    return limpio ? limpio.split(" ") : [];
  }

  function normalizarNombre(texto) {
    const limpio = limpiarEspacios(texto);
    return limpio ? limpio.toLocaleUpperCase("es") : "";
  }

  function normalizarDireccion(texto) {
    let limpio = limpiarEspacios(texto);
    if (!limpio) return "";
    limpio = limpio.replace(/\bN\s*[º°]\s*/gi, "N° ");
    limpio = limpio.replace(/\bNro\.?\s*/gi, "N° ");
    limpio = limpio.replace(/\bN\s+(?=\d)/gi, "N° ");
    limpio = limpio.replace(/\s*E\s*\/\s*/gi, " e/ ");
    limpio = limpio.replace(/^(av\.?|avda\.?|avenida)\s+/i, "Av. ");
    limpio = limpio.replace(/^(calle|c\.)\s+/i, "Calle ");
    limpio = limpio.replace(/^(bv\.?|bvd\.?|bulevar)\s+/i, "Bv. ");
    limpio = limpio.replace(/^(pje\.?|psje\.?|pasaje)\s+/i, "Pasaje ");
    limpio = limpio.replace(/^(diag\.?|diagonal)\s+/i, "Diagonal ");
    limpio = limpio.replace(/^(pza\.?|plaza)\s+/i, "Plaza ");
    return limpiarEspacios(limpio);
  }

  function tokensDireccion(texto, agregarCalle) {
    const partes = normalizar(texto).split(" ").filter(Boolean).map(parte => TIPOS[parte] || parte);
    const resultado = partes.filter(parte => parte !== "y");
    if (agregarCalle && resultado.length && !resultado.some(parte => TIPOS_REALES.has(parte))) {
      resultado.unshift("calle");
    }
    return resultado;
  }

  function tokensConsultaDireccion(texto) {
    return tokensDireccion(texto, false);
  }

  function tokenDireccion(parte) {
    const limpio = normalizar(parte);
    return TIPOS[limpio] || limpio;
  }

  function etiquetaCurso(grado, division) {
    return String(grado) + "° " + String(division || "").toUpperCase();
  }

  function tokensCurso(grado, division) {
    const letra = String(division || "").toLowerCase();
    const numero = String(grado);
    return [numero, letra, numero + letra, ORDINALES[numero] || numero];
  }

  function formatearFecha(iso) {
    const partes = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return partes ? partes[3] + "/" + partes[2] + "/" + partes[1] : "";
  }

  function fechaISO(anio, mes, dia) {
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || !Number.isInteger(dia)) return "";
    if (anio < 100) anio += 2000;
    if (anio < 1990 || anio > new Date().getFullYear()) return "";
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return "";
    if (fecha.getTime() > Date.now()) return "";
    return fecha.toISOString().slice(0, 10);
  }

  function normalizarFecha(valor) {
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
      return fechaISO(valor.getFullYear(), valor.getMonth() + 1, valor.getDate());
    }
    if (typeof valor === "number" && Number.isFinite(valor) && valor > 20000 && valor < 60000) {
      const fecha = new Date(Math.round((valor - 25569) * 86400000));
      return fechaISO(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, fecha.getUTCDate());
    }
    const texto = limpiarEspacios(valor);
    if (!texto) return "";
    if (/^\d{5}$/.test(texto)) {
      const serial = +texto;
      if (serial > 20000 && serial < 60000) {
        const fecha = new Date(Math.round((serial - 25569) * 86400000));
        return fechaISO(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, fecha.getUTCDate());
      }
    }
    let coincidencia = texto.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
    if (coincidencia) return fechaISO(+coincidencia[1], +coincidencia[2], +coincidencia[3]);
    coincidencia = texto.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (coincidencia) {
      const primero = +coincidencia[1], segundo = +coincidencia[2], anio = +coincidencia[3];
      return segundo > 12 && primero <= 12 ? fechaISO(anio, primero, segundo) : fechaISO(anio, segundo, primero);
    }
    coincidencia = texto.match(/^(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+de\s+(\d{4})$/);
    if (coincidencia) {
      const mes = MESES[sinAcentos(coincidencia[2]).toLowerCase()];
      return mes ? fechaISO(+coincidencia[3], mes, +coincidencia[1]) : "";
    }
    return "";
  }

  function normalizarDni(valor) {
    return String(valor === null || valor === undefined ? "" : valor).replace(/\D/g, "").slice(0, 11);
  }

  function formatearDni(digitos) {
    const numero = String(digitos || "").replace(/\D/g, "");
    if (!numero) return "";
    if (numero.length === 8) return numero.slice(0, 2) + "." + numero.slice(2, 5) + "." + numero.slice(5);
    if (numero.length === 7) return numero.slice(0, 1) + "." + numero.slice(1, 4) + "." + numero.slice(4);
    if (numero.length === 11) return numero.slice(0, 2) + "-" + numero.slice(2, 10) + "-" + numero.slice(10);
    return numero;
  }

  function normalizarTelefono(valor) {
    const digitos = String(valor === null || valor === undefined ? "" : valor).replace(/\D/g, "");
    return digitos.length >= 6 && digitos.length <= 15 ? digitos : "";
  }

  function formatearPorcentaje(parte, total) {
    return total ? Math.round(parte * 100 / total) + " %" : "0 %";
  }

  window.TextoPadron = {
    limpiarEspacios, sinAcentos, normalizar, tokens, normalizarNombre,
    normalizarDireccion, tokensDireccion, tokensConsultaDireccion, tokenDireccion,
    etiquetaCurso, tokensCurso, formatearFecha, normalizarFecha,
    normalizarDni, formatearDni, normalizarTelefono, formatearPorcentaje
  };
})();
