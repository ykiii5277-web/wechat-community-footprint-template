const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
let previews = [], toasts = [], navigations = [], resolutionFails = false;
const sessions = require('../utils/image-viewer-session');
const wx = {
  previewImage: options => previews.push(options),
  showToast: options => toasts.push(options.title),
  navigateTo: options => navigations.push(options),
  setStorageSync() {}
};
function load(file, dependencies = {}) {
  let page;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    wx, module, exports: module.exports, console,
    Page(value) { page = value; },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
      return require(name.startsWith('.') ? path.resolve(root, path.dirname(file), name) : name);
    }
  });
  return page || module.exports;
}
const cloud = {
  async resolveCloudFiles(paths) {
    if (resolutionFails) throw new Error('offline');
    return paths.map(value => value.startsWith('cloud://') ? `https://media.test/${value.slice(8)}` : value);
  }
};
const preview = load('utils/image-preview.js', { './cloud-service': cloud });
const context = { folderId: 'album', campId: 'other', stageId: '', subcampId: '', activityName: '活动甲' };
const photo = (id, extra = {}) => Object.assign({}, context, { id, recordId: `record-${id}`, kind: 'photo', image: `cloud://${id}.jpg` }, extra);
const photos = [photo('first'), photo('second'), photo('other-album', { folderId: 'elsewhere' }), photo('other-activity', { activityName: '活动乙' }), photo('other-stage', { stageId: 'volunteer' }), photo('not-photo', { kind: 'work' }), photo('empty', { image: '' })];
const event = index => ({ currentTarget: { dataset: { index } } });
async function run() {
  await preview.open(['cloud://first.jpg', 'cloud://second.jpg', 'cloud://third.jpg'], 1);
  assert.equal(previews[0].current, 'https://media.test/second.jpg');
  assert.equal(previews[0].urls.length, 3, 'native full-screen viewer receives the entire gallery for swiping');
  assert.equal(previews[0].showmenu, true, 'keep the native zoom/save menu');

  previews = [];
  await preview.open(['cloud://first.jpg', '', 'cloud://third.jpg'], 2);
  assert.equal(previews[0].current, 'https://media.test/third.jpg', 'missing items must not shift the clicked image');
  assert.equal(previews[0].urls.length, 2);

  previews = [];
  await preview.openAlbum(photos, photos[1]);
  assert.deepEqual(Array.from(previews[0].urls), ['https://media.test/first.jpg', 'https://media.test/second.jpg']);
  assert.equal(previews[0].current, 'https://media.test/second.jpg');
  assert.equal(preview.albumPhotos(photos, photo('encoded', { activityName: encodeURIComponent('活动甲') })).length, 2);

  const own = load('pages/photo/preview.js', { '../../utils/data': { getPhotos: () => photos }, '../../utils/image-preview': preview });
  own.data.photo = photos[1]; previews = [];
  await own.previewImage();
  let viewerSession = sessions.get(navigations[navigations.length - 1].url.split('session=')[1]);
  assert.equal(viewerSession.images.length, 2);
  assert.equal(viewerSession.current, 1);

  let allowed = true, checks = 0;
  const detail = load('pages/community/detail.js', {
    '../../utils/data': { async getFriendContentAsync(uid, type) { checks++; assert.equal(uid, '1234567'); assert.equal(type, 'footprints'); return allowed ? { records: photos } : { error: 'FORBIDDEN' }; } },
    '../../utils/cloud-service': cloud, '../../utils/image-preview': preview
  });
  detail.data.item = photos[1]; detail.albumOwnerUid = '1234567'; previews = [];
  await detail.previewImage(event(0));
  viewerSession = sessions.get(navigations[navigations.length - 1].url.split('session=')[1]);
  assert.equal(checks, 1); assert.equal(viewerSession.images.length, 2);
  assert.equal(viewerSession.current, 1);
  allowed = false; previews = [];
  const beforeDenied = navigations.length;
  await detail.previewImage(event(0));
  assert.equal(previews.length, 0, 'revoked friendship must not open cached album images');
  assert.equal(navigations.length, beforeDenied);
  assert(toasts.includes('好友相册暂不可查看'));
  detail.albumOwnerUid = '';
  detail.data.item = { kind: 'growth', images: ['cloud://one.jpg', 'cloud://two.jpg'] };
  await detail.previewImage(event(1));
  assert.equal(previews[0].current, 'https://media.test/two.jpg');

  const friends = load('pages/friends/content.js', { '../../utils/data': {}, '../../utils/nav': { go: url => { friends.lastUrl = url; } } });
  friends.id = '1234567'; friends.data.records = photos;
  friends.openContent({ currentTarget: { dataset: { id: 'second', kind: 'photo', recordId: 'record-second' } } });
  assert(friends.lastUrl.includes('albumOwnerUid=1234567'));

  for (const file of ['pages/album/editor.js', 'pages/growth/editor.js', 'pages/profile/gift.js']) {
    const page = load(file, { '../../utils/data': {}, '../../utils/cloud-service': cloud, '../../utils/image-preview': preview });
    page.data.images = ['cloud://one.jpg', 'cloud://two.jpg']; previews = [];
    await page.previewImage(event(1));
    assert.equal(previews[0].urls.length, 2, `${file} must preview all selected images`);
    assert.equal(previews[0].current, 'https://media.test/two.jpg');
  }

  previews = []; resolutionFails = true;
  await preview.open(['cloud://one.jpg']);
  assert.equal(previews.length, 0);
  assert(toasts.includes('图片加载失败，请稍后重试'));
  console.log('native swipe galleries, clicked index, album/context isolation, friend permission checks and editor previews passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
