const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../src/puzzle-core'),L=require('../src/logic-engine'),D=require('../src/difficulty');
const pack=require('../data/four-region-test');

test('isolated four-region puzzle is unique, zero-singleton and needs four even with current short hypotheses',()=>{
  assert.equal(pack.levels.length,1);
  const p=pack.levels[0].puzzle,counts=Array(p.size).fill(0);p.regions.forEach(g=>counts[g]++);assert(!counts.includes(1));
  let conclusions=0;
  for(let rotation=0;rotation<4;rotation++)for(const mirror of [false,true]){
    const q=D.transform(p,rotation,mirror),exact=C.countSolutions(q);
    assert.equal(exact.status,'complete');assert.equal(exact.count,1);assert.equal(exact.truncated,false);
    assert.equal(L.solve(q,{}, {maxTier:5,maxSubsetSize:3,budgetMs:5000}).status,'stalled');
    const full=L.solve(q,{}, {maxTier:4,maxSubsetSize:4,budgetMs:5000});
    assert.equal(full.status,'solved');assert(full.trace.some(s=>s.ruleId==='region-subset-lock'&&s.groups.length===4));
    assert(L.replay(q,{},full.trace).valid);
    const placed=[],excluded=[];
    for(const proof of full.trace){
      for(const i of proof.conclusion.place){const contrary=C.countSolutions(q,{placed,excluded:[...excluded,i]});assert.equal(contrary.status,'complete');assert.equal(contrary.count,0);conclusions++;}
      for(const i of proof.conclusion.exclude){const contrary=C.countSolutions(q,{placed:[...placed,i],excluded});assert.equal(contrary.status,'complete');assert.equal(contrary.count,0);conclusions++;}
      placed.push(...proof.conclusion.place);excluded.push(...proof.conclusion.exclude);
    }
  }
  assert.equal(conclusions,648);
});

test('hash entry selects test content before Game loads and keeps default campaign unchanged',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const hash of ['#demo', '#pack=four&demo', '#pack=four-other&demo']){
    const listeners={};let reloads=0;
    const context={location:{hash,reload(){reloads++;}},document:{title:''},setTimeout(){},clearTimeout(){},addEventListener(name,fn){listeners[name]=fn;}};
    context.window=context;vm.createContext(context);
    for(const [,src] of html.matchAll(/<script src="([^"]+)"/g))vm.runInContext(fs.readFileSync(path.join(__dirname,'..',src),'utf8'),context);
    const isTest=hash==='#pack=four&demo';
    assert.equal(context.GameCampaign.levels.length,isTest?1:100);
    assert.equal(context.ProgressStore.KEY,isTest?'pony-run-four-test-v12':'pony-run-progress-v11');
    if(isTest)assert(context.document.title.includes('四区域独立试玩'));
    const game=context.Game;game.render=()=>{};game.hideModal=()=>{};game.toast=()=>{};game.newRound();
    assert.equal(game.puzzleId,context.GameCampaign.levels[0].puzzleId);
    assert.equal(game.size,isTest?9:5);
    assert.equal(L.solve({size:game.size,regions:Array.from(game.regions)}, {}, {budgetMs:5000}).status,'solved');
    assert.notEqual(game.findHint().type,'none');
    listeners.hashchange();assert.equal(reloads,0);
    context.location.hash=isTest?'#demo':'#pack=four&demo';listeners.hashchange();assert.equal(reloads,1);
  }
});
