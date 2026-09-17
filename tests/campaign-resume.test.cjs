const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const progressSource=fs.readFileSync(path.join(__dirname,'../src/progress-store.js'),'utf8');
const gameSource=fs.readFileSync(path.join(__dirname,'../game.js'),'utf8');

function fingerprint(p){
  return JSON.stringify({size:p.size,regions:p.regions,solution:p.solution,colorMap:p.colorMap||null});
}

function makePuzzle(size=5,variant=0){
  const odds=[],evens=[];
  for(let i=1;i<size;i+=2)odds.push(i);
  for(let i=0;i<size;i+=2)evens.push(i);
  const regions=Array.from({length:size*size},(_,i)=>Math.floor(i/size));
  if(variant)regions[0]=variant;
  return {size,regions,solution:[...odds,...evens]};
}

function makeCampaign(){
  const levels=Array.from({length:100},(_,i)=>{
    const level=i+1;
    const size=level===31?9:level===99?7:level===100?11:5;
    const puzzle=makePuzzle(size);
    return {level,puzzleId:`p-${level}`,puzzle};
  });
  return {
    campaignVersion:'v1.2-local-100.0',
    levels,
    resumeCompatibility:{
      campaignVersion:'v1.1-local-30.4',
      records:levels.slice(0,30).map(({level,puzzleId,puzzle})=>({level,puzzleId,fingerprint:fingerprint(puzzle)}))
    }
  };
}

function memoryStorage(initial=[]){
  const map=new Map(initial);
  return {
    map,
    getItem:key=>map.has(key)?map.get(key):null,
    setItem:(key,value)=>map.set(key,String(value)),
    removeItem:key=>map.delete(key)
  };
}

function snapshot(campaign,level,overrides={}){
  const record=campaign.levels[level-1],horse=record.puzzle.solution[0];
  const missed=horse===0?1:0;
  return {
    schema:1,level,puzzleId:record.puzzleId,campaignVersion:'v1.1-local-30.4',size:record.puzzle.size,
    stars:1,streak:4,status:'playing',revealed:[horse],missed:[missed],candidates:[horse],...overrides
  };
}

function loadGame(campaign,storage,{key,hash='#demo'}={}){
  const timers=[],messages=[];
  const context={
    location:{hash},localStorage:storage,addEventListener(){},clearTimeout(){},
    setTimeout(fn){timers.push(fn);fn();return timers.length;}
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(progressSource,context);
  if(key)context.ProgressStore=context.ProgressStore.create(key);
  context.GameCampaign=campaign;
  vm.runInContext(gameSource,context);
  const game=context.Game;
  game.bindUI=()=>{};
  game.render=()=>{};
  game.hideModal=()=>{};
  game.toast=message=>messages.push(message);
  game.runDemo=()=>{};
  return {context,game,messages};
}

function attachModal(game){
  const classes=new Set();
  const node=()=>({textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}});
  Object.assign(game,{modal:node(),modalEmoji:node(),modalTitle:node(),modalDesc:node(),modalPrimary:node(),modalSecondary:node()});
  game.hideModal=()=>classes.delete('show');
  return classes;
}

test('legacy level 1-30 resumes only through frozen compatibility and backs up before upgrade',()=>{
  const campaign=makeCampaign(),old=snapshot(campaign,18);
  const raw=JSON.stringify(old),storage=memoryStorage([['pony-run-progress-v11',raw]]);
  const {context,game}=loadGame(campaign,storage);
  game.start();
  assert.equal(game.level,18);
  assert.equal(game.stars,1);
  assert.equal(game.streak,4);
  assert.deepEqual([...game.revealed],old.revealed);
  assert.deepEqual([...game.missed],old.missed);
  assert.deepEqual([...game.candidates],old.candidates,'player crosses restore but are not treated as facts');
  assert.equal(storage.getItem(context.ProgressStore.BACKUP_KEY),raw);
  const upgraded=JSON.parse(storage.getItem(context.ProgressStore.KEY));
  assert.equal(upgraded.campaignVersion,campaign.campaignVersion);
  assert.equal(upgraded.puzzleFingerprint,fingerprint(campaign.levels[17].puzzle));
});

test('current-version resume requires the exact puzzle fingerprint even when level, id and size match',()=>{
  const campaign=makeCampaign(),record=campaign.levels[9];
  const good=snapshot(campaign,10,{campaignVersion:campaign.campaignVersion,puzzleFingerprint:fingerprint(record.puzzle)});
  let storage=memoryStorage([['pony-run-progress-v11',JSON.stringify(good)]]);
  let loaded=loadGame(campaign,storage);loaded.game.start();
  assert.equal(loaded.game.streak,4);assert.equal(loaded.game.revealed.size,1);

  const altered=makePuzzle(record.puzzle.size,4);
  for(const stale of [
    snapshot(campaign,10,{campaignVersion:campaign.campaignVersion,puzzleFingerprint:fingerprint(altered)}),
    snapshot(campaign,10,{campaignVersion:campaign.campaignVersion})
  ]){
    storage=memoryStorage([['pony-run-progress-v11',JSON.stringify(stale)]]);
    loaded=loadGame(campaign,storage);loaded.game.start();
    assert.equal(loaded.game.streak,0);assert.equal(loaded.game.revealed.size,0);assert.equal(loaded.game.missed.size,0);
    assert.equal(storage.getItem(loaded.context.ProgressStore.BACKUP_KEY),JSON.stringify(stale));
  }
});

test('legacy level 31 and unknown campaign versions keep the level but never reuse old marks',()=>{
  const campaign=makeCampaign();
  for(const old of [snapshot(campaign,31),snapshot(campaign,20,{campaignVersion:'unknown-version'})]){
    const raw=JSON.stringify(old),storage=memoryStorage([['pony-run-progress-v11',raw]]);
    const {context,game}=loadGame(campaign,storage);game.start();
    assert.equal(game.level,old.level);
    assert.equal(game.streak,0);assert.equal(game.stars,2);
    assert.equal(game.revealed.size,0);assert.equal(game.missed.size,0);assert.equal(game.candidates.size,0);
    assert.equal(storage.getItem(context.ProgressStore.BACKUP_KEY),raw);
  }
});

test('revealed and missed cells must match the answer while candidate crosses remain untrusted',()=>{
  const campaign=makeCampaign(),record=campaign.levels[4],horse=record.puzzle.solution[0];
  const current={campaignVersion:campaign.campaignVersion,puzzleFingerprint:fingerprint(record.puzzle)};
  for(const bad of [
    snapshot(campaign,5,{...current,revealed:[horse===0?1:0]}),
    snapshot(campaign,5,{...current,missed:[horse]})
  ]){
    const storage=memoryStorage([['pony-run-progress-v11',JSON.stringify(bad)]]);
    const {game}=loadGame(campaign,storage);game.start();
    assert.equal(game.revealed.size,0);assert.equal(game.missed.size,0);assert.equal(game.streak,0);
  }
  const candidateOnHorse=snapshot(campaign,5,{...current,candidates:[horse]});
  const storage=memoryStorage([['pony-run-progress-v11',JSON.stringify(candidateOnHorse)]]);
  const {game}=loadGame(campaign,storage);game.start();
  assert(game.candidates.has(horse));assert.equal(game.streak,4);
});

test('corrupt storage is backed up before a fresh snapshot replaces it',()=>{
  const campaign=makeCampaign(),raw='not-json';
  const storage=memoryStorage([['pony-run-progress-v11',raw]]);
  const {context,game}=loadGame(campaign,storage);game.start();
  assert.equal(game.level,1);assert.equal(game.status,'playing');
  assert.equal(storage.getItem(context.ProgressStore.BACKUP_KEY),raw);
  assert.doesNotThrow(()=>JSON.parse(storage.getItem(context.ProgressStore.KEY)));
});

test('a different existing backup is preserved while the new raw gets its own backup and remains writable',()=>{
  const campaign=makeCampaign(),old=snapshot(campaign,12),raw=JSON.stringify(old),existing='different backup';
  const storage=memoryStorage([['pony-run-progress-v11',raw],['pony-run-progress-v11-backup',existing]]);
  const {game,messages}=loadGame(campaign,storage);game.start();
  assert.equal(game.level,12);assert.equal(game.streak,4,'compatible state may be used in memory');
  game.candidates.add(2);game.saveProgress();
  assert.notEqual(storage.getItem('pony-run-progress-v11'),raw);
  assert.equal(storage.getItem('pony-run-progress-v11-backup'),existing);
  const secondary=[...storage.map.entries()].filter(([key])=>key.startsWith('pony-run-progress-v11-backup-'));
  assert.deepEqual(secondary.map(([,value])=>value),[raw]);
  assert(!messages.some(message=>message.includes('本次进度不会保存')));
});

test('backup write failure and forced-level restart never overwrite an unprotected snapshot',()=>{
  const campaign=makeCampaign(),old=snapshot(campaign,8),raw=JSON.stringify(old);
  for(const hash of ['#demo','#l=20&demo']){
    const map=new Map([['pony-run-progress-v11',raw]]);
    const storage={
      getItem:key=>map.has(key)?map.get(key):null,
      setItem(key,value){if(key.endsWith('-backup'))throw new Error('quota');map.set(key,String(value));},
      removeItem:key=>map.delete(key)
    };
    const {game,messages}=loadGame(campaign,storage,{hash});game.start();
    assert.equal(game.level,hash.includes('l=20')?20:8);
    game.candidates.add(4);game.saveProgress();game.newRound();
    assert.equal(storage.getItem('pony-run-progress-v11'),raw);
    assert.equal(storage.getItem('pony-run-progress-v11-backup'),null);
    assert(messages.some(message=>message.includes('本次进度不会保存')));
  }
});

test('forced-level restart backs up a readable snapshot before replacing it',()=>{
  const campaign=makeCampaign(),old=snapshot(campaign,8),raw=JSON.stringify(old);
  const storage=memoryStorage([['pony-run-progress-v11',raw]]);
  const {context,game}=loadGame(campaign,storage,{hash:'#l=20&demo'});game.start();
  assert.equal(game.level,20);assert.equal(game.revealed.size,0);
  assert.equal(storage.getItem(context.ProgressStore.BACKUP_KEY),raw);
  assert.notEqual(storage.getItem(context.ProgressStore.KEY),raw);
});

test('upgraded storage can still use #l=31, preserves both originals, and continues saving',()=>{
  const campaign=makeCampaign(),legacy=snapshot(campaign,18),legacyRaw=JSON.stringify(legacy);
  const storage=memoryStorage([['pony-run-progress-v11',legacyRaw]]);
  let loaded=loadGame(campaign,storage);loaded.game.start();
  const upgradedRaw=storage.getItem('pony-run-progress-v11');
  assert.notEqual(upgradedRaw,legacyRaw);
  assert.equal(storage.getItem('pony-run-progress-v11-backup'),legacyRaw);

  loaded=loadGame(campaign,storage,{hash:'#l=31&demo'});loaded.game.start();
  assert.equal(loaded.game.level,31);assert.equal(loaded.game.size,9);
  const secondary=[...storage.map.entries()].filter(([key])=>key.startsWith('pony-run-progress-v11-backup-'));
  assert.deepEqual(secondary.map(([,value])=>value),[upgradedRaw]);
  loaded.game.candidates.add(4);loaded.game.saveProgress();
  const afterJump=JSON.parse(storage.getItem('pony-run-progress-v11'));
  assert.equal(afterJump.level,31);assert(afterJump.candidates.includes(4));
});

test('legacy single and paired trial snapshots resume and back up only inside their own keys',()=>{
  const puzzle=makePuzzle(5),campaign={campaignVersion:'trial-v1',levels:[{level:1,puzzleId:'trial-1',puzzle}]};
  const raw=JSON.stringify({schema:1,level:1,puzzleId:'trial-1',campaignVersion:'trial-v1',size:5,stars:1,streak:2,status:'playing',revealed:[puzzle.solution[0]],missed:[],candidates:[3]});
  const storage=memoryStorage([
    ['pony-run-progress-v11','main untouched'],
    ['pony-run-four-test-v12',raw],
    ['pony-run-four-pair-test-v12',raw]
  ]);
  for(const key of ['pony-run-four-test-v12','pony-run-four-pair-test-v12']){
    const {context,game}=loadGame(campaign,storage,{key});game.start();
    assert.equal(game.streak,2);assert.equal(game.revealed.size,1);
    assert.equal(storage.getItem(context.ProgressStore.BACKUP_KEY),raw);
  }
  assert.equal(storage.getItem('pony-run-progress-v11'),'main untouched');
  assert.equal(storage.getItem('pony-run-progress-v11-backup'),null);
});

test('completed level 30 and 100 snapshots reopen the win modal without adding another streak',()=>{
  const campaign=makeCampaign();
  for(const level of [30,100]){
    const record=campaign.levels[level-1];
    const won=snapshot(campaign,level,{
      campaignVersion:level===100?campaign.campaignVersion:'v1.1-local-30.4',
      puzzleFingerprint:level===100?fingerprint(record.puzzle):undefined,
      stars:0,streak:6,status:'lost',
      revealed:record.puzzle.solution.map((column,row)=>row*record.puzzle.size+column),missed:[]
    });
    const storage=memoryStorage([['pony-run-progress-v11',JSON.stringify(won)]]);
    const {game}=loadGame(campaign,storage);const classes=attachModal(game);game.start();
    assert.equal(game.status,'won');assert.equal(game.streak,6);assert(classes.has('show'));
    assert.equal(game.modalTitle.textContent,'胜利！');
    assert.equal(game.modalDesc.textContent,level===30?'进入第 31 关 · 棋盘变为 9×9':'已完成全部 100 关');
    game.onModalSecondary();
    assert.equal(game.level,level);assert.equal(game.status,'playing');assert.equal(game.revealed.size,0);
  }
});

test('zero-star snapshot reopens the lose modal from verified facts and can replay',()=>{
  const campaign=makeCampaign(),failed=snapshot(campaign,24,{stars:0,streak:9,status:'won'});
  const storage=memoryStorage([['pony-run-progress-v11',JSON.stringify(failed)]]);
  const {game}=loadGame(campaign,storage);const classes=attachModal(game);game.start();
  assert.equal(game.status,'lost');assert.equal(game.streak,0);assert.equal(game.showingAnswer,true);assert(classes.has('show'));
  assert.equal(game.modalTitle.textContent,'失败');
  game.onModalPrimary();
  assert.equal(game.level,24);assert.equal(game.status,'playing');assert.equal(game.stars,2);
  assert.equal(game.showingAnswer,false);assert.equal(game.revealed.size,0);assert.equal(game.missed.size,0);
});

test('next level uses real records at 30 to 31 and 99 to 100, while level 100 ends without entering 101',()=>{
  const campaign=makeCampaign(),storage=memoryStorage();
  const {game}=loadGame(campaign,storage);attachModal(game);

  game.level=30;game.newRound();game.status='won';game.showModal('win');
  assert.equal(game.modalDesc.textContent,'进入第 31 关 · 棋盘变为 9×9');
  game.onModalPrimary();assert.equal(game.level,31);assert.equal(game.size,9);

  game.level=99;game.newRound();game.status='won';game.showModal('win');
  assert.equal(game.modalDesc.textContent,'进入第 100 关 · 棋盘变为 11×11');
  game.onModalPrimary();assert.equal(game.level,100);assert.equal(game.size,11);

  game.candidates.add(3);game.status='won';game.showModal('win');
  assert.equal(game.modalDesc.textContent,'已完成全部 100 关');assert.equal(game.modalPrimary.textContent,'完成');
  game.onModalPrimary();assert.equal(game.level,100);assert.equal(game.status,'won');
  game.showModal('win');game.onModalSecondary();
  assert.equal(game.level,100);assert.equal(game.status,'playing');assert.equal(game.candidates.size,0);
});
