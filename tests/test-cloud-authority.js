const assert = require('assert');
const { createSync } = require('../utils/content-sync');
const { createManager } = require('../cloudfunctions/hui-api/content-manager');
const copy = value => JSON.parse(JSON.stringify(value));

async function clientTests() {
  const storage = new Map();
  global.wx = { getStorageSync: key => storage.has(key) ? copy(storage.get(key)) : '', setStorageSync: (key, value) => storage.set(key, copy(value)), removeStorageSync: key => storage.delete(key) };
  const fields = ['profile', 'photos', 'growth', 'works', 'companions', 'folders', 'activities', 'comments', 'favorites', 'profilePending', 'pendingFolderDeletes'];
  const keys = Object.fromEntries(fields.map(field => [field, field]));
  let remote = { profile: { uid: '1111111', syncVersion: 2 }, photos: [], growth: [], works: [], companions: [], albums: [], activities: [] };
  let fail = false, calls = 0, deferred;
  const cloud = {
    CLOUD_ENV_ID: 'test', isRemoteFile: path => /^cloud:/.test(path), persistFile: async path => `cloud://${path}`,
    getOwnState: async () => copy(remote), getCurrentProfile: async () => ({ profile: remote.profile }),
    upsertContent: async (kind, item) => { calls++; if (deferred) await deferred; return fail ? { error: 'NETWORK', message: '网络中断' } : { item: Object.assign({}, item, { updatedAt: calls }) }; },
    deleteContent: async () => fail ? { error: 'NETWORK', message: '网络中断' } : { deleted: true },
    saveProfile: async profile => fail ? { error: 'NETWORK', message: '网络中断' } : { profile },
    call: async () => ({ upserts: [], deleted: [] })
  };
  const sync = createSync({ cloud, keys, init() {}, today: () => '2026.11.01', normalizeActivityName: value => value || '', getProfile: () => wx.getStorageSync(keys.profile) || {} });
  sync.bindCloudAccount(remote.profile);
  wx.setStorageSync(keys.growth, [{ id: 'old-local', title: '旧本地记录' }]);
  await sync.hydrateOwnCloudState();
  assert.equal(wx.getStorageSync(keys.growth).length, 0, 'cloud is authoritative');
  assert.equal(calls, 0, 'legacy local data must never silently republish');
  assert(sync.getSyncStatus().items.some(job => job.review && job.item.id === 'old-local'));
  fail = true;
  await assert.rejects(sync.saveGrowth({ id: 'draft', title: '待发布', body: '正文' }), /网络中断/);
  assert.equal(wx.getStorageSync(keys.growth).length, 0, 'failed save must not enter published cache');
  const draft = sync.getSyncStatus().items.find(job => job.item && job.item.id === 'draft');
  assert(draft);
  fail = false; await sync.retrySync(draft.key);
  assert.equal(wx.getStorageSync(keys.growth)[0].id, 'draft');
  fail = true;
  await assert.rejects(sync.deleteGrowth('draft'), /网络中断/);
  assert.equal(wx.getStorageSync(keys.growth).length, 1, 'failed delete must preserve published cache');
  fail = false; await sync.deleteGrowth('draft');
  assert.equal(wx.getStorageSync(keys.growth).length, 0);
  fail = true;
  await assert.rejects(sync.saveProfileAsync({ name: '未成功的新名字' }));
  assert.notEqual(wx.getStorageSync(keys.profile).name, '未成功的新名字');
  fail = false;
  let release;
  deferred = new Promise(resolve => { release = resolve; });
  const changing = sync.saveWorkAsync({ id: 'work-a', title: 'A的作品' });
  while (calls < 3) await new Promise(resolve => setImmediate(resolve));
  sync.bindCloudAccount({ uid: '2222222', syncVersion: 2 });
  release(); await assert.rejects(changing, /账号已切换/);
  assert.equal((wx.getStorageSync(keys.works) || []).length, 0, 'inflight work cannot enter another account');
  assert.equal(sync.getSyncStatus().items.length, 0, 'pending lists must be isolated by account');
  sync.bindCloudAccount({ uid: '1111111', syncVersion: 2 });
  assert(sync.getSyncStatus().items.some(job => job.item && job.item.id === 'work-a'));
  sync.bindCloudAccount({ uid: '1111111', cacheKey: 'stable-account', syncVersion: 2 });
  sync.bindCloudAccount({ uid: '3333333', cacheKey: 'stable-account', syncVersion: 2 });
  assert(sync.getSyncStatus().items.some(job => job.item && job.item.id === 'work-a'), 'admin UID changes must preserve the same account drafts');
  assert.equal(sync.getSyncStatus().uid, '3333333');
  sync.bindCloudAccount({ uid: '4444444' });
  const before = calls;
  await assert.rejects(sync.saveGrowth({ title: 'incompatible backend' }), /同步服务尚未更新/);
  assert.equal(calls, before, 'old backend cannot silently accept new sync operations');
  console.log('cloud authority, failure drafts, explicit legacy recovery and account isolation passed');
}

async function managerTests() {
  let docs = new Map(); let tick = 1, failAfter = 0, writes = 0;
  const collections = { profiles: 'profiles', content: 'content' };
  const context = store => ({ collection: collection => ({ doc: id => ({
    get: async () => { const value = store.get(`${collection}/${id}`); if (!value) throw new Error('DATABASE_DOCUMENT_NOT_EXIST'); return { data: copy(value) }; },
    set: async ({ data }) => { if (failAfter && ++writes === failAfter) throw new Error('injected failure'); store.set(`${collection}/${id}`, Object.assign({}, copy(data), { _id: id })); },
    update: async ({ data }) => { const current = store.get(`${collection}/${id}`); store.set(`${collection}/${id}`, Object.assign({}, current, copy(data))); },
    remove: async () => store.delete(`${collection}/${id}`)
  }) }) });
  const db = { collection: name => context(docs).collection(name), runTransaction: async fn => { const staged = new Map(Array.from(docs, ([key, value]) => [key, copy(value)])); const result = await fn(context(staged)); docs = staged; return result; } };
  docs.set('profiles/owner', { uid: '1111111', contentRevision: 0 });
  const add = (id, kind, payload) => docs.set(`content/${id}`, { _id: id, ownerOpenid: 'owner', contentId: id, kind, updatedAt: 1, views: 4, likes: 3, commentCount: 2, payload: Object.assign({ id, campId: 'other', stageId: 'camper', subcampId: '', activityName: 'A', status: 'published', visibility: 'friends' }, payload) });
  const manager = createManager({ db, collections, ownProfile: async () => ({ uid: '1111111' }), ownerContentRecords: async () => ({ data: Array.from(docs.values()).filter(record => record.ownerOpenid === 'owner').map(copy) }), sanitizeContent: (kind, item) => copy(item), checkSubmission: async () => {}, exposeContent: record => Object.assign({}, record.payload, { updatedAt: record.updatedAt }), now: () => ++tick });
  add('activity', 'activity', { name: 'A', visibility: 'self' }); add('album', 'album', { name: '照片集' }); add('photo', 'photo', { folderId: 'album', image: 'cloud://p' }); add('work', 'work', { title: '作品' }); add('outside', 'photo', { campId: 'rural', activityName: '', image: 'cloud://outside' });
  failAfter = 2;
  await assert.rejects(manager.manage('owner', { operation: 'saveActivity', item: { id: 'activity', name: 'B' } }), /injected/);
  assert.equal(docs.get('content/activity').payload.name, 'A', 'failed transaction must roll back parent');
  assert.equal(docs.get('content/photo').payload.activityName, 'A', 'failed transaction must roll back children');
  failAfter = 0;
  await manager.manage('owner', { operation: 'saveActivity', item: { id: 'activity', name: 'B' } });
  assert.equal(docs.get('content/photo').payload.activityName, 'B');
  assert.equal(docs.get('content/album').payload.activityName, 'B');
  assert.equal(docs.get('content/work').payload.activityName, 'B');
  const removed = await manager.manage('owner', { operation: 'deleteAlbum', kind: 'album', id: 'album' });
  assert(removed.deleted.some(item => item.id === 'album'));
  const photo = docs.get('content/photo');
  assert.notEqual(photo.payload.folderId, 'album');
  assert(Array.from(docs.values()).some(item => item.kind === 'album' && item.contentId === photo.payload.folderId));
  assert.equal(docs.get('content/outside').payload.folderId, undefined, 'unrelated photos must not move');
  await assert.rejects(manager.manage('owner', { operation: 'movePhotos', ids: ['outside'], folderId: photo.payload.folderId }), /ALBUM_CONTEXT_MISMATCH/);
  await manager.manage('owner', { operation: 'deleteActivity', id: 'activity' });
  assert(!docs.has('content/work') && !docs.has('content/photo'));
  assert(docs.has('content/outside'));
  console.log('atomic rename/delete, folder photo recovery and move context protection passed');
}
clientTests().then(managerTests).catch(error => { console.error(error); process.exitCode = 1; });
