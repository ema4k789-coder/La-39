(function(root) {
  "use strict";
  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }
  function streetSearchName(value) {
    return normalize(value).trim().replace(/^(CALLE|AVENIDA|AV\.?)\s+/, "").replace(/\s+/g, " ");
  }
  function heightsText(heights) {
    function pair(side) {
      const start = heights && heights.inicio && heights.inicio[side];
      const end = heights && heights.fin && heights.fin[side];
      return Number.isFinite(start) && start > 0 && Number.isFinite(end) && end > 0 ?
        start + " a " + end : "sin rango completo";
    }
    return "Izquierda: " + pair("izquierda") + " · Derecha: " + pair("derecha");
  }
  function matchesHeight(heights, height) {
    if (!Number.isSafeInteger(height) || height <= 0 || !heights || !heights.inicio || !heights.fin) return false;
    return ["izquierda", "derecha"].some(side => {
      const start = heights.inicio[side];
      const end = heights.fin[side];
      return Number.isFinite(start) && start > 0 && Number.isFinite(end) && end > 0 &&
        height >= Math.min(start, end) && height <= Math.max(start, end);
    });
  }
  const api = { normalize, streetSearchName, heightsText, matchesHeight };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.streetLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
