function rng(seed) {
  let value = seed >>> 0 || 1;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
function sample(seed, size = 6) {
  const random = rng(seed), horses = [], used = new Set();
  function place(row) {
    if (row === size) return true;
    const columns = Array.from({ length: size }, (_, i) => i);
    for (let i = columns.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1)); [columns[i], columns[j]] = [columns[j], columns[i]];
    }
    for (const c of columns) {
      if (used.has(c) || (row && Math.abs(horses[row - 1] - c) <= 1)) continue;
      horses[row] = c; used.add(c);
      if (place(row + 1)) return true;
      used.delete(c);
    }
    return false;
  }
  if (!place(0)) throw new Error('no placement');
  const regions = Array(size * size).fill(-1);
  horses.forEach((c, r) => { regions[r * size + c] = r; });
  for (let assigned = size; assigned < size * size; assigned++) {
    const edges = [];
    for (let i = 0; i < size * size; i++) {
      if (regions[i] < 0) continue;
      const r = Math.floor(i / size), c = i % size;
      for (const [rr, cc] of [[r - 1,c],[r + 1,c],[r,c - 1],[r,c + 1]]) {
        const j = rr * size + cc;
        if (rr >= 0 && rr < size && cc >= 0 && cc < size && regions[j] === -1) edges.push([j, regions[i]]);
      }
    }
    const [cell, region] = edges[Math.floor(random() * edges.length)]; regions[cell] = region;
  }
  return { size, regions, horses };
}
module.exports = { rng, sample };
