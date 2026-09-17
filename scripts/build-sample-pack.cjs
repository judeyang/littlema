const fs=require('node:fs');
const path=require('node:path');
const {audit}=require('./audit-puzzles.cjs');
const Difficulty=require('../src/difficulty.js');
function build(data) {
  const pool=data.records.filter(r=>r.analysis.profile.singletonCount===0), chosen=[], comparisons=[];
  function add(r,label) {if(!r)throw new Error(`missing sample ${label}`);if(chosen.some(s=>s.puzzleId===r.puzzleId))return;chosen.push({...r,samplePurpose:label});}
  function range(size,tier){return pool.filter(r=>r.size===size&&r.analysis.profile.requiredRuleTier===tier).sort((a,b)=>a.analysis.difficultyScore-b.analysis.difficultyScore);}
  for(const [size,tier] of [[5,1],[6,1],[7,1],[7,2],[7,4],[8,4]]) {
    const list=range(size,tier), easy=list[0],hard=list[list.length-1];
    add(hard,'同尺寸挑战候选');add(easy,'同技巧缓和候选');
    comparisons.push({size,tier,challengeId:hard.puzzleId,recoveryId:easy.puzzleId,
      challengeScore:hard.analysis.difficultyScore,recoveryScore:easy.analysis.difficultyScore,
      sharedRules:hard.analysis.profile.rules.filter(r=>easy.analysis.profile.rules.includes(r)&&!['single','placed-exclusion'].includes(r))});
  }
  for(const tier of [3,5]) for(const r of pool.filter(r=>r.analysis.profile.requiredRuleTier===tier).slice(0,5))add(r,tier===3?'三组联合候选':'单层短反证候选');
  for(const size of [5,6,7,8,9]) {
    const short=pool.find(r=>r.size===size&&r.analysis.profile.requiredRuleTier>=2&&r.analysis.profile.bottleneckEpisodes===1);
    const long=pool.find(r=>r.size===size&&r.analysis.profile.requiredRuleTier>=2&&r.analysis.profile.bottleneckEpisodes>=2&&r.analysis.profile.bottleneckEpisodes<=4&&r.analysis.profile.progressSegments.every(s=>s.progressPlacements>0));
    add(short,'单关键瓶颈短题');add(long,'分离瓶颈与推进段长题');
  }
  for(const r of pool) {if(chosen.length>=30)break;add(r,'补充观察样题');}
  const records=chosen.slice(0,30).map(r=>{
    const a=Difficulty.analyze(r);
    if(a.status!=='accepted')throw new Error('sample failed reanalysis');
    return{...r,analysis:{...r.analysis,ablations:a.ablations,subsetAblations:a.subsetAblations}};
  }), validation=audit(records);
  return{status:'development-samples-not-campaign',config:data.config,analyzerVersion:data.analyzerVersion,
    comparisons,validation,records};
}
if(require.main===module) {
  const input=process.argv[2],output=process.argv[3];if(!input||!output)throw new Error('input and output required');
  const pack=build(JSON.parse(fs.readFileSync(input,'utf8')));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(pack,null,2));
  console.log(JSON.stringify({validation:pack.validation,comparisons:pack.comparisons,records:pack.records.length}));
}
module.exports={build};
