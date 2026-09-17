const test=require('node:test');
const assert=require('node:assert/strict');
const Store=require('../src/progress-store.js');

function memoryStorage(){
  const map=new Map();
  return {map,getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),
    get length(){return map.size;},key:i=>[...map.keys()][i]??null};
}

test('progress store saves and restores a valid mid-level snapshot',()=>{
  global.localStorage=memoryStorage();
  const data={level:18,puzzleId:'puzzle-18',campaignVersion:'v1.1-local-30.3',size:8,stars:1,streak:4,status:'playing',revealed:[0,9],missed:[4],candidates:[2,3]};
  assert.deepEqual(Store.save(data),{status:'ok'});
  const loaded=Store.load();
  assert.equal(loaded.status,'ok');
  assert.deepEqual(loaded.data,{schema:1,...data});
});

test('progress store rejects corrupt or conflicting snapshots',()=>{
  global.localStorage=memoryStorage();
  global.localStorage.setItem(Store.KEY,JSON.stringify({schema:1,level:3,size:4,revealed:[2],missed:[2],candidates:[]}));
  assert.equal(Store.load().status,'invalid');
  global.localStorage.setItem(Store.KEY,'not-json');
  assert.equal(Store.load().status,'invalid');
});

test('four-region test storage cannot replace or clear main progress',()=>{
  global.localStorage=memoryStorage();
  const data={level:18,puzzleId:'main-18',campaignVersion:'main',size:7,revealed:[],missed:[],candidates:[4,5]};
  Store.save(data);const before=global.localStorage.getItem(Store.KEY);
  const isolated=Store.create('pony-run-four-test-v12');
  assert.equal(isolated.load().status,'empty');
  isolated.save({...data,level:1,puzzleId:'four-test',size:9});
  assert.equal(isolated.load().data.level,1);assert.equal(Store.load().data.level,18);
  isolated.clear();assert.equal(global.localStorage.getItem(Store.KEY),before);
  assert.throws(()=>Store.create(''));
});

test('backup reuses the same raw value and preserves different snapshots in stable secondary keys',()=>{
  global.localStorage=memoryStorage();
  const reusable=Store.create('progress-reusable');
  const raw=JSON.stringify({schema:1,level:2,size:5,revealed:[],missed:[],candidates:[]});
  global.localStorage.setItem(reusable.KEY,raw);
  assert.deepEqual(reusable.backup(raw),{status:'ok',reused:false});
  assert.deepEqual(reusable.backup(raw),{status:'ok',reused:true});
  assert.equal(reusable.save({level:2,size:5,revealed:[],missed:[],candidates:[]}).status,'ok');

  const multiple=Store.create('progress-multiple');
  const original='original snapshot',existing='another snapshot';
  global.localStorage.setItem(multiple.KEY,original);
  global.localStorage.setItem(multiple.BACKUP_KEY,existing);
  assert.deepEqual(multiple.backup(original),{status:'ok',reused:false});
  assert.deepEqual(multiple.backup(original),{status:'ok',reused:true});
  assert.equal(multiple.save({level:1,size:5,revealed:[],missed:[],candidates:[]}).status,'ok');
  assert.equal(global.localStorage.getItem(multiple.BACKUP_KEY),existing);
  const secondary=[...global.localStorage.map.entries()].filter(([key])=>key.startsWith(`${multiple.BACKUP_KEY}-`));
  assert.deepEqual(secondary.map(([,value])=>value),[original]);
});

test('a stable-hash collision with different content blocks saves without overwriting either backup',()=>{
  global.localStorage=memoryStorage();
  const store=Store.create('progress-hash-collision');
  const first='raw-79939-2580023410',second='raw-148925-2296386085';
  global.localStorage.setItem(store.BACKUP_KEY,'primary snapshot');
  assert.equal(store.backup(first).status,'ok');
  const before=[...global.localStorage.map.entries()];
  assert.equal(store.backup(second).status,'unavailable');
  assert.equal(store.save({level:1,size:5,revealed:[],missed:[],candidates:[]}).status,'unavailable');
  assert.deepEqual([...global.localStorage.map.entries()],before);
});

test('failed backup blocks later saves without clearing the original',()=>{
  const map=new Map();
  global.localStorage={
    getItem:key=>map.has(key)?map.get(key):null,
    setItem(key,value){if(key.endsWith('-backup'))throw new Error('quota');map.set(key,String(value));},
    removeItem:key=>map.delete(key)
  };
  const store=Store.create('progress-backup-fails'),raw='legacy raw';
  global.localStorage.setItem(store.KEY,raw);
  assert.equal(store.backup(raw).status,'unavailable');
  assert.equal(store.save({level:1,size:5,revealed:[],missed:[],candidates:[]}).status,'unavailable');
  assert.equal(global.localStorage.getItem(store.KEY),raw);
  assert.equal(global.localStorage.getItem(store.BACKUP_KEY),null);
});

test('single and paired trial stores use independent backup keys',()=>{
  global.localStorage=memoryStorage();
  const single=Store.create('pony-run-four-test-v12');
  const paired=Store.create('pony-run-four-pair-test-v12');
  assert.notEqual(single.BACKUP_KEY,paired.BACKUP_KEY);
  assert.equal(single.backup('single raw').status,'ok');
  assert.equal(paired.backup('paired raw').status,'ok');
  assert.equal(global.localStorage.getItem(single.BACKUP_KEY),'single raw');
  assert.equal(global.localStorage.getItem(paired.BACKUP_KEY),'paired raw');
  assert.equal(global.localStorage.getItem(Store.BACKUP_KEY),null);
});

test('player profiles isolate snapshots and listProfiles reports all names',()=>{
  global.localStorage=memoryStorage();
  const a=Store.create('pony-run-progress-v11:小明');
  const b=Store.create('pony-run-progress-v11:小红');
  const snap={level:3,size:7,stars:2,streak:1,status:'playing',revealed:[],missed:[],candidates:[]};
  assert.equal(a.save({...snap,streak:5}).status,'ok');
  assert.equal(b.save(snap).status,'ok');
  assert.equal(a.load().data.streak,5);
  assert.equal(b.load().data.streak,1);
  assert.deepEqual(Store.listProfiles().slice().sort(),['小明','小红'].sort());
  // 默认"玩家"档案：原始 key 存在时应出现在列表中
  global.localStorage.setItem(Store.KEY,JSON.stringify({schema:1,...snap,streak:9}));
  assert(Store.listProfiles().includes('玩家'));
  assert.equal(Store.load().data.streak,9);
});
