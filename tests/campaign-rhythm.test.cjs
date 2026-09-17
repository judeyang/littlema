const test=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../scripts/audit-campaign-rhythm.cjs');
const profile={singletonCount:0,subsetSizes:[3],rules:['single','region-subset-lock'],proofDepth:3,premiseCount:6,workUnits:40,focusRegionCount:3,span:.4};
const analyze=p=>({status:'accepted',difficultyScore:p.score,analyzerVersion:'test',profile:{...profile,...p.profile}});
const record=(level,score,recoveryOfLevel=null)=>({level,puzzleId:`p${level}`,targetScore:score,recoveryOfLevel,puzzle:{score}});

test('rhythm audit checks every declared recovery against actual scores, not selected peak numbers',()=>{
  const levels=[record(23,40),record(24,46,23),record(25,30),record(26,36,25),record(28,30),record(29,38,28)];
  levels[1].targetScore=10;
  const r=audit({levels},{analyze});
  assert.equal(r.recoveries.length,3);
  assert.deepEqual(r.issues.filter(i=>i.code==='recovery-not-easier').map(i=>i.level),[24,26,29]);
  assert(r.issues.some(i=>i.code==='configured-score-mismatch'));
  assert.equal(r.status,'needs-correction');
});
test('small drops and missing same-subset practice remain separate review findings',()=>{
  const levels=[record(13,60),record(14,53,13),record(15,30,14)];
  levels[2].puzzle.profile={subsetSizes:[2]};
  const r=audit({levels},{analyze});
  assert(r.issues.some(i=>i.level===14&&i.code==='small-recovery-drop'));
  assert(r.issues.some(i=>i.level===15&&i.code==='subset-practice-not-observed'));
  assert(!r.issues.some(i=>i.severity==='error'));
  assert.equal(r.recoveries[0].load.proofDepth.before,3);
});
test('unknown analysis, broken references, duplicates and late singletons cannot pass',()=>{
  assert.throws(()=>audit({levels:[]},{analyze}));
  assert.throws(()=>audit({levels:[record(1,10),record(1,20)]},{analyze}));
  const duplicate=[record(1,10),record(2,20)];duplicate[1].puzzleId='p1';
  assert.throws(()=>audit({levels:duplicate},{analyze}));
  const levels=[record(9,10,99),record(10,20,10)];levels[0].puzzle.profile={singletonCount:1};
  const r=audit({levels},{analyze});
  assert.equal(r.issues.filter(i=>i.code==='invalid-recovery-source').length,2);
  assert(r.issues.some(i=>i.code==='late-singleton'));
  const unknown=audit({levels:[record(1,10)]},{analyze:()=>({status:'unknown',stage:'path-analysis'})});
  assert.equal(unknown.status,'needs-correction');assert.equal(unknown.rows[0].actualScore,undefined);
});
