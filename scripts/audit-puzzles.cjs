const fs=require('node:fs');
const assert=require('node:assert/strict');
const C=require('../src/puzzle-core.js');
const L=require('../src/logic-engine.js');
const D=require('../src/difficulty.js');
function audit(records) {
  const seen=new Set();let transforms=0,proofs=0;
  for(const p of records) {
    assert(C.validate(p).valid,p.puzzleId);assert(C.validateSolution(p,p.solution),p.puzzleId);
    assert(!seen.has(p.signature),'duplicate signature');seen.add(p.signature);
    const a=D.analyze(p);assert.equal(a.status,'accepted',p.puzzleId);
    assert.equal(a.signature,p.signature);assert.equal(a.analyzerVersion,p.analysis.analyzerVersion);
    assert.equal(a.difficultyScore,p.analysis.difficultyScore);
    assert.equal(a.profile.requiredRuleTier,p.analysis.profile.requiredRuleTier);
    assert(L.replay(a.puzzle,{},a.trace).valid);proofs+=a.trace.length;
    for(let r=0;r<4;r++)for(const m of [false,true]) {
      const t=D.transform(p,r,m), tier=a.profile.requiredRuleTier;
      const exact=C.countSolutions(t);assert.equal(exact.status,'complete');assert.equal(exact.count,1);assert.equal(exact.truncated,false);
      assert.equal(L.solve(t,{}, {maxTier:tier}).status,'solved');
      if(tier>0)assert.equal(L.solve(t,{}, {maxTier:tier-1}).status,'stalled','weaker-rule rotation discrepancy');
      transforms++;
    }
  }
  return{records:records.length,transforms,proofs,status:'passed',analyzerVersion:D.version};
}
if(require.main===module){const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(audit(raw.records||raw)));}
module.exports={audit};
