const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createManager } = require('../cloudfunctions/hui-api/content-manager');
const { createSync } = require('../utils/content-sync');
const copy = value => JSON.parse(JSON.stringify(value));
const context = { campId: 'rural', stageId: 'camper', subcampId: '', activityName: '' };
const photo = (id, folderId = 'album') => Object.assign({}, context, { id, folderId, name: id, image: `cloud://${id}`, visibility: 'friends', status: 'published', updatedAt: 1 });
async function pageTests() {
  let page, sheet, fail = false, applied = [];
  const photos = Array.from({ length: 120 }, (_, index) => photo(`photo-${index}`)).concat(photo('other', 'other-album'));
  const data = {
    getFolders: () => [{ id: 'album', name: '相册' }, { id: 'other-album', name: '其他相册' }], getPhotos: () => photos,
    visibilityOptions: () => [{ value: 'self', name: '仅自己可见' }, { value: 'friends', name: '仅好友可见' }, { value: 'public', name: '公开' }],
    async changePhotosVisibility(ids, visibility, folderId, versions, hideUid) {
      applied.push({ ids: ids.slice(), visibility, folderId, versions, hideUid });
      if (fail) throw new Error('offline');
      photos.filter(photo => ids.includes(photo.id)).forEach(photo => { photo.visibility = visibility; if (typeof hideUid === 'boolean') photo.hideUid = hideUid; });
    }
  };
  const wx = { showToast() {}, showActionSheet: options => { sheet = options; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/album/index.js'), 'utf8'), {
    Page: value => { page = value; }, wx,
    require(name) {
      if (name.endsWith('/data')) return data;
      if (name.endsWith('/actions')) return { async run(owner, task, label, after) { try { await task(); await after(); return true; } catch (error) { return false; } } };
      return {};
    }
  });
  page.data = copy(page.data); page.setData = (changes, callback) => { Object.assign(page.data, changes); if (callback) callback(); };
  page.data.context = context; page.data.folderId = 'album'; page.refresh();
  page.toggleSelectAll(); assert.equal(page.data.selectedIds.length, 0, 'select all is available only in selection mode');
  page.toggleSelectionMode(); page.toggleSelectAll();
  assert.equal(page.data.selectedCount, 120, 'select all includes off-screen photos beyond nine/100');
  assert(!page.data.selectedIds.includes('other'));
  assert.equal(page.data.allSelected, true);
  page.tapPhoto({ currentTarget: { dataset: { id: 'photo-0' } } });
  assert.equal(page.data.allSelected, false); assert.equal(page.data.selectedCount, 119);
  page.toggleSelectAll(); assert.equal(page.data.selectedCount, 120);
  page.toggleSelectAll(); assert.equal(page.data.selectedCount, 0);
  page.changeSelectedVisibility(); assert.equal(sheet, undefined, 'do not open scope picker without a selection');
  page.toggleSelectAll(); page.changeSelectedVisibility();
  assert.deepEqual(Array.from(sheet.itemList), ['公开', '仅好友可见', '仅自己可见']);
  const publish = sheet.success({ tapIndex: 0 });
  assert.deepEqual(Array.from(sheet.itemList), ['隐藏我的 UID', '显示我的 UID']);
  sheet.success({ tapIndex: 0 }); await publish;
  assert.equal(applied[0].hideUid, true);
  assert.equal(applied[0].ids.length, 120); assert.equal(applied[0].folderId, 'album');
  assert.equal(applied[0].versions['photo-0'], 1);
  assert(photos.filter(photo => photo.folderId === 'album').every(photo => photo.visibility === 'public'));
  assert.equal(photos[120].visibility, 'friends');
  assert.equal(page.data.selectionMode, true); assert.equal(page.data.selectedCount, 120);
  page.changeSelectedVisibility(); const showUid = sheet.success({ tapIndex: 0 }); sheet.success({ tapIndex: 1 }); await showUid;
  assert.equal(applied[1].hideUid, false);
  page.changeSelectedVisibility(); const cancelled = sheet.success({ tapIndex: 0 }); sheet.fail({ errMsg: 'cancel' }); await cancelled;
  assert.equal(applied.length, 2, 'cancel UID choice must not publish'); assert.equal(page.data.selectionBusy, false);
  fail = true; page.changeSelectedVisibility(); await sheet.success({ tapIndex: 2 });
  assert.equal(page.data.selectionBusy, false); assert.equal(page.data.selectedCount, 120);
  assert(photos.filter(photo => photo.folderId === 'album').every(photo => photo.visibility === 'public'));
  photos.splice(0, 1); page.refresh(); assert.equal(page.data.selectedCount, 119);
  page.data.selectionBusy = true; page.toggleSelectAll(); assert.equal(page.data.selectedCount, 119);
  page.data.selectionBusy = false; page.toggleSelectionMode(); assert.equal(page.data.selectedCount, 0);
  console.log('current-album select/clear all, 120-photo selection, visibility picker and preserved failure selection passed');
}
async function backendTests() {
  let docs = new Map(), tick = 1, failAt = 0, metricsChange = false;
  const collections = { content: 'content', profiles: 'profiles' };
  const connection = store => ({ collection: name => ({ doc: id => ({
    get: async () => { const doc = store.get(`${name}/${id}`); if (!doc) throw new Error('DATABASE_DOCUMENT_NOT_EXIST'); return { data: copy(doc) }; },
    set: async ({ data }) => { if (failAt && --failAt === 0) throw new Error('injected failure'); store.set(`${name}/${id}`, Object.assign({}, copy(data), { _id: id })); },
    update: async ({ data }) => store.set(`${name}/${id}`, Object.assign({}, store.get(`${name}/${id}`), copy(data)))
  }) }) });
  const db = {
    collection: name => connection(docs).collection(name),
    async runTransaction(task) {
      if (metricsChange) { Object.assign(docs.get('content/one'), { views: 99, likes: 88, commentCount: 77 }); metricsChange = false; }
      const staged = new Map(Array.from(docs, ([key, value]) => [key, copy(value)]));
      const result = await task(connection(staged)); docs = staged; return result;
    }
  };
  docs.set('profiles/owner', { uid: '1111111', contentRevision: 0 });
  const add = (id, kind, payload, owner = 'owner') => docs.set(`content/${id}`, { _id: id, kind, ownerOpenid: owner, contentId: payload.id || id, visibility: payload.visibility || 'friends', status: 'published', payload: Object.assign({}, context, payload), updatedAt: 1, publishedAt: 1, views: 3, likes: 2, commentCount: 1 });
  add('album', 'album', { id: 'album', visibility: 'self' }); add('other-album', 'album', { id: 'other-album', visibility: 'self' });
  add('one', 'photo', photo('one')); add('two', 'photo', photo('two')); add('outside', 'photo', photo('outside', 'other-album')); add('foreign', 'photo', photo('foreign'), 'other-owner');
  const manager = createManager({ db, collections, ownProfile: async () => ({ uid: '1111111' }), ownerContentRecords: async owner => ({ data: Array.from(docs.values()).filter(doc => doc.ownerOpenid === owner).map(copy) }), sanitizeContent: (kind, item) => copy(item), checkSubmission: async () => { throw new Error('unchanged assets must not be re-uploaded or re-checked'); }, exposeContent: record => Object.assign({}, record.payload, { updatedAt: record.updatedAt }), now: () => ++tick });
  const request = { operation: 'setPhotoVisibility', folderId: 'album', ids: ['one', 'two'], versions: { one: 1, two: 1 }, visibility: 'public' };
  const output = await manager.manage('owner', request);
  assert.equal(output.upserts.length, 2);
  assert.equal(docs.get('content/one').visibility, 'public'); assert.equal(docs.get('content/one').payload.visibility, 'public');
  assert.equal(docs.get('content/outside').visibility, 'friends'); assert.equal(docs.get('content/foreign').visibility, 'friends');
  assert.equal(docs.get('content/one').payload.image, 'cloud://one'); assert.equal(docs.get('content/one').publishedAt, 1);
  const revision = docs.get('profiles/owner').contentRevision;
  assert.equal((await manager.manage('owner', request)).upserts.length, 2, 'lost-response retry must acknowledge all selected photos');
  assert.equal(docs.get('profiles/owner').contentRevision, revision, 'idempotent retry must not create another write');
  const hideRequest = Object.assign({}, request, { hideUid: true, versions: {} });
  await manager.manage('owner', hideRequest);
  assert.equal(docs.get('content/one').payload.hideUid, true); assert.equal(docs.get('content/two').payload.hideUid, true);
  const uidRevision = docs.get('profiles/owner').contentRevision;
  await manager.manage('owner', hideRequest); assert.equal(docs.get('profiles/owner').contentRevision, uidRevision);
  await assert.rejects(manager.manage('owner', Object.assign({}, request, { hideUid: false })), /CONTENT_CONFLICT/, 'same visibility with changed UID privacy must still check versions');
  await manager.manage('owner', Object.assign({}, hideRequest, { hideUid: false }));
  assert.equal(docs.get('content/one').payload.hideUid, false);
  await assert.rejects(manager.manage('owner', Object.assign({}, request, { ids: ['one', 'foreign'] })), /PHOTO_SELECTION_CHANGED/);
  await assert.rejects(manager.manage('owner', Object.assign({}, request, { ids: ['outside'] })), /PHOTO_SELECTION_CHANGED/);
  await assert.rejects(manager.manage('owner', Object.assign({}, request, { visibility: 'invalid' })), /INVALID_VISIBILITY/);
  await assert.rejects(manager.manage('owner', Object.assign({}, request, { ids: [] })), /INVALID_PHOTO_SELECTION/);
  add('local-only', 'photo', Object.assign(photo('local-only'), { image: 'http://tmp/local.jpg', visibility: 'self' }));
  await assert.rejects(manager.manage('owner', Object.assign({}, request, { ids: ['local-only'] })), /SHARED_FILE_NOT_UPLOADED/);
  await assert.rejects(manager.manage('owner', Object.assign({}, request, { visibility: 'self', versions: { one: -1 } })), /CONTENT_CONFLICT/);
  failAt = 2;
  await assert.rejects(manager.manage('owner', Object.assign({}, request, { visibility: 'self', versions: {} })), /injected/);
  assert.equal(docs.get('content/one').visibility, 'public'); assert.equal(docs.get('content/two').visibility, 'public', 'transaction failure must not change half the selection');
  failAt = 0; metricsChange = true;
  await manager.manage('owner', Object.assign({}, request, { visibility: 'self', versions: {} }));
  assert.equal(docs.get('content/one').views, 99); assert.equal(docs.get('content/one').likes, 88); assert.equal(docs.get('content/one').commentCount, 77);
  add('one-alias', 'photo', Object.assign(photo('one'), { visibility: 'public' }));
  await manager.manage('owner', { operation: 'setPhotoVisibility', folderId: 'album', ids: ['one'], versions: { one: docs.get('content/one').updatedAt }, visibility: 'friends' });
  assert.equal(docs.get('content/one-alias').visibility, 'friends', 'historical aliases must not retain a public copy');
  console.log('server ownership/folder validation, atomic rollback, repeat receipt, metric preservation and alias visibility passed');
}
async function syncTests() {
  const storage = new Map();
  global.wx = { getStorageSync: key => storage.has(key) ? copy(storage.get(key)) : '', setStorageSync: (key, value) => storage.set(key, copy(value)), removeStorageSync: key => storage.delete(key) };
  const fields = ['profile', 'photos', 'growth', 'works', 'companions', 'folders', 'activities', 'comments', 'favorites', 'profilePending', 'pendingFolderDeletes'];
  const keys = Object.fromEntries(fields.map(field => [field, field]));
  const remote = { profile: { uid: '1111111', syncVersion: 2 }, photos: [photo('one'), photo('two'), photo('three')], growth: [], works: [], companions: [], albums: [{ id: 'album' }], activities: [] };
  let fail = false, partial = false, unknown = false, editFail = false, lostReceipt = false, ignoreUid = false, requests = [];
  const cloud = {
    CLOUD_ENV_ID: 'selection-test', isRemoteFile: () => true, getOwnState: async () => copy(remote),
    async call(action, body) {
      if (unknown) return { error: 'UNKNOWN_ACTION' };
      if (fail) return { error: 'NETWORK', message: 'offline' };
      requests.push(copy(body));
      remote.photos.filter(photo => body.ids.includes(photo.id)).forEach(photo => { photo.visibility = body.visibility; if (!ignoreUid && typeof body.hideUid === 'boolean') photo.hideUid = body.hideUid; });
      if (lostReceipt) return { error: 'NETWORK', message: 'receipt lost' };
      const upserts = remote.photos.filter(photo => body.ids.includes(photo.id)).slice().reverse().map(photo => ({ kind: 'photo', item: copy(photo) }));
      return { upserts: partial ? upserts.slice(0, 1) : upserts, deleted: [] };
    },
    async upsertContent(kind, item) {
      if (editFail) return { error: 'NETWORK', message: 'offline' };
      const index = remote.photos.findIndex(photo => photo.id === item.id); remote.photos[index] = copy(item); return { item };
    }
  };
  const sync = createSync({ cloud, keys, init() {}, today: () => '2026.11.02', normalizeActivityName: value => value || '', getProfile: () => wx.getStorageSync('profile') || {} });
  sync.bindCloudAccount(remote.profile); await sync.hydrateOwnCloudState();
  fail = true;
  await assert.rejects(sync.changePhotosVisibility(['one', 'three'], 'public', 'album'), /offline/);
  assert(wx.getStorageSync('photos').every(photo => photo.visibility === 'friends'), 'failed requests must not change published local state');
  fail = false; await sync.changePhotosVisibility(['one', 'three'], 'public', 'album');
  assert.deepEqual(wx.getStorageSync('photos').map(photo => photo.id), ['one', 'two', 'three'], 'batch receipt must preserve album display order');
  assert.equal(wx.getStorageSync('photos')[0].visibility, 'public');
  unknown = true; await assert.rejects(sync.changePhotosVisibility(['two'], 'self', 'album'), /更新云函数/); unknown = false;
  partial = true;
  await assert.rejects(sync.changePhotosVisibility(['one', 'three'], 'self', 'album'), /尚未确认全部/);
  assert.equal(wx.getStorageSync('photos')[0].visibility, 'public', 'partial acknowledgement must not be presented as success');
  partial = false; await sync.hydrateOwnCloudState();
  assert(!sync.getSyncStatus().items.some(job => job.payload && job.payload.visibility === 'self' && job.payload.ids.includes('one')), 'cloud-confirmed completion must clear lost receipts');

  fail = true;
  await assert.rejects(sync.changePhotosVisibility(['one', 'two'], 'public', 'album'));
  fail = false; await sync.changePhotosVisibility(['one'], 'self', 'album');
  const older = sync.getSyncStatus().items.find(job => job.payload && job.payload.visibility === 'public');
  assert.deepEqual(older.payload.ids, ['two'], 'newer privacy choice supersedes overlaps in old pending batches');
  await sync.retrySync(older.key); assert.equal(remote.photos.find(photo => photo.id === 'one').visibility, 'self');
  editFail = true;
  await assert.rejects(sync.savePhotoAsync(Object.assign({}, remote.photos[0], { name: 'pending edit', visibility: 'public' })));
  editFail = false; await sync.changePhotosVisibility(['one'], 'self', 'album');
  const draft = sync.getSyncStatus().items.find(job => job.kind === 'photo' && job.item.id === 'one');
  assert.equal(draft.item.name, 'pending edit'); assert.equal(draft.item.visibility, 'self');
  await sync.retrySync(draft.key); assert.equal(remote.photos[0].visibility, 'self', 'older editing retries must not restore public visibility');

  lostReceipt = true;
  await assert.rejects(sync.changePhotosVisibility(['three'], 'friends', 'album'), /receipt lost/);
  lostReceipt = false; await sync.hydrateOwnCloudState();
  assert(!sync.getSyncStatus().items.some(job => job.payload && job.payload.ids.includes('three')));
  remote.photos.find(photo => photo.id === 'one').visibility = 'friends';
  editFail = true;
  await assert.rejects(sync.savePhotoAsync(Object.assign({}, remote.photos.find(photo => photo.id === 'one'), { name: 'older background edit', visibility: 'public' })));
  editFail = false; fail = true;
  await assert.rejects(sync.changePhotosVisibility(['one'], 'self', 'album'));
  fail = false;
  const pendingKey = Array.from(storage.keys()).find(key => key.endsWith('_pending'));
  const queued = storage.get(pendingKey);
  const oldEdit = queued.find(job => job.kind === 'photo' && job.item.name === 'older background edit');
  const newerScope = queued.find(job => job.payload && job.payload.operation === 'setPhotoVisibility' && job.payload.ids.includes('one'));
  storage.set(pendingKey, [newerScope, oldEdit]);
  await sync.runBackgroundSync();
  assert.equal(remote.photos.find(photo => photo.id === 'one').visibility, 'self', 'background queue snapshots must reload superseded privacy intent before replay');
  ignoreUid = true;
  await assert.rejects(sync.changePhotosVisibility(['one'], 'public', 'album', {}, true), /UID/);
  await sync.hydrateOwnCloudState();
  assert(sync.getSyncStatus().items.some(job => job.payload && job.payload.hideUid === true), 'matching visibility alone must not acknowledge missing UID privacy');
  ignoreUid = false; await sync.changePhotosVisibility(['one'], 'public', 'album', {}, true);
  assert.equal(wx.getStorageSync('photos').find(photo => photo.id === 'one').hideUid, true);
  editFail = true;
  await assert.rejects(sync.savePhotoAsync(Object.assign({}, remote.photos.find(photo => photo.id === 'one'), { name: 'old UID edit', hideUid: false })));
  editFail = false; await sync.changePhotosVisibility(['one'], 'public', 'album', {}, true);
  const uidDraft = sync.getSyncStatus().items.find(job => job.item && job.item.name === 'old UID edit');
  assert.equal(uidDraft.item.hideUid, true, 'old draft retry must not reveal hidden UID');
  await sync.retrySync(uidDraft.key); assert.equal(remote.photos.find(photo => photo.id === 'one').hideUid, true);
  console.log('cloud-only acknowledgement, stable order, old backend/partial failures, reconciliation and latest privacy intent passed');
}
pageTests().then(backendTests).then(syncTests).catch(error => { console.error(error); process.exitCode = 1; });
