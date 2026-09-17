const fs=require('node:fs');
const S=require('./puzzle-source.cjs');
const C=require('../src/puzzle-core.js');
const D=require('../src/difficulty.js');

// Region silhouette transcribed from the user-provided level 66 screenshot.
// It is a seed for finding a family, not a copied hidden answer.
const REFERENCE={size:7,regions:[
  0,0,0,0,0,1,1,
  0,2,2,2,1,1,1,
  2,2,3,3,3,4,4,
  2,2,3,3,3,3,3,
  2,2,5,5,3,3,3,
  2,2,5,6,6,6,6,
  6,6,6,6,6,6,6
]};

function mutate(puzzle,seed,moves=4){
  const random=S.rng(seed),out={size:puzzle.size,regions:puzzle.regions.slice()};
  const adjacent=i=>{const n=7,r=Math.floor(i/n),c=i%n;return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([rr,cc])=>rr>=0&&rr<n&&cc>=0&&cc<n).map(([rr,cc])=>rr*n+cc)};
  for(let m=0;m<moves;m++){
    const i=Math.floor(random()*49),near=adjacent(i),j=near[Math.floor(random()*near.length)],old=out.regions[i];
    out.regions[i]=out.regions[j];
    if(!C.validate(out).valid)out.regions[i]=old;
  }
  return out;
}

function run(iterations=12000){
  const random=S.rng(660915),pool=[REFERENCE],seen=new Set(),found=[];
  const stats={iterations,valid:0,unique:0,accepted:0};
  for(let i=0;i<iterations;i++){
    const parent=pool[Math.floor(random()*Math.min(pool.length,40))];
    const p=mutate(parent,660915+i*113,1+Math.floor(random()*8));
    if(!C.validate(p).valid)continue;stats.valid++;
    const key=D.canonical(p).signature;if(seen.has(key))continue;seen.add(key);
    const exact=C.countSolutions(p,{limit:2});
    pool.push(p);if(pool.length>100)pool.splice(50,1);
    if(exact.status!=='complete'||exact.count!==1)continue;stats.unique++;
    const report=D.analyze(p,{budgetMs:3000});
    if(report.status==='accepted'&&report.profile.singletonCount===0&&report.difficultyScore>=70&&report.profile.requiredRuleTier>=4){
      stats.accepted++;found.push({seed:660915+i*113,...report});
      if(found.length>=12)break;
    }
  }
  return{config:{iterations,seed:660915,version:'level-66-family-1.0'},stats,found};
}

if(require.main===module){const output=process.argv[2];if(!output)throw new Error('output path required');const result=run(Number(process.argv[3]||12000));fs.writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify({stats:result.stats,found:result.found.length}));}
module.exports={REFERENCE,mutate,run};
