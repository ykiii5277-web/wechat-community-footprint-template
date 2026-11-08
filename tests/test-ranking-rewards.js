const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'hui-api', 'index.js'), 'utf8');
const exported = {};
const mailbox = new Map();
const stores = new Map([['hui_mailbox', mailbox]]);
const db = { command: {}, runTransaction: async fn => fn(db), collection(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name);
  function query(filter = {}, skip = 0, limit = 100) { return {
    where: value => query(value, skip, limit), orderBy() { return this; }, skip: value => query(filter, value, limit), limit: value => query(filter, skip, value),
    get: async () => ({data: Array.from(store, ([id,item])=>Object.assign({_id:id},item)).filter(item=>Object.keys(filter).every(key=>item[key]===filter[key])).slice(skip,skip+limit)})
  }; }
  return Object.assign(query(), { doc(id) { return {
    async get() { if (!store.has(id)) throw new Error('not found'); return {data:store.get(id)}; },
    async set({data}) { store.set(id,data); }, async update({data}) { Object.assign(store.get(id),data); }
  }; } });
} };
const cloud = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database: () => db };
vm.runInNewContext(`${source}\nexports.rankingRewardsForTest = RANKING_REWARDS; exports.awardRankingPeriodForTest = awardRankingPeriod;`, {
  exports: exported,
  require(name) { return name === 'wx-server-sdk' ? cloud : require(name.startsWith('.') ? path.join(__dirname, '..', 'cloudfunctions', 'hui-api', name) : name); },
  process: { env: {} },
  Buffer
});

const rewards = exported.rankingRewardsForTest;
const expected = {
  day: { itemId: 'star', quantities: [3, 3, 3, 2, 2, 2, 1, 1, 1, 1] },
  week: { itemId: 'envelope', quantities: [3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  month: { itemId: 'gift_box', quantities: [6, 6, 6, 6, 6, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
  year: { itemId: 'memory_book', quantities: [3, 2, 1] }
};

Object.keys(expected).forEach(period => {
  assert.equal(rewards[period].length, expected[period].quantities.length);
  assert.deepEqual(Array.from(rewards[period], reward => reward.quantity), expected[period].quantities);
  assert(rewards[period].every(reward => reward.itemId === expected[period].itemId));
});

async function testAwardPositions() {
  const records = Array.from({ length: 11 }, (_, index) => ({
    ownerOpenid: index === 0 || index === 5 ? 'author-a' : index === 10 ? 'author-b' : `author-${index}`,
    views: 100 - index, likes: 0, commentCount: 0, publishedAt: 100 - index
  }));
  stores.set('hui_profiles', new Map(records.map(item=>[item.ownerOpenid,{uid:'1234567'}])));
  assert.equal(await exported.awardRankingPeriodForTest('周', '2026-09-21', records, rewards.week), 10);
  assert.equal(mailbox.get('rank_周_2026-09-21_1_author-a').quantity, 3);
  assert.equal(mailbox.get('rank_周_2026-09-21_11_author-b').quantity, 1);
  assert(!mailbox.has('rank_周_2026-09-21_6_author-a'));
  console.log('ranking reward tiers and real positions passed');
}

testAwardPositions().catch(error => { console.error(error); process.exitCode = 1; });
