const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const names = [
  'hui_uid_claims', 'hui_profiles', 'hui_contents', 'hui_friend_requests', 'hui_friendships',
  'hui_likes', 'hui_comments', 'hui_content_views', 'hui_chat_messages',
  'hui_reports', 'hui_item_wallets', 'hui_item_gifts', 'hui_daily_tasks',
  'hui_weekly_claims', 'hui_mailbox', 'hui_reward_runs'
];
const rows = Object.fromEntries(names.map(name => [name, new Map()]));
let currentOpenid = 'admin';
const deletedFiles = [];

function insert(name, id, data) { rows[name].set(id, Object.assign({ _id: id }, data)); }
function clone(record) { return record && Object.assign({}, record); }
function collection(name, filter = {}, offset = 0, pageSize = 100) {
  const selected = () => Array.from(rows[name].values()).filter(record =>
    Object.keys(filter).every(key => key === 'winners.openid' ? (record.winners || []).some(winner=>winner.openid===filter[key]) : record[key] === filter[key]));
  return {
    where(next) { return collection(name, next, offset, pageSize); },
    orderBy() { return collection(name, filter, offset, pageSize); },
    skip(next) { return collection(name, filter, next, pageSize); },
    limit(next) { return collection(name, filter, offset, next); },
    async get() { return { data: selected().slice(offset, offset + pageSize).map(clone) }; },
    async count() { return { total: selected().length }; },
    doc(id) {
      return {
        async get() { if (!rows[name].has(id)) throw new Error('not found'); return { data: clone(rows[name].get(id)) }; },
        async set({ data }) { rows[name].set(id, Object.assign({ _id: id }, data)); },
        async update({ data }) { Object.assign(rows[name].get(id), data); },
        async remove() { rows[name].delete(id); }
      };
    }
  };
}
const db = { command: {}, collection, runTransaction: async fn => fn(db), createCollection: async () => { throw new Error('already exists'); } };
const cloud = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  database() { return db; },
  getWXContext() { return { OPENID: currentOpenid }; },
  async deleteFile({ fileList }) {
    deletedFiles.push(...fileList);
    return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) };
  }
};
const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'hui-api', 'index.js'), 'utf8');
vm.runInNewContext(source, {
  require(name) { return name === 'wx-server-sdk' ? cloud : require(name.startsWith('.') ? path.join(__dirname, '..', 'cloudfunctions', 'hui-api', name) : name); },
  exports: exportsObject, process: { env: {} }, console, Buffer
});
const call = (action, payload) => exportsObject.main({ action, payload });

async function main() {
  insert('hui_profiles', 'admin', { openid: 'admin', uid: '1000001', name: '管理员', isAdmin: true, createdAt: 1 });
  insert('hui_profiles', 'target', { openid: 'target', uid: '1000002', name: '待删除用户', createdAt: 2, avatar: 'cloud://target-avatar' });
  insert('hui_profiles', 'other', { openid: 'other', uid: '1000003', name: '其他用户', createdAt: 3 });
  insert('hui_contents', 'owned', { ownerOpenid: 'target', ownerUid: '1000002', image: 'cloud://owned', images: ['cloud://shared'] });
  insert('hui_contents', 'retained', { ownerOpenid: 'other', ownerUid: '1000002', image: 'cloud://shared', likes: 1, commentCount: 1, views: 0 });
  insert('hui_comments', 'target-comment', { authorOpenid: 'target', contentRef: 'retained' });
  insert('hui_likes', 'target-like', { actorOpenid: 'target', contentRef: 'retained' });
  insert('hui_item_wallets', 'target', { openid: 'target' });
  insert('hui_item_wallets', 'other', { openid: 'other' });

  insert('hui_uid_claims', 'uid_1000002', {uid:'1000002',ownerOpenid:'target'});
  insert('hui_uid_claims', 'owner_test', {uid:'1000002',ownerOpenid:'target'});
  insert('hui_reward_runs', 'ranking_test', {status:'pending',winners:[{openid:'target'},{openid:'other'}]});
  currentOpenid = 'other';
  assert.equal((await call('admin.account.previewDeletion', { targetUid: '1000002' })).error, 'ADMIN_FORBIDDEN');
  currentOpenid = 'admin';
  assert.equal((await call('admin.account.previewDeletion', { targetUid: '1000001' })).error, 'ACCOUNT_DELETE_PROTECTED');
  const preview = await call('admin.account.previewDeletion', { targetUid: '1000002' });
  assert.equal(preview.target.name, '待删除用户');
  assert.equal((await call('admin.account.deleteByUid', { targetUid: '1000002', accountKey: 'wrong', confirmation: 'DELETE:1000002' })).error, 'ACCOUNT_DELETE_CONFIRMATION_REQUIRED');
  const result = await call('admin.account.deleteByUid', { targetUid: '1000002', accountKey: preview.target.accountKey, confirmation: 'DELETE:1000002' });
  assert.equal(result.completed, true);
  assert.equal(rows.hui_profiles.has('target'), false);
  assert.equal(rows.hui_uid_claims.get('uid_1000002').retired,true);
  assert(!rows.hui_uid_claims.get('uid_1000002').ownerOpenid);
  assert(!rows.hui_uid_claims.has('owner_test'));
  assert.equal(rows.hui_reward_runs.get('ranking_test').winners.length,1);
  assert.equal(rows.hui_reward_runs.get('ranking_test').winners[0].openid,'other');
  assert.equal(rows.hui_profiles.has('other'), true);
  assert.equal(rows.hui_contents.has('owned'), false);
  assert.equal(rows.hui_contents.has('retained'), true);
  assert.equal(rows.hui_comments.has('target-comment'), false);
  assert.equal(rows.hui_likes.has('target-like'), false);
  assert.equal(rows.hui_contents.get('retained').likes, 0);
  assert.equal(rows.hui_contents.get('retained').commentCount, 0);
  assert.equal(rows.hui_item_wallets.has('other'), true);
  assert(deletedFiles.includes('cloud://owned'));
  assert(deletedFiles.includes('cloud://target-avatar'));
  assert(!deletedFiles.includes('cloud://shared'));
  insert('hui_profiles', 'new-owner', { openid: 'new-owner', uid: '1000002', name: '新账号', createdAt: 4 });
  const stale = await call('admin.account.deleteByUid', { targetUid: '1000002', accountKey: preview.target.accountKey, confirmation: 'DELETE:1000002' });
  assert.equal(stale.error, 'ACCOUNT_DELETE_CONFIRMATION_REQUIRED');
  assert(rows.hui_profiles.has('new-owner'));
  console.log('account deletion checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
