const fs=require('node:fs');
const path=require('node:path');
const S=require('./puzzle-source.cjs');
const C=require('../src/puzzle-core.js');
const L=require('../src/logic-engine.js');
const D=require('../src/difficulty.js');
// Transcribed reference is a search seed only, never an asserted required-four puzzle.
const reference={size:8,regions:[[0,0,1,1,1,1,2,2],[0,0,0,0,1,2,2,2],[0,0,0,0,3,3,3,2],[0,0,0,4,3,3,3,3],[0,5,4,4,4,3,3,3],[5,5,6,4,4,3,3,3],[5,6,6,7,4,3,3,3],[5,7,7,7,4,3,3,3]].flat()};
function run(iterations=3000) {
  reference.solution=C.countSolutions(reference).solutions[0];
  const random=S.rng(630915), pool=[{p:reference,fitness:0}], found=[],seen=new Set();
  const stats={iterations,valid:0,unique:0,solvedTier3:0,fourUsed:0};
  for(let i=0;i<iterations;i++) {
    const parent=pool[Math.floor(random()*pool.length)];
    const p=S.mutate(parent.p,630915+i*31,1+Math.floor(random()*12));
    if(!C.validate(p).valid)continue;stats.valid++;
    const signature=D.canonical(p).signature;if(seen.has(signature))continue;seen.add(signature);
    const exact=C.countSolutions(p);if(exact.status!=='complete'||exact.count!==1||exact.truncated)continue;stats.unique++;
    const result=L.solve(p,{}, {maxTier:3}), four=result.trace.some(s=>s.ruleId.includes('subset')&&s.groups.length===4);
    if(result.status==='solved')stats.solvedTier3++;
    const counts=Array(p.size).fill(0);p.regions.forEach(r=>counts[r]++);
    const weak=L.solve(p,{}, {maxTier:2});
    const fitness=(four?100:0)+result.state.placed.size*3-weak.state.placed.size*2-counts.filter(c=>c===1).length*20;
    pool.push({p,fitness});pool.sort((a,b)=>b.fitness-a.fitness);
    if(pool.length>40)pool.splice(30,1); // Retain high-scoring and some diverse recent candidates.
    if(four&&result.status==='solved'&&!counts.includes(1)) {
      stats.fourUsed++;const a=D.analyze(p);if(a.status==='accepted'&&a.profile.subsetSizes.includes(4))found.push({seed:630915+i*31,...a});
    }
  }
  return{stats,found};
}
if(require.main===module) {
  const output=process.argv[2];if(!output)throw new Error('output path required');
  const result=run(Number(process.argv[3]||3000));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result));
  console.log(JSON.stringify({stats:result.stats,found:result.found.length}));
}
module.exports={run};
