const fs=require('node:fs');
const S=require('./puzzle-source.cjs');
const C=require('../src/puzzle-core.js');
const L=require('../src/logic-engine.js');
const D=require('../src/difficulty.js');

// Four selected regions are confined to the upper half, while four other
// regions cross into it. This makes a four-region row lock capable of having
// real exclusion targets instead of being a decorative layout.
const BASE={size:8,regions:[
  0,0,1,1,2,2,3,3, 0,0,1,1,2,2,3,3,
  0,0,1,1,2,2,3,3, 0,4,1,5,2,6,3,7,
  4,4,5,5,6,6,7,7, 4,4,5,5,6,6,7,7,
  4,4,5,5,6,6,7,7, 4,4,5,5,6,6,7,7
]};

function partition(seed){
  const random=S.rng(seed),regions=Array(64).fill(-1);
  [[0,0,0],[1,1,2],[2,2,4],[3,3,6],[4,7,1],[5,7,3],[6,7,5],[7,7,7]].forEach(([id,row,col])=>regions[row*8+col]=id);
  const neighbors=i=>{const r=Math.floor(i/8),c=i%8;return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([rr,cc])=>rr>=0&&rr<8&&cc>=0&&cc<8).map(([rr,cc])=>rr*8+cc)};
  while(regions.includes(-1)){
    const edges=[];
    for(let i=0;i<64;i++)if(regions[i]<0)for(const j of neighbors(i))if(regions[j]>=0)edges.push([i,regions[j]]);
    if(!edges.length)return null;
    const [cell,region]=edges[Math.floor(random()*edges.length)];
    if(region<4&&Math.floor(cell/8)>=4)continue;
    regions[cell]=region;
  }
  const p={size:8,regions};
  return C.validate(p).valid?p:null;
}

function mutateBand(puzzle,seed,moves=4){
  const out={size:puzzle.size,regions:puzzle.regions.slice()},random=S.rng(seed);
  const adjacent=i=>{const r=Math.floor(i/8),c=i%8;return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([rr,cc])=>rr>=0&&rr<8&&cc>=0&&cc<8).map(([rr,cc])=>rr*8+cc)};
  for(let m=0;m<moves;m++){
    const i=Math.floor(random()*64), neighbors=adjacent(i), j=neighbors[Math.floor(random()*neighbors.length)],old=out.regions[i];
    out.regions[i]=out.regions[j];
    const staysUpper=out.regions.every((region,index)=>region>=4||index<32);
    if(!staysUpper||!C.validate(out).valid)out.regions[i]=old;
  }
  return out;
}

function admit(puzzle){
  const report=D.analyze(puzzle,{budgetMs:10000,maxStates:1000});
  if(report.status!=='accepted')return report;
  if(report.profile.singletonCount||!report.trace.some(s=>s.ruleId==='region-subset-lock'&&s.groups.length===4))return{status:'rejected',reason:'no-eligible-four-region-proof'};
  const limited=L.solve(report.puzzle,{}, {maxTier:report.profile.requiredRuleTier,maxSubsetSize:3,budgetMs:10000});
  if(limited.status==='unknown')return{status:'unknown',stage:'four-region-necessity'};
  if(limited.status!=='stalled')return{status:'rejected',reason:'four-region-bypass'};
  const hypothesis=L.solve(report.puzzle,{}, {maxTier:5,maxSubsetSize:3,budgetMs:10000});
  return{...report,fourRegionAdmission:{limitedStatus:limited.status,allowedTier:report.profile.requiredRuleTier,hypothesisAlternative:hypothesis.status,boundary:'supported-rule-closure-only'}};
}

function run(iterations=100000){
  const random=S.rng(48110915),pool=[BASE],seen=new Set(),found=[];
  const stats={iterations,valid:0,unique:0,fourUsed:0};
  for(let i=0;i<iterations;i++){
    const parent=pool[Math.floor(random()*Math.min(pool.length,32))];
    const p=i%3===0?partition(48110915+i*97):mutateBand(parent,48110915+i*97,1+Math.floor(random()*8));
    if(!C.validate(p).valid)continue;stats.valid++;
    const key=D.canonical(p).signature;if(seen.has(key))continue;seen.add(key);
    const exact=C.countSolutions(p,{limit:2});
    // Keep valid candidates in the evolutionary pool. A unique solution is
    // the admission gate, not the only state allowed to produce descendants.
    pool.push(p);if(pool.length>96)pool.splice(48,1);
    if(exact.status!=='complete'||exact.count!==1||exact.truncated)continue;stats.unique++;
    const result=L.solve(p,{}, {maxTier:3,budgetMs:1000});
    const four=result.trace.some(step=>step.ruleId==='region-subset-lock'&&step.groups.length===4);
    if(!four)continue;stats.fourUsed++;
    const report=admit(p);
    if(report.status==='accepted'){
      found.push({seed:48110915+i*97,...report});
      if(found.length>=8)break;
    }
  }
  return{config:{iterations,seed:48110915,version:'four-region-row-lock-1.1-necessity-gated'},stats,found};
}

if(require.main===module){const output=process.argv[2];if(!output)throw new Error('output path required');const result=run(Number(process.argv[3]||100000));fs.writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify({stats:result.stats,found:result.found.length}));}
module.exports={BASE,partition,mutateBand,admit,run};
