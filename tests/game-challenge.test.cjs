const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

// Original scripts, isolated storage/DOM, and a deterministic clock. No browser user data.
function load(initial = []) {
  const storage = new Map(initial), nodes = new Map(), timers = new Map();
  let now = 1000000, sequence = 0;
  function element() {
    const classes = new Set();
    return {textContent: '', innerHTML: '', children: [], style: {}, scrollTop: 0,
      classList: {add(...xs){xs.forEach(x=>classes.add(x));}, remove(...xs){xs.forEach(x=>classes.delete(x));},
        toggle(x,on){if(on)classes.add(x);else classes.delete(x);}, contains:x=>classes.has(x)},
      appendChild(){}, setAttribute(k,v){this[k]=v;}, addEventListener(){}, removeEventListener(){},
      setPointerCapture(){}, animate(){}};
  }
  const get = id => {if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context = {location:{hash:'#demo&hint'}, Date:{now:()=>now}, addEventListener(){},
    document:{hidden:false,getElementById:get,createElement:element,querySelector(){return null;},
      querySelectorAll(){return [];},addEventListener(){},
      elementFromPoint(){return {closest(){return {dataset:{idx:'0'}};}};}},
    localStorage:{get length(){return storage.size;},key:i=>[...storage.keys()][i]??null,
      getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,time:now+ms});return id;},
    clearTimeout:id=>timers.delete(id),
    setInterval(fn,ms){const id=++sequence;timers.set(id,{fn,time:now+ms,interval:ms});return id;},
    clearInterval:id=>timers.delete(id)};
  context.window = context;
  vm.createContext(context);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const [,src] of html.matchAll(/<script src="([^"]+)"/g)) {
    vm.runInContext(fs.readFileSync(path.join(root,src),'utf8'),context);
  }
  const game=context.Game;
  for(const [property,id] of Object.entries({btnHint:'btn-hint',modal:'modal',modalEmoji:'modal-emoji',
    modalTitle:'modal-title',modalDesc:'modal-desc',modalPrimary:'modal-primary',modalSecondary:'modal-secondary'}))game[property]=get(id);
  game.renderBoard=()=>{};game.tutorialDecorate=()=>{};game.buildTutorialLayer=()=>{};game.tutorialShowStep=()=>{};
  function advance(ms){const end=now+ms;while(true){const entry=[...timers].filter(([,t])=>t.time<=end)
    .sort((a,b)=>a[1].time-b[1].time)[0];if(!entry)break;const [id,timer]=entry;now=timer.time;
    if(timer.interval)timer.time+=timer.interval;else timers.delete(id);timer.fn();}now=end;}
  const saved = () => JSON.parse(storage.get(context.ProgressStore.KEY));
  return {game,context,storage,nodes,get,advance,saved};
}

function proof(target=0) {
  return {type:'exclude',idxs:[target],message:`排除 ${target}`,proof:{ruleId:'placed-exclusion',
    groups:[{kind:'row',index:0}],conclusion:{place:[],exclude:[target]}}};
}

test('clock uses real elapsed time; proof reading pauses, dismiss and board input resume', () => {
  const {game,advance,get}=load();game.level=6;game.newRound();
  advance(2250);assert.equal(game.challenge.remainingMs,177750);assert.equal(get('remaining-time').textContent,'2:58');
  game.findHint=()=>proof();game.showHint();
  assert.equal(get('timer-label').textContent,'计时暂停');
  advance(60000);assert.equal(game.challenge.remainingMs,177750);
  game.showHint();advance(1000);assert.equal(game.challenge.remainingMs,176750);
  game.showHint();advance(1000);game.onCellTap(1,false);
  assert.equal(game._hintOpen,false);advance(1000);assert.equal(game.challenge.remainingMs,175750);
});

test('background time is not charged and refreshed storage keeps time and hint claims', () => {
  const a=load();a.game.level=6;a.game.newRound();a.advance(1125);
  a.game.onClockVisibility(true);assert.equal(a.game.challenge.remainingMs,178875);
  a.advance(60000);a.game.onClockVisibility(false);a.advance(1000);
  a.game.findHint=()=>proof();a.game.showHint();a.advance(50000);
  const saved=a.saved();assert.equal(saved.challenge.remainingMs,177875);
  assert.equal(saved.challenge.hintKeys.length,1);
  const b=load([...a.storage]);b.game.level=6;b.game.newRound({resume:saved});
  assert.equal(b.game.challenge.remainingMs,177875);assert.equal(b.context.RoundChallenge.remainingHints(b.game.challenge),1);
  b.advance(1000);assert.equal(b.game.challenge.remainingMs,176875);
  b.game.newRound();assert.equal(b.game.challenge.remainingMs,180000);
  assert.equal(b.context.RoundChallenge.remainingHints(b.game.challenge),2);
});

test('only new proven conclusions consume quota; exhausted quota can reopen acquired hint', () => {
  const {game,context,get}=load();game.level=6;game.newRound();
  game.findHint=()=>proof(0);game.showHint();assert.equal(context.RoundChallenge.remainingHints(game.challenge),1);
  game.showHint();game.showHint();assert.equal(context.RoundChallenge.remainingHints(game.challenge),1);
  game.showHint();game.findHint=()=>({type:'none',message:'没有新的有效提示'});game.showHint();
  assert.equal(context.RoundChallenge.remainingHints(game.challenge),1);
  game.findHint=()=>proof(1);game.showHint();game.showHint();assert.equal(get('hint-quota').textContent,'0／2');
  game.findHint=()=>proof(2);game.showHint();assert.equal(game._hintOpen,false);
  assert(get('modal-title').textContent.includes('提示已用完'));
  assert(get('modal-desc').textContent.includes('清除本次标记'));
  game.onModalSecondary();assert.equal(game.level,6);assert.equal(game.status,'playing');
  game.findHint=()=>proof(0);game.showHint();assert.equal(game._hintOpen,true);
  assert.equal(context.RoundChallenge.remainingHints(game.challenge),0);
});

test('quota exhaustion offers confirmed replay, or continuing without resetting progress', () => {
  const {game,advance,context}=load();game.level=6;game.newRound();
  for(const i of [0,1]){game.findHint=()=>proof(i);game.showHint();game.dismissHint();}
  game.candidates.add(5);advance(1000);game.findHint=()=>proof(2);game.showHint();
  const remaining=game.challenge.remainingMs;advance(10000);assert.equal(game.challenge.remainingMs,remaining);
  game.onModalSecondary();assert(game.candidates.has(5));assert.equal(context.RoundChallenge.remainingHints(game.challenge),0);
  advance(1000);assert.equal(game.challenge.remainingMs,remaining-1000);
  game.showHint();game.onModalPrimary();assert.equal(game.candidates.size,0);
  assert.equal(game.challenge.remainingMs,180000);assert.equal(context.RoundChallenge.remainingHints(game.challenge),2);
});

test('time expiry is not a loss and does not deduct stars or prevent play', () => {
  const {game,advance,get,saved}=load();game.level=6;game.newRound();
  advance(181000);assert.equal(game.challenge.remainingMs,0);assert.equal(game.status,'playing');
  assert.equal(game.stars,2);assert.equal(get('remaining-time').textContent,'已超时');
  game.onCellTap(0,false);assert(game.candidates.has(0));assert.equal(saved().challenge.remainingMs,0);
});

test('tutorial free step permits correct double-tap and drag without clicking hint first', () => {
  for(const action of ['double','drag']) {
    const {game}=load();game.level=1;game.newRound();game.revealed=new Set([2,9]);game.tut={active:true,step:5};
    if(action==='double'){game.onCellTap(11,true);assert(game.revealed.has(11));}
    else {game.applyDragAction(0,'mark');assert(game.candidates.has(0));}
    assert.equal(game.tut.active,false);
  }
});

test('victory saves incremented streak before refresh; final level remains 100', () => {
  const a=load();a.game.level=100;a.game.newRound();
  a.game.streak=4;
  for(let r=0;r<a.game.size;r++)a.game.onCellTap(r*a.game.size+a.game.horses[r],true);
  assert.equal(a.game.status,'won');assert.equal(a.saved().status,'won');assert.equal(a.saved().streak,5);
  const b=load([...a.storage]);b.game.level=100;b.game.newRound({resume:a.saved()});
  assert.equal(b.game.status,'won');assert.equal(b.game.streak,5);
  b.game.onModalPrimary();assert.equal(b.game.level,100);
});

test('a 250 ms double-tap becomes one double action; boundary becomes separate singles', () => {
  for(const [delay,expected] of [[250,[true]],[320,[false,false]]]) {
    const {game,advance,get}=load(),taps=[];
    game.onCellTap=(idx,double)=>taps.push(double);game.attachCellEvents(get('board'));
    const tap=()=>{game._peHandlers.pointerdown({button:0,pointerId:1,clientX:0,clientY:0});game._peHandlers.pointerup({});};
    tap();advance(delay);tap();advance(320);assert.deepEqual(taps,expected);
  }
});

test('compatible old progress receives initial challenge policy without losing marks or streak', () => {
  const {game,saved}=load();game.level=6;game.newRound();game.candidates.add(0);game.streak=7;game.saveProgress();
  const old=saved();delete old.challenge;
  game.newRound({resume:old});assert(game.candidates.has(0));assert.equal(game.streak,7);
  assert.equal(game.challenge.remainingMs,180000);assert.equal(game.challenge.hintKeys.size,0);
});

test('failed round stops countdown and retry resets both time and hint quota', () => {
  const {game,advance,context}=load();game.level=6;game.newRound();game.findHint=()=>proof();game.showHint();game.dismissHint();
  const wrong=[];for(let i=0;i<game.size**2;i++)if(game.horses[Math.floor(i/game.size)]!==i%game.size)wrong.push(i);
  game.onCellTap(wrong[0],true);game.onCellTap(wrong[1],true);assert.equal(game.status,'lost');
  const time=game.challenge.remainingMs;advance(10000);assert.equal(game.challenge.remainingMs,time);
  game.onModalPrimary();assert.equal(game.status,'playing');assert.equal(game.stars,2);
  assert.equal(game.challenge.remainingMs,180000);assert.equal(context.RoundChallenge.remainingHints(game.challenge),2);
});

test('actual level 20 proof is charged once and can be reopened after refresh without reading answer', () => {
  const a=load();a.game.level=20;a.game.newRound();
  Object.defineProperty(a.game,'horses',{configurable:true,get(){throw Error('hint accessed hidden answer');}});
  a.game.showHint();assert.equal(a.game._hintOpen,true);assert.equal(a.game.challenge.hintKeys.size,1);
  const snapshot=a.saved();
  const b=load([...a.storage]);b.game.level=20;b.game.newRound({resume:snapshot});
  b.game.showHint();assert.equal(b.game._hintOpen,true);assert.equal(b.game.challenge.hintKeys.size,1);
  assert.equal(b.context.RoundChallenge.remainingHints(b.game.challenge),2);
});
