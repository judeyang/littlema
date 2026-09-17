const fs=require('node:fs');
const S=require('./puzzle-source.cjs');
const C=require('../src/puzzle-core.js');
const L=require('../src/logic-engine.js');
const D=require('../src/difficulty.js');
function run(iterations=3000) {
  const base={size:8,regions:Array.from({length:64},(_,i)=>Math.floor((i%8)/2)+(i<32?0:4)),solution:[0,2,4,6,1,3,5,7]};
  const random=S.rng(48110915), pool=[{p:base,count:2576}],seen=new Set(),found=[];
  let checked=0,minCount=2576;
  for(let i=0;i<iterations;i++) {
    const parent=pool[Math.floor(random()*Math.min(12,pool.length))];
    const p=S.mutate(parent.p,48110915+i*53,1+Math.floor(random()*6));
    if(p.regions.some((r,i)=>r<4&&i>=32))continue;
    const counts=Array(8).fill(0);p.regions.forEach(r=>counts[r]++);if(counts.includes(1))continue;
    const key=D.canonical(p).signature;if(seen.has(key))continue;seen.add(key);
    // No one/two/three-set shortcut at the opening: this is a structural target, not a score bonus.
    const state=L.createState(p), opening=L.derive(state,{maxTier:2});
    if(opening.status!=='stalled')continue;
    const lower=L.derive(state,{maxTier:3});
    if(lower.status==='progress'&&lower.steps.every(s=>s.groups.length<4))continue;
    const exact=C.countSolutions(p,{limit:3000});checked++;
    if(exact.status!=='complete'||!exact.count)continue;
    minCount=Math.min(minCount,exact.count);
    pool.push({p,count:exact.count});pool.sort((a,b)=>a.count-b.count);
    if(pool.length>32)pool.splice(24,1);
    if(exact.count===1) {
      const a=D.analyze(p);if(a.status==='accepted'&&a.profile.subsetSizes.includes(4))found.push({iteration:i,...a});
    }
  }
  return{config:{iterations,seed:48110915,version:'hall4-1.0'},checked,minCount,found};
}
if(require.main===module) {
  const out=process.argv[2];if(!out)throw new Error('output path required');
  const result=run(Number(process.argv[3]||3000));fs.writeFileSync(out,JSON.stringify(result));console.log(JSON.stringify({...result,found:result.found.length}));
}
module.exports={run};
