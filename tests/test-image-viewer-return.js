const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const sessions = require('../utils/image-viewer-session');
let navigations = [], saved = [], downloads = [], views = [], favoriteIds = [], lastEdit = '', backs = 0;
const modals = [];
const wx = {
  navigateTo: options => { navigations.push(options); }, navigateBack: () => { backs++; },
  showToast() {}, showModal: options => { modals.push(options); }, getWindowInfo: () => ({ statusBarHeight: 40, windowWidth: 300, windowHeight: 600 }), removeStorageSync() {},
  saveImageToPhotosAlbum: options => { saved.push(options.filePath); options.success({}); },
  cloud: { async downloadFile({ fileID }) { downloads.push(fileID); return { tempFilePath: `wxfile://${fileID.slice(8)}` }; } }
};
function load(file, dependencies) {
  let page;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    wx, console, module, exports: module.exports, setTimeout, clearTimeout,
    Page(value) { page = value; },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(dependencies || {}, name)) return dependencies[name];
      return require(name.startsWith('.') ? path.resolve(root, path.dirname(file), name) : name);
    }
  });
  if (!page) return module.exports;
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = changes => Object.entries(changes).forEach(([key, value]) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let object = page.data;
    parts.slice(0, -1).forEach(part => { object = object[part]; });
    object[parts[parts.length - 1]] = value;
  });
  return page;
}
const photo = id => ({ id, recordId: `r-${id}`, kind: 'photo', folderId: 'album', campId: 'rural', image: `cloud://${id}.jpg` });
const photos = [photo('first'), photo('second'), photo('third')];
let mediaResolutions = 0;
const cloud = { resolveCloudFiles: async paths => {
  mediaResolutions++;
  return paths.map(value => `https://images.test/${value.slice(8)}`);
} };
const preview = load('utils/image-preview.js', { './cloud-service': cloud });
const tick = () => new Promise(resolve => setImmediate(resolve));
const sessionId = () => navigations[navigations.length - 1].url.split('session=')[1];
async function run() {
  const data = {
    getPhotos: () => photos, getPhoto: id => photos.find(photo => photo.id === id), getCamp: () => ({}),
    recordContentView: (kind, id) => views.push(id),
    toggleFavorite: async (kind, id) => favoriteIds.push(id)
  };
  const own = load('pages/photo/preview.js', {
    '../../utils/data': data, '../../utils/image-preview': preview,
    '../../utils/nav': { go: url => { lastEdit = url; } },
    '../../utils/actions': { run: async (page, task, label, complete) => { await task(); complete(); } }
  });
  own.id = 'first'; own.refresh();
  await own.previewImage();
  assert.equal(mediaResolutions, 0, 'opening your own album must not wait for signed URLs for the whole album');
  const token = sessionId();
  const viewer = load('pages/media/image-viewer.js', {
    '../../utils/cloud-service': Object.assign({}, require('../utils/cloud-service'), cloud)
  });
  viewer.onLoad({ session: token });
  assert.equal(viewer.data.current, 0);
  assert.equal(viewer.data.total, 3);
  assert.equal(viewer.data.images[0].url, photos[0].image);
  assert.equal(viewer.data.topInset, 40);
  viewer.change({ detail: { current: 1 } });
  const at = (clientX, clientY) => ({ clientX, clientY });
  viewer.imageLoad({ currentTarget: { dataset: { index: 1 } }, detail: { width: 300, height: 600 } });
  viewer.touchStart({ touches: [at(150, 300), at(250, 300)] });
  viewer.touchMove({ touches: [at(100, 300), at(300, 300)] });
  assert.equal(viewer.data.zoomed, true);
  assert.equal(viewer._transform.scale, 2);
  assert.equal(viewer._transform.x, -50, 'keep the photo under the pinch midpoint');
  viewer.touchEnd({ touches: [] });
  assert.equal(viewer._transform.scale, 2, 'release must preserve the zoom');
  viewer.change({ detail: { current: 1 } });
  assert.equal(viewer.data.zoomed, true, 'duplicate swiper change must not reset the active zoom');
  viewer.touchStart({ touches: [at(150, 300)] });
  viewer.touchMove({ touches: [at(220, 410)] });
  viewer.touchEnd({ touches: [], changedTouches: [at(220, 410)] });
  assert.equal(viewer.data.current, 1, 'dragging while zoomed must not switch pictures');
  assert.equal(viewer._transform.x, 20);
  assert.equal(viewer._transform.y, 110);
  viewer.touchStart({ touches: [at(50, 300), at(250, 300)] });
  viewer.touchMove({ touches: [at(100, 300), at(200, 300)] });
  viewer.touchEnd({ touches: [at(200, 300)] });
  viewer.touchEnd({ touches: [], changedTouches: [at(40, 300)] });
  assert.equal(viewer.data.current, 1, 'finishing the pinch must not switch pictures');
  assert.equal(viewer.data.zoomed, false);
  viewer.touchStart({ touches: [at(250, 300)] });
  viewer.touchEnd({ touches: [], changedTouches: [at(80, 305)] });
  assert.equal(viewer.data.current, 2, 'a new horizontal swipe at original scale must switch pictures');
  viewer.touchEnd({ touches: [] });
  assert.equal(viewer.data.zoomed, false);
  await viewer.save();
  assert.equal(downloads[0], 'cloud://third.jpg', 'save the currently viewed image');
  assert.equal(saved[0], 'wxfile://third.jpg');
  wx.cloud.downloadFile = async () => { throw new Error('storage permission denied'); };
  wx.downloadFile = options => {
    assert.equal(options.url, 'https://images.test/third.jpg');
    options.success({ statusCode: 200, tempFilePath: 'wxfile://fallback.jpg' });
  };
  await viewer.save();
  assert.equal(saved.at(-1), 'wxfile://fallback.jpg', 'cloud download failure must try the resolved image URL');
  wx.downloadFile = options => options.fail({ errMsg: 'downloadFile:fail url not in domain list' });
  await viewer.save();
  assert.equal(modals.at(-1).title, '图片下载失败');
  assert.equal(saved.length, 2, 'download failure must not call the album API');
  wx.downloadFile = options => options.success({ statusCode: 200, tempFilePath: 'wxfile://fallback.jpg' });
  wx.saveImageToPhotosAlbum = options => options.fail({ errno: 112, errMsg: 'saveImageToPhotosAlbum:fail' });
  await viewer.save();
  assert.equal(modals.at(-1).title, '暂未开通保存到相册');
  // System back also triggers onUnload; no custom button callback is required.
  viewer.onUnload(); await tick();
  assert.equal(own.id, 'third');
  assert.equal(own.data.photo.id, 'third');
  assert.deepEqual(views, ['third']);
  assert.equal(sessions.get(token), undefined);
  await own.favorite();
  assert.deepEqual(favoriteIds, ['third'], 'like the selected photo rather than the opening photo');
  own.edit(); assert(lastEdit.includes('id=third'));
  viewer.onUnload(); await tick();
  assert.equal(views.length, 1, 'close callback must run once');

  let selected;
  await preview.open(['cloud://one', '', 'cloud://three'], 0, { onClose: index => { selected = index; } });
  const filtered = load('pages/media/image-viewer.js');
  filtered.onLoad({ session: sessionId() });
  filtered.change({ detail: { current: 1 } });
  filtered.onUnload(); await tick();
  assert.equal(selected, 2, 'map the compact viewer index to the original source index');

  const requests = [];
  const detailCloud = Object.assign({}, cloud, {
    getContent: (kind, id) => new Promise(resolve => requests.push({ id, resolve })),
    recordView: async () => ({ views: 5 }), getComments: async () => ({ comments: [] })
  });
  const shared = load('pages/community/detail.js', {
    '../../utils/cloud-service': detailCloud, '../../utils/data': { getProfile: () => ({ uid: 'mine' }), visibilityLabel: () => '好友', getCampName: () => '营地' },
    '../../utils/comment-threads': { buildCommentThreads: list => list }
  });
  shared.id = 'first'; shared.recordId = 'r-first'; shared.kind = 'photo'; shared.ownerUid = shared.albumOwnerUid = '1234567';
  shared.data.item = photos[0]; shared.data.comments = [{ id: 'old-comment' }];
  const oldRequest = shared.refresh();
  const selectedRequest = shared.selectGalleryPhoto(photos[2]);
  assert.equal(shared.id, 'third'); assert.equal(shared.recordId, 'r-third');
  assert.equal(shared.data.comments.length, 0, 'comments from the previous photo must be cleared');
  requests[1].resolve({ item: photos[2] }); await selectedRequest; await tick();
  requests[0].resolve({ item: photos[0] }); await oldRequest;
  assert.equal(shared.data.item.id, 'third', 'late requests must not restore the opening photo');

  let lateComments;
  detailCloud.getComments = () => new Promise(resolve => { lateComments = resolve; });
  const commentsRequest = shared.refreshComments();
  shared.id = 'second'; shared.recordId = 'r-second';
  lateComments({ comments: [{ id: 'third-comment' }] }); await commentsRequest;
  assert.equal(shared.data.comments.length, 0, 'late comments must not appear under another photo');

  wx.navigateTo = options => { navigations.push(options); options.fail({}); };
  await preview.open(['cloud://one'], 0, { onClose() { throw new Error('failed navigation must not finish a session'); } });
  assert.equal(sessions.get(sessionId()), undefined);
  console.log('swipe/close detail synchronization, save/like/edit target, index mapping, callback cleanup and stale photo/comment response checks passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
