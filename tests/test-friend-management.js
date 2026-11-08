const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createFriendManager } = require('../cloudfunctions/hui-api/friend-management');
const ui = require('../utils/friend-management');
const { createSync } = require('../utils/content-sync');
const copy = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, '..');
async function serverTests() {
  let store = new Map([['profiles/a', { uid: '1111111' }], ['profiles/b', { uid: '2222222' }], ['relations/ab', { _id: 'ab', members: ['a', 'b'] }]]), fail = false, tail = Promise.resolve();
  const connection = data => ({ collection: name => ({ doc: id => ({
    get: async () => { if (!data.has(`${name}/${id}`)) throw new Error('NOT_FOUND'); return { data: copy(data.get(`${name}/${id}`)) }; },
    update: async ({ data: changes }) => { if (fail) throw new Error('write failed'); data.set(`${name}/${id}`, Object.assign({}, data.get(`${name}/${id}`), copy(changes))); }
  }) }) });
  const db = { runTransaction(task) { const run = tail.then(async () => { const staged = new Map(Array.from(store, ([key, value]) => [key, copy(value)])); const result = await task(connection(staged)); store = staged; return result; }); tail = run.catch(() => {}); return run; } };
  const manager = createFriendManager({ db, profiles: 'profiles', friendships: 'relations', ownProfile: async id => store.get(`profiles/${id}`),
    profileByUid: async uid => uid === '2222222' ? { _id: 'b', uid } : { _id: 'stranger', uid },
    ensureFriend: async (a, b) => { if (a === 'a' && b === 'b') return copy(store.get('relations/ab')); throw new Error('FRIEND_NOT_FOUND'); }, checkSubmission: async () => {} });
  assert.deepEqual((await manager.read('a')).groups.map(group => group.name), ['营地好友']);
  await manager.manage('a', { operation: 'rename', groupId: 'camp-friends', name: '默认伙伴' });
  assert.equal((await manager.read('a')).groups[0].name, '默认伙伴');
  assert.equal((await manager.read('a')).groups[0].isDefault, true);
  assert.equal(ui.normalize(await manager.read('a')).groups[0].name, '默认伙伴', 'renamed default group survives client normalization');
  assert.equal(ui.grouped([{ id: 'newly-accepted' }], await manager.read('a'))[0].friends[0].id, 'newly-accepted', 'new friends still fall into the same default group after rename');
  await manager.manage('a', { operation: 'create', groupId: 'school', name: '同学' });
  await manager.manage('a', { operation: 'create', groupId: 'school', name: '同学' });
  assert.equal((await manager.read('a')).groups.length, 2, 'a lost create receipt must not create duplicates');
  await assert.rejects(manager.manage('a', { operation: 'create', groupId: 'duplicate', name: '同学' }), /FRIEND_GROUP_EXISTS/);
  await assert.rejects(manager.manage('a', { operation: 'create', groupId: 'empty', name: ' ' }), /INVALID_FRIEND_GROUP_NAME/);
  await assert.rejects(manager.manage('a', { operation: 'delete', groupId: 'camp-friends' }), /DEFAULT_FRIEND_GROUP/);
  await assert.rejects(manager.manage('a', { operation: 'create', groupId: 'same-default', name: '默认伙伴' }), /FRIEND_GROUP_EXISTS/);
  await manager.manage('a', { operation: 'assign', uid: '2222222', groupId: 'school' });
  assert.equal((await manager.read('a')).assignments.b, 'school'); assert.equal((await manager.read('b')).assignments.a, undefined, 'grouping must be private to the acting account');
  assert.deepEqual(store.get('relations/ab').members, ['a', 'b']);
  await assert.rejects(manager.manage('a', { operation: 'assign', uid: '3333333', groupId: 'school' }), /FRIEND_NOT_FOUND/);
  await assert.rejects(manager.manage('a', { operation: 'assign', uid: '2222222', groupId: 'missing' }), /FRIEND_GROUP_NOT_FOUND/);
  await manager.manage('a', { operation: 'rename', groupId: 'school', name: '校园好友' });
  await manager.manage('a', { operation: 'sort', sort: 'affection' });
  const state = await manager.read('a'); assert.equal(state.sort, 'affection'); assert.equal(state.groups[1].name, '校园好友');
  fail = true; await assert.rejects(manager.manage('a', { operation: 'rename', groupId: 'school', name: '不会保存' }), /write failed/); fail = false;
  assert.equal((await manager.read('a')).groups[1].name, '校园好友');
  await manager.manage('a', { operation: 'delete', groupId: 'school' }); assert.equal((await manager.read('a')).assignments.b, undefined); assert(store.has('relations/ab'));
  await Promise.all(['one', 'two'].map(groupId => manager.manage('a', { operation: 'create', groupId, name: groupId })));
  assert.equal((await manager.read('a')).groups.length, 3, 'concurrent changes merge against the current profile within transactions');
  console.log('private/default/custom friend groups, ownership, idempotent create, rename/delete/move, rollback and concurrent transactions passed');
}
function sortTests() {
  const friends = [{ uid: '1', name: 'Charlie', remark: 'A', addedAt: 10, affection: { points: 1 } }, { uid: '2', name: 'alice', remark: 'Z', addedAt: 20, affection: { points: 9 } }, { uid: '3', name: 'Bob', addedAt: 30, affection: { points: 5 } }];
  assert.deepEqual(ui.sortFriends(friends, 'name').map(item => item.name), ['alice', 'Bob', 'Charlie']);
  assert.deepEqual(ui.sortFriends([{ name: '赵' }, { name: '王' }, { name: '李' }], 'name').map(item => item.name), ['李', '王', '赵']);
  assert.deepEqual(ui.sortFriends(friends, 'affection').map(item => item.uid), ['2', '3', '1']);
  assert.deepEqual(ui.sortFriends(friends, 'added').map(item => item.uid), ['3', '2', '1']);
  assert.equal(friends[0].name, 'Charlie', 'sorting cannot mutate the original cache');
  const groups = ui.grouped([{ id: '1' }, { id: '2', groupId: 'school' }, { id: '3', groupId: 'deleted' }], { groups: [{ id: 'school', name: '同学' }] }, { 'camp-friends': true });
  assert.equal(groups[0].friends.length, 2); assert.equal(groups[1].friends.length, 1); assert.equal(groups[0].expanded, true);
}
async function clientTests() {
  const storage = new Map(); global.wx = { getStorageSync: key => storage.has(key) ? copy(storage.get(key)) : '', setStorageSync: (key, value) => storage.set(key, copy(value)), removeStorageSync: key => storage.delete(key) };
  const fields = ['profile', 'friends', 'photos', 'growth', 'works', 'companions', 'folders', 'activities']; const keys = Object.fromEntries(fields.map(key => [key, key]));
  let management = ui.normalize({ groups: [{ id: 'school', name: '同学' }] }), fail = false, delayed;
  const friends = [{ uid: '2222222', id: '2222222', name: 'A', groupId: 'school', addedAt: 123, affection: { points: 9 } }];
  const cloud = { CLOUD_ENV_ID: 'friend-test', async getFriends() { const response = copy({ friends, management }); if (delayed) await delayed; return response; },
    async call(action, payload) { if (fail) return { error: 'NETWORK', message: 'offline' }; if (payload.sort) management.sort = payload.sort; return { management: copy(management), assigned: payload.operation === 'assign' ? { uid: payload.uid, groupId: payload.groupId } : null }; }, updateFriendRemark: async () => ({ remark: '昵称备注' }) };
  const sync = createSync({ cloud, keys, init() {}, today: () => '', normalizeActivityName: value => value, getProfile: () => wx.getStorageSync('profile') });
  sync.bindCloudAccount({ uid: '1111111', syncVersion: 2 }); await sync.getFriendsAsync(); assert.equal(sync.getFriendManagement().groups.length, 2);
  await sync.saveFriendManagement({ operation: 'sort', sort: 'affection' }); assert.equal(sync.getFriendManagement().sort, 'affection');
  fail = true; await assert.rejects(sync.saveFriendManagement({ operation: 'sort', sort: 'added' }), /offline/); assert.equal(sync.getFriendManagement().sort, 'affection'); fail = false;
  await sync.saveFriendManagement({ operation: 'assign', uid: '2222222', groupId: 'camp-friends' }); assert.equal(wx.getStorageSync('friends')[0].groupId, 'camp-friends');
  await sync.saveFriend({ uid: '2222222', id: '2222222', remark: '昵称备注' }); const edited = wx.getStorageSync('friends')[0]; assert.equal(edited.addedAt, 123); assert.equal(edited.affection.points, 9); assert.equal(edited.groupId, 'camp-friends');
  let resolve; delayed = new Promise(done => { resolve = done; }); const pending = sync.getFriendsAsync(); await new Promise(done => setImmediate(done));
  await sync.saveFriendManagement({ operation: 'sort', sort: 'added' }); resolve(); await pending; delayed = null; assert.equal(sync.getFriendManagement().sort, 'added', 'a stale polling reply must not undo a newer sort choice');
  sync.bindCloudAccount({ uid: '3333333', syncVersion: 2 }); assert.equal(sync.getFriendManagement().sort, 'name'); assert.equal(sync.getFriendManagement().groups.length, 1);
  sync.bindCloudAccount({ uid: '1111111', syncVersion: 2 }); assert.equal(sync.getFriendManagement().sort, 'added');
  console.log('sorting, pinyin order, cloud preference receipts, stale polling protection, account isolation and remark metadata preservation passed');
}
async function paginationTests() {
  const profiles = { owner: { _id: 'owner', uid: '1111111', name: '我' } };
  const relations = Array.from({ length: 105 }, (_, i) => { const id = `p${i}`; profiles[id] = { _id: id, uid: String(2000000 + i), name: id }; return { _id: `r${i}`, members: ['owner', id], createdAt: i + 1 }; });
  const sdk = { init() {}, database: () => ({ command: { in: value => value }, collection: name => ({ doc: id => ({ get: async () => ({ data: profiles[id] }) }), where: () => ({ orderBy() { return this; }, skip: offset => ({ limit: size => ({ get: async () => ({ data: relations.slice(offset, offset + size) }) }) }) }) }) }) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/hui-api/index.js'), 'utf8') + '\nloadGiftTotals = async () => ({}); resolveSharedContentList = async list => list; module.exports = {friendList};', { module, exports: module.exports, Buffer, process,
    require(name) { return name === 'wx-server-sdk' ? sdk : require(name.startsWith('.') ? path.join(root, 'cloudfunctions/hui-api', name) : name); } });
  const result = await module.exports.friendList('owner'); assert.equal(result.friends.length, 105); assert.equal(result.friends.find(friend => friend.uid === '2000104').addedAt, 105); assert.equal(result.friends[0].groupId, 'camp-friends'); assert.equal(result.management.groups[0].name, '营地好友');
}
Promise.resolve().then(serverTests).then(sortTests).then(clientTests).then(paginationTests).catch(error => { console.error(error); process.exitCode = 1; });
