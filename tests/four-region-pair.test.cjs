const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../src/puzzle-core'),L=require('../src/logic-engine'),D=require('../src/difficulty'),P=require('../src/hint-presenter');
const pack=require('../data/four-region-pair-test'),main=require('../data/campaign');
const {admit}=require('../scripts/search-four-region.cjs');
const answerKey=p=>{const keys=[];for(let r=0;r<4;r++)for(const m of [false,true])keys.push(D.transform(p,r,m).solution.join(','));return keys.sort()[0];};

test('four-region search admission rejects decorative or bypassed structures',()=>{
  const accepted=admit(pack.levels[1].puzzle);assert.equal(accepted.status,'accepted');assert.equal(accepted.fourRegionAdmission.limitedStatus,'stalled');
  assert.equal(admit(main.levels[0].puzzle).status,'rejected');
  const bypass={size:9,regions:'EEECAABBB EEECCABBB EEECCCBDD EECCEEBDD EEEEEEHHF EGGEEEHHF EEGHHHHHH EIIHHHHHH EIIHHHHHH'.replace(/ /g,'').split('').map(c=>c.charCodeAt(0)-65)};
  assert.equal(admit(bypass).reason,'four-region-bypass');
  const decorative={size:4,regions:Array.from({length:16},(_,i)=>Math.floor(i/4))};assert.equal(admit(decorative).status,'rejected');
  assert.equal(admit({size:0,regions:[]}).status,'invalid');
});

test('pair pack has two different deduction entrances, a genuine lower-load recovery and a new answer skeleton',()=>{
  assert.equal(pack.levels.length,4);const reports=pack.levels.map(x=>D.analyze(x.puzzle,{budgetMs:10000,maxStates:1000}));
  const signatures=new Set();reports.forEach((r,i)=>{assert.equal(r.status,'accepted');assert.equal(r.difficultyScore,pack.levels[i].targetScore);assert.equal(r.profile.singletonCount,0);assert(!signatures.has(r.signature));signatures.add(r.signature);});
  const entrances=pack.levels.slice(0,2).map(x=>{
    const trace=L.solve(x.puzzle,{}, {maxTier:x.allowedTier,budgetMs:10000}).trace;
    const four=trace.find(s=>s.ruleId==='region-subset-lock'&&s.groups.length===4);assert(four);
    const ids=new Set(four.groups.map(g=>g.index));
    return {raw:new Set(x.puzzle.regions.flatMap((g,i)=>ids.has(g)?[Math.floor(i/x.size)]:[])).size,remaining:four.targetGroups.length,premises:four.premises.length};
  });
  assert.equal(entrances[0].raw,4);assert.equal(entrances[1].raw,5);assert.equal(entrances[1].remaining,4);assert(entrances[1].premises>0);
  const hard=reports[1],easy=reports[2];assert(hard.profile.subsetSizes.includes(4)&&easy.profile.subsetSizes.includes(4));
  assert(hard.difficultyScore-easy.difficultyScore>=12);assert(easy.profile.proofDepth<hard.profile.proofDepth);assert.equal(easy.profile.forcedStepsInHypothesis,0);assert(hard.profile.forcedStepsInHypothesis>0);
  assert.equal(pack.levels[2].recoveryOfLevel,2);
  for(const n of [18,20,27,31])assert.notEqual(answerKey(pack.levels[3].puzzle),answerKey(main.levels[n-1].puzzle));
});

test('all pair levels remain unique and explainable under eight transforms with independent conclusion checks',()=>{
  let checked=0;
  for(const level of pack.levels)for(let r=0;r<4;r++)for(const m of [false,true]){
    const p=D.transform(level.puzzle,r,m),exact=C.countSolutions(p);assert.equal(exact.status,'complete');assert.equal(exact.count,1);assert(!exact.truncated);
    const full=L.solve(p,{}, {maxTier:level.allowedTier,budgetMs:10000});assert.equal(full.status,'solved');assert(L.replay(p,{},full.trace).valid);
    if(level.level<=3){const low=L.solve(p,{}, {maxTier:level.allowedTier,maxSubsetSize:3,budgetMs:10000});assert.equal(low.status,'stalled');assert(full.trace.some(s=>s.ruleId==='region-subset-lock'&&s.groups.length===4));}
    const placed=[],excluded=[],prior=[];
    for(const proof of full.trace){
      const hint=P.toLegacyHint({type:proof.conclusion.place.length?'horse':'exclude',targets:[...proof.conclusion.place,...proof.conclusion.exclude],proof,prerequisites:prior},p);assert.notEqual(hint.type,'none',hint.reason);
      for(const cell of proof.conclusion.place){const q=C.countSolutions(p,{placed,excluded:[...excluded,cell]});assert.equal(q.status,'complete');assert.equal(q.count,0);checked++;}
      for(const cell of proof.conclusion.exclude){const q=C.countSolutions(p,{placed:[...placed,cell],excluded});assert.equal(q.status,'complete');assert.equal(q.count,0);checked++;}
      placed.push(...proof.conclusion.place);excluded.push(...proof.conclusion.exclude);prior.push(proof);
    }
  }
  assert.equal(checked,2336);
});

test('pair entry uses isolated progress, can resume and switch to the next selected puzzle',()=>{
  const data=new Map([['pony-run-progress-v11','main untouched'],['pony-run-four-test-v12','single untouched']]);
  const context={location:{hash:'#pack=four-pair&demo',reload(){}},document:{title:''},setTimeout(){},clearTimeout(){},addEventListener(){},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
  context.window=context;vm.createContext(context);const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const [,src] of html.matchAll(/<script src="([^"]+)"/g))vm.runInContext(fs.readFileSync(path.join(__dirname,'..',src),'utf8'),context);
  assert.equal(context.GameCampaign.levels.length,4);assert.equal(context.ProgressStore.KEY,'pony-run-four-pair-test-v12');
  const game=context.Game;game.render=()=>{};game.hideModal=()=>{};game.toast=()=>{};
  game.level=2;game.newRound();game.candidates.add(0);game.saveProgress();const saved=context.ProgressStore.load();assert.equal(saved.status,'ok');game.newRound({resume:saved.data});assert(game.candidates.has(0));
  game.level=3;game.newRound();assert.equal(game.puzzleId,pack.levels[2].puzzleId);assert(!game.candidates.has(0));assert.notEqual(game.findHint().type,'none');
  assert.equal(data.get('pony-run-progress-v11'),'main untouched');assert.equal(data.get('pony-run-four-test-v12'),'single untouched');
});
