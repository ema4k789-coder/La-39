"use strict";
// Guardado del padrón en el navegador (localStorage). El padrón inicial llega
// cifrado y se usa la primera vez o al restaurar.
(function() {
  const CLAVE = "ep39.padron.v1";
  const VERSION = 1;

  function clonar(alumno) {
    return {
      id: String(alumno.id || ""),
      personaId: String(alumno.personaId || ""),
      nombre: String(alumno.nombre || ""),
      dni: String(alumno.dni || ""),
      nacimiento: String(alumno.nacimiento || ""),
      grado: String(alumno.grado || ""),
      division: String(alumno.division || "").toUpperCase(),
      direccion: String(alumno.direccion || ""),
      telefono: String(alumno.telefono || ""),
      responsable: String(alumno.responsable || ""),
      nacionalidad: String(alumno.nacionalidad || ""),
      actividad: String(alumno.actividad || ""),
      observaciones: String(alumno.observaciones || ""),
      modificado: String(alumno.modificado || "")
    };
  }

  function inicial() {
    const base = window.PADRON_INICIAL || { alumnos: [] };
    return {
      version: VERSION,
      anio: Number(base.anio) || new Date().getFullYear(),
      generado: String(base.generado || ""),
      fuente: String(base.fuente || ""),
      alumnos: (base.alumnos || []).map(clonar)
    };
  }

  function cargar() {
    try {
      const crudo = localStorage.getItem(CLAVE);
      if (!crudo) return null;
      const datos = JSON.parse(crudo);
      if (!datos || !Array.isArray(datos.alumnos)) return null;
      return {
        version: Number(datos.version) || VERSION,
        anio: Number(datos.anio) || new Date().getFullYear(),
        generado: String(datos.generado || ""),
        fuente: String(datos.fuente || ""),
        alumnos: datos.alumnos.filter(alumno => alumno && alumno.nombre).map(clonar)
      };
    } catch (error) {
      return null;
    }
  }

  function guardar(datos) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({
        version: VERSION,
        anio: datos.anio,
        generado: datos.generado,
        fuente: datos.fuente,
        alumnos: datos.alumnos
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  function reiniciar() {
    const datos = inicial();
    guardar(datos);
    return datos;
  }

  function nuevoId() {
    return "ALU-" + Date.now().toString(36).toUpperCase() + "-" +
      Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  window.AlmacenPadron = { CLAVE, inicial, cargar, guardar, reiniciar, nuevoId };
})();
