const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/difficulty.js');
const S = require('../scripts/puzzle-source.cjs');
const L = require('../src/logic-engine.js');

test('source seed, configuration and version are deterministic', () => {
  assert.deepEqual(S.search(20260916,6), S.search(20260916,6));
  assert.throws(()=>S.candidate(1,0));
});
test('canonical key handles eight symmetries and relabeling', () => {
  const p = S.search(20260916,6), original = D.analyze(p);
  assert.equal(original.status,'accepted'); assert.equal(original.profile.singletonCount,0);
  for(let r=0;r<4;r++)for(const m of [false,true]) {
    const t=D.transform(p,r,m);t.regions=t.regions.map(x=>p.size-1-x);
    const a=D.analyze(t);
    assert.equal(a.signature,original.signature);
    assert.deepEqual(a.profile,original.profile);
  }
});
test('difficulty keeps proof necessity, progress, path limits and unknown separate', () => {
  const p=S.search(20260916,6), a=D.analyze(p);
  assert.equal(a.status,'accepted');assert(a.profile.requiredRuleTier>0);
  assert.equal(L.solve(a.puzzle,{}, {maxTier:a.profile.requiredRuleTier-1}).status,'stalled');
  assert(a.profile.progressSegments.some(s=>s.progressPlacements>0));
  assert.equal(a.paths.guarantee,'bounded-paths-only');
  assert.equal(D.analyze(p,{maxStates:0}).status,'unknown');
  assert.equal(D.analyze(p,{exact:{maxNodes:0}}).status,'unknown');
  assert.equal(D.analyze({size:0}).status,'invalid');
  assert.equal(D.analyze({size:4,regions:Array.from({length:16},(_,i)=>Math.floor(i/4))}).reason,'multiple-solutions');
});

test('three-step contradiction explores alternative singles after rotation', () => {
  const p=S.search(20261323,8), a=D.analyze(p);
  assert.equal(a.status,'accepted');
  for(let r=0;r<4;r++)for(const m of [false,true]) {
    const result=L.solve(D.transform(a.puzzle,r,m));
    assert.equal(result.status,'solved',`${r}/${m}`);
    for(const step of result.trace)if(step.contradiction)assert(step.contradiction.steps.length<=3);
  }
});
