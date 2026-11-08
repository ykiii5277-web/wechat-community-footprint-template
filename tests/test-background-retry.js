const assert = require('assert');
const { createSync } = require('../utils/content-sync');
const retry = require('../utils/retry');
const copy = value => JSON.parse(JSON.stringify(value));
async function run() {
  let attempts = 0, prompts = 0;
  global.wx = { hideLoading() {}, showModal(options) { prompts++; assert.equal(options.confirmText, '重试'); assert.equal(options.cancelText, '取消'); options.success({ confirm: prompts === 1 }); } };
  await assert.rejects(retry.run(async () => { attempts++; throw new Error('offline'); }), error => error.cancelled === true);
  assert.equal(attempts, 2); assert.equal(prompts, 2);
  prompts = 0; attempts = 0;
  wx.showModal = options => { prompts++; options.success({ confirm: true }); };
  assert.equal(await retry.run(async () => { if (++attempts === 1) throw new Error('temporary'); return 'ok'; }), 'ok');
  assert.equal(prompts, 1);

  const store = new Map();
  Object.assign(wx, { getStorageSync: key => store.has(key) ? copy(store.get(key)) : '', setStorageSync: (key, value) => store.set(key, copy(value)), removeStorageSync: key => store.delete(key) });
  const fields = ['profile', 'photos', 'growth', 'works', 'companions', 'folders', 'activities', 'comments', 'favorites', 'profilePending', 'pendingFolderDeletes'];
  const keys = Object.fromEntries(fields.map(field => [field, field]));
  const remote = { profile: { uid: '1111111', syncVersion: 2 }, photos: [], growth: [], works: [], companions: [], albums: [], activities: [] };
  let fail = true, submitted = 0;
  const cloud = {
    CLOUD_ENV_ID: 'background-test', isRemoteFile: () => true,
    getOwnState: async () => copy(remote),
    upsertContent: async (kind, item) => { submitted++; if (fail) return { error: 'NETWORK', message: 'offline' }; remote.growth = remote.growth.filter(old => old.id !== item.id).concat(item); return { item }; }
  };
  const sync = createSync({ cloud, keys, init() {}, today: () => '2026.11.01', normalizeActivityName: value => value || '', getProfile: () => wx.getStorageSync('profile') || {} });
  sync.bindCloudAccount(remote.profile);
  wx.showModal = options => { prompts++; options.success({ confirm: false }); };
  await assert.rejects(sync.saveGrowth({ id: 'cancelled', title: 'cancelled', body: 'keep input' }), error => error.cancelled === true);
  const cancelled = sync.getSyncStatus().items.find(job => job.item.id === 'cancelled');
  assert.equal(cancelled.autoResume, false);
  fail = false;
  const before = submitted; await sync.runBackgroundSync();
  assert.equal(submitted, before, 'cancelled submissions must not resume silently');
  assert.equal(remote.growth.length, 0);

  fail = true; delete wx.showModal;
  await assert.rejects(sync.saveGrowth({ id: 'interrupted', title: 'confirmed publish', body: 'resume after connection' }));
  fail = false;
  wx.showModal = () => { throw new Error('background task must never display a dialog'); };
  await sync.runBackgroundSync();
  assert(remote.growth.some(item => item.id === 'interrupted'));
  assert(!sync.getSyncStatus().items.some(job => job.item.id === 'interrupted'));
  assert(sync.getSyncStatus().items.some(job => job.item.id === 'cancelled'));

  cloud.upsertContent = async () => ({ error: 'CONTENT_UNSAFE', message: '微信图片安全检测未通过，请修改或更换后重试' });
  wx.showModal = options => {
    assert(options.content.includes('当前照片：图片 7'), 'batch error must identify the current photo');
    assert(options.content.includes('图片安全检测未通过'));
    options.success({ confirm: false });
  };
  await assert.rejects(sync.savePhoto({ id: 'blocked-photo', name: '图片 7', image: 'cloud://photo' }), error => error.cancelled === true);

  const service = require('../utils/cloud-service');
  Object.assign(wx, { getFileInfo: options => options.success({ size: 12 }), cloud: { init() {}, callFunction() {}, uploadFile: async () => { throw new Error('network timeout'); } } });
  await assert.rejects(service.persistFile('wxfile://video', 'work-files', 'work.txt', { silent: true }), /网络/);
  console.log('retry/cancel, preserved cancelled input, silent background resume and silent file failure passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
