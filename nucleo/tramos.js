(function(root) {
  "use strict";
  const longitudeScale = 91300;
  const latitudeScale = 111320;
  function xy(point) { return [point[0] * longitudeScale, point[1] * latitudeScale]; }
  function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function pointSegmentDistance(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
    return distance(p, [a[0] + t * dx, a[1] + t * dy]);
  }
  function findRoutes(mainRoads, firstRoads, secondRoads) {
    const nodes = [], edges = [];
    function nodeFor(point) {
      const p = xy(point);
      let closest = -1, min = 5;
      nodes.forEach((node, i) => {
        const d = distance(p, node.xy);
        if (d <= min) { closest = i; min = d; }
      });
      if (closest >= 0) return closest;
      nodes.push({ xy: p, coordinates: point, edges: [] });
      return nodes.length - 1;
    }
    mainRoads.forEach(road => road.coordinates.forEach(line => {
      if (line.length < 2) return;
      const from = nodeFor(line[0]), to = nodeFor(line[line.length - 1]);
      if (from === to) return;
      let length = 0;
      for (let i = 1; i < line.length; i++) length += distance(xy(line[i - 1]), xy(line[i]));
      const edge = { from, to, road, line, length };
      const index = edges.push(edge) - 1;
      nodes[from].edges.push(index);
      nodes[to].edges.push(index);
    }));
    function crossingNodes(crossRoads) {
      const segments = [];
      crossRoads.forEach(road => road.coordinates.forEach(line => {
        for (let i = 1; i < line.length; i++) segments.push([xy(line[i - 1]), xy(line[i])]);
      }));
      return nodes.map((node, index) => {
        let min = Infinity;
        segments.forEach(([a, b]) => {
          if (node.xy[0] < Math.min(a[0], b[0]) - 12 || node.xy[0] > Math.max(a[0], b[0]) + 12 ||
              node.xy[1] < Math.min(a[1], b[1]) - 12 || node.xy[1] > Math.max(a[1], b[1]) + 12) return;
          min = Math.min(min, pointSegmentDistance(node.xy, a, b));
        });
        return { index, distance: min };
      }).filter(item => item.distance <= 12);
    }
    const starts = crossingNodes(firstRoads), ends = crossingNodes(secondRoads);
    const routes = [], seen = new Set();
    const crossings = new Set(starts.concat(ends).map(item => item.index));
    for (const start of starts) {
      const dist = nodes.map(() => Infinity), previous = nodes.map(() => null), visited = new Set();
      dist[start.index] = 0;
      while (visited.size < nodes.length) {
        let current = -1;
        nodes.forEach((_, i) => { if (!visited.has(i) && (current < 0 || dist[i] < dist[current])) current = i; });
        if (current < 0 || !Number.isFinite(dist[current])) break;
        visited.add(current);
        if (current !== start.index && crossings.has(current)) continue;
        for (const edgeIndex of nodes[current].edges) {
          const edge = edges[edgeIndex], next = edge.from === current ? edge.to : edge.from;
          const length = dist[current] + edge.length;
          if (length < dist[next]) { dist[next] = length; previous[next] = { node: current, edge: edgeIndex }; }
        }
      }
      for (const end of ends) {
        if (end.index === start.index || !Number.isFinite(dist[end.index])) continue;
        const path = [], pathNodes = [end.index];
        let current = end.index;
        while (current !== start.index) {
          const step = previous[current];
          if (!step) break;
          path.push(step.edge); current = step.node; pathNodes.push(current);
        }
        if (current !== start.index) continue;
        path.reverse();
        const key = path.slice().sort((a, b) => a - b).join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ edges: path.map(i => edges[i]), start: nodes[start.index].coordinates,
          end: nodes[end.index].coordinates, gap: Math.max(start.distance, end.distance),
          branched: pathNodes.some(i => nodes[i].edges.length > 2) });
        if (routes.length >= 100) return { routes, firstCount: starts.length, secondCount: ends.length, limited: true };
      }
    }
    return { routes, firstCount: starts.length, secondCount: ends.length };
  }
  const api = { findRoutes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.streetRoutes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
