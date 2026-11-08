const assert = require('assert');
const storage = new Map();
global.wx = {
  getStorageSync: key => storage.has(key) ? storage.get(key) : '',
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key)
};
const cloud = require('../utils/cloud-service');
const data = require('../utils/data');
const remote = { profile: { uid: '1000001', syncVersion: 2 }, photos: [], growth: [], works: [], companions: [], activities: [], albums: [] };
const mirrored = [];
cloud.getOwnState = async () => remote;
cloud.upsertContent = (kind, item) => { mirrored.push({ kind, id: item.id }); const field = kind === 'album' ? 'albums' : 'photos'; remote[field] = remote[field].filter(old => old.id !== item.id).concat(item); return Promise.resolve({ item }); };
cloud.deleteContent = (kind, id) => { mirrored.push({ kind, id, deleted: true }); return Promise.resolve({ deleted: true }); };
cloud.call = async (action, payload) => { remote.albums = remote.albums.filter(item => item.id !== payload.id); return { upserts: [], deleted: [{ kind: 'album', id: payload.id }] }; };

async function run() {
  data.init();
  data.bindCloudAccount(remote.profile);
  const oldFolder = { id: 'old-empty-folder', name: '回忆集', campId: 'rural', stageId: 'camper', cover: '' };
  wx.setStorageSync('hui_time_folders_v1', [oldFolder]);
  assert.strictEqual(data.hasJourneyEdits({ campId: 'rural', stageId: 'camper' }), false);
  await data.hydrateOwnCloudState();
  assert.deepStrictEqual(data.getFolders({ campId: 'rural' }), [], '云端不存在的旧空相册不应重新上传');
  assert.strictEqual(mirrored.length, 0);

  const folder = await data.saveFolder({ name: '回忆集', campId: 'other', stageId: 'camper', activityName: '一次活动' });
  assert.strictEqual(data.hasJourneyEdits({ campId: 'other' }), false, '只有空相册时不显示红色提示');
  await data.hydrateOwnCloudState();
  assert.strictEqual(data.getFolders({ campId: 'other' }).length, 1, '正在同步的新相册不能丢失');
  remote.albums = [folder];
  await data.hydrateOwnCloudState();
  assert(!data.getSyncStatus().items.some(item => item.item && item.item.id === folder.id));

  await data.deleteFolder(folder.id);
  await data.hydrateOwnCloudState();
  assert.deepStrictEqual(data.getFolders({ campId: 'other' }), [], '云端旧快照不应让刚删除的相册复活');
  remote.albums = [];
  await data.hydrateOwnCloudState();

  await data.savePhoto({ image: 'cloud://photo', campId: 'other', stageId: 'camper', activityName: '一次活动' });
  assert.strictEqual(data.hasJourneyEdits({ campId: 'other' }), true, '有照片后才显示红色提示');
  console.log('empty album and journey notices passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
