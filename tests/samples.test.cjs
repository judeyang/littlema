const test=require('node:test');
const assert=require('node:assert/strict');
const pack=require('../data/development-samples.json');
const {audit}=require('../scripts/audit-puzzles.cjs');
const {run}=require('../scripts/generate-puzzles.cjs');
test('30 development samples and six same-size same-rule pairs pass admission',()=>{
  assert.equal(pack.status,'development-samples-not-campaign');
  assert.equal(pack.records.length,30);assert.equal(pack.comparisons.length,6);
  const result=audit(pack.records);assert.equal(result.status,'passed');assert.equal(result.transforms,240);
  for(const p of pack.records)assert.equal(p.analysis.profile.singletonCount,0);
  for(const pair of pack.comparisons){
    const hard=pack.records.find(p=>p.puzzleId===pair.challengeId),easy=pack.records.find(p=>p.puzzleId===pair.recoveryId);
    assert.equal(hard.size,easy.size);assert(hard.analysis.difficultyScore>easy.analysis.difficultyScore);assert(pair.sharedRules.length>0);
  }
  const long=pack.records.filter(p=>p.samplePurpose==='分离瓶颈与推进段长题');assert(long.length>0);
  for(const p of long){assert(p.analysis.profile.bottleneckEpisodes>=2);assert(p.analysis.profile.progressSegments.every(s=>s.progressPlacements>0));}
});
test('resource audit rejects changed answers, scores and duplicate signatures',()=>{
  const p=structuredClone(pack.records[0]);p.solution[0]=(p.solution[0]+1)%p.size;assert.throws(()=>audit([p]));
  const q=structuredClone(pack.records[0]);q.analysis.difficultyScore++;assert.throws(()=>audit([q]));
  assert.throws(()=>audit([pack.records[0],pack.records[0]]),/duplicate/);
});
test('candidate generation rejects invalid or misspelled configurations',()=>{
  for(const options of [{count:0},{sizeMin:8,sizeMax:6},{seed:NaN},{source:'typo'},{searchSteps:-1}])assert.throws(()=>run(options));
});
