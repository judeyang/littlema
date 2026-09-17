const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./fixtures/marked-horse.cjs');
const { rng } = require('./helpers.cjs');
test('classic script load order and Game hint integration', () => {
  const math = Object.create(Math); math.random = rng(20260915);
  const context = { Math: math, location: { hash: '#demo' }, setTimeout() {}, clearTimeout() {}, addEventListener() {} };
  context.window = context; vm.createContext(context);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', src), 'utf8'), context);
  assert(context.PuzzleCore && context.PuzzleLogic && context.HintPresenter && context.Game);
  const game = context.Game;
  Object.assign(game, { size: fixture.size, regions: fixture.regions, revealed: new Set(), missed: new Set(), candidates: new Set(fixture.marks) });
  Object.defineProperty(game, 'horses', { configurable: true, get() { throw new Error('Game hint read answer'); } });
  const result = game.findHint();
  assert.equal(result.type, 'error'); assert.equal(result.idx, 14);
  assert(result.message.includes('第 3 行第 1 列'));
  Object.defineProperty(game, 'horses', { configurable: true, writable: true, value: [] });
  game.render = () => {}; game.hideModal = () => {}; game.toast = () => {};
  game.newRound();
  assert(context.PuzzleCore.validate(game).valid);
  assert(context.PuzzleCore.validateSolution(game, game.horses));
  assert.equal(context.PuzzleLogic.solve(game).status, 'solved');
});

test('full-text hint stays open, toggles without recomputing, and expires on board render', () => {
  const elements = new Map(), timers = [];
  function element() {
    const classes = new Set();
    return { textContent:'', scrollTop:0, appendChild(){}, setAttribute(k,v){this[k]=v;},
      classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},
        toggle(x,on){if(on)classes.add(x);else classes.delete(x);},contains(x){return classes.has(x);}} };
  }
  const context = {location:{hash:'#demo'},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},addEventListener(){},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element}};
  context.window=context;vm.createContext(context);
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const [,src] of html.matchAll(/<script src="([^"]+)"/g))vm.runInContext(fs.readFileSync(path.join(__dirname,'..',src),'utf8'),context);
  const game=context.Game, fixture18=require('./fixtures/level18-hint.cjs');
  Object.assign(game,{size:7,regions:fixture18.regions,candidates:new Set(fixture18.marks),revealed:new Set(),missed:new Set(),btnHint:element()});
  const original=game.findHint.bind(game);let calls=0;
  game.findHint=()=>{calls++;return original();};
  const before=JSON.stringify([...game.candidates]);
  game.showHint();
  const toast=elements.get('hint-toast');
  assert(toast.classList.contains('hint-detail'));assert(toast.classList.contains('show'));
  assert(toast.textContent.includes('第 5 列的候选全部被排除'));
  assert.equal(timers.length,0,'long proof must not disappear on a short timer');
  assert.equal(JSON.stringify([...game.candidates]),before);assert.equal(game.revealed.size,0);
  game.showHint();assert.equal(calls,1);assert(!toast.classList.contains('show'));
  game.showHint();assert.equal(calls,2);
  game.renderBoard=()=>{};game.saveProgress=()=>{};game.render();
  assert(!toast.classList.contains('show'));assert.equal(game.btnHint['aria-expanded'],'false');
  game.toast('普通反馈',1500);assert.equal(timers.at(-1).ms,1500);assert(!toast.classList.contains('hint-detail'));
});
