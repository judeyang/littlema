const Core = require('../src/puzzle-core.js');
const VERSION = '1.1.0';
function rng(seed) {
  let value = seed >>> 0 || 1;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
function adjacent(i, n) {
  const r = Math.floor(i / n), c = i % n;
  return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([r,c]) => r>=0 && r<n && c>=0 && c<n).map(([r,c])=>r*n+c);
}
function candidate(seed, size, template = 0) {
  if (!Number.isInteger(size) || size < 4 || size > 16 || !Number.isInteger(seed)) throw new Error('invalid generator input');
  const random = rng(seed), horses = [], used = new Set();
  function place(row) {
    if (row === size) return true;
    const columns = Array.from({length:size},(_,i)=>i);
    for (let i=columns.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [columns[i],columns[j]]=[columns[j],columns[i]]; }
    for (const c of columns) {
      if (used.has(c) || (row && Math.abs(horses[row-1]-c)<=1)) continue;
      horses[row]=c; used.add(c); if (place(row+1)) return true; used.delete(c);
    }
    return false;
  }
  if (!place(0)) return null;
  const regions=Array(size*size).fill(-1); horses.forEach((c,r)=>{regions[r*size+c]=r;});
  for (let assigned=size;assigned<size*size;assigned++) {
    const edges=[];
    for (let i=0;i<regions.length;i++) {
      if (regions[i]<0) continue;
      for (const j of adjacent(i,size)) {
        if (regions[j]!==-1) continue;
        if (template && regions[i]<template && Math.floor(j/size)>=template) continue;
        edges.push([j,regions[i]]);
      }
    }
    if (!edges.length) return null;
    const [cell,region]=edges[Math.floor(random()*edges.length)]; regions[cell]=region;
  }
  return {size,regions,solution:horses,seed,generatorVersion:VERSION,template};
}
function mutate(puzzle, seed, moves = 1) {
  const out={...puzzle,regions:puzzle.regions.slice()}, random=rng(seed);
  const fixed=new Set(puzzle.solution.map((c,r)=>r*puzzle.size+c));
  for(let m=0;m<moves;m++) {
    const i=Math.floor(random()*out.regions.length); if(fixed.has(i)) continue;
    const neighbors=adjacent(i,puzzle.size), j=neighbors[Math.floor(random()*neighbors.length)], old=out.regions[i];
    out.regions[i]=out.regions[j];
    if (!Core.validate(out).valid) out.regions[i]=old;
  }
  return out;
}
// Reuses the original rank-based construction as a candidate source, not a difficulty verdict.
function constructive(seed, size) {
  const initial=candidate(seed,size), random=rng(seed+991), horses=initial.solution;
  for(let attempt=0;attempt<100;attempt++) {
    const order=Array.from({length:size},(_,i)=>i);
    for(let i=size-1;i>0;i--) {const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    const rank=Array(size);order.forEach((r,k)=>{rank[r]=k;});
    const early=Array.from({length:size*size},(_,i)=>{
      const r=Math.floor(i/size),c=i%size;
      return Math.min(...horses.flatMap((h,rr)=>(r===rr||c===h||(Math.abs(r-rr)<=1&&Math.abs(c-h)<=1))?[rank[rr]]:[]));
    });
    const regions=Array(size*size).fill(-1);horses.forEach((c,r)=>{regions[r*size+c]=r;});
    for(let filled=size;filled<size*size;filled++) {
      const edges=[];
      for(let i=0;i<regions.length;i++) if(regions[i]>=0) {
        for(const j of adjacent(i,size)) if(regions[j]===-1&&early[j]<rank[regions[i]]) edges.push([j,regions[i]]);
      }
      if(!edges.length) break;
      const [cell,region]=edges[Math.floor(random()*edges.length)];regions[cell]=region;
    }
    if(!regions.includes(-1))return{size,regions,solution:horses,seed,generatorVersion:VERSION,template:'rank'};
  }
  return null;
}
function search(seed,size,steps=100) {
  let current=constructive(seed,size);if(!current)return null;
  const random=rng(seed+1777);
  const singles=p=>{const counts=Array(size).fill(0);p.regions.forEach(r=>counts[r]++);return counts.filter(c=>c===1).length;};
  let count=singles(current);
  for(let i=0;i<steps;i++) {
    const next=mutate(current,seed+i*7919,3), nextCount=singles(next);
    if(nextCount>count)continue;
    const check=Core.countSolutions(next);
    if(check.status!=='complete'||check.count!==1||check.truncated)continue;
    if(nextCount<count||random()<.7){current=next;count=nextCount;}
  }
  return{...current,searchSteps:steps};
}
module.exports={version:VERSION,rng,candidate,mutate,constructive,search};
