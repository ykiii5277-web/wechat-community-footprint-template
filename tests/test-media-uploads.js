const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
function load(file, dependencies, wx, extra = '') {
  let page;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8') + extra, {
    module, exports: module.exports, Buffer, console, process, wx,
    setTimeout() {}, Page(value) { page = value; },
    require(name) { return dependencies[name] || require(require.resolve(name, { paths: [path.dirname(path.join(root, file))] })); }
  });
  if (page) { page.data = JSON.parse(JSON.stringify(page.data)); page.setData = changes => Object.assign(page.data, changes); }
  return page || module.exports;
}
async function run() {
  let size = 12345, compression;
  const limit = 500 * 1024 * 1024;
  const wx = { showLoading() {}, hideLoading() {}, showToast() {}, getVideoInfo: o => o.success({ width: 3840, height: 2160, fps: 60 }), compressVideo: o => { compression = o; o.success({ tempFilePath: 'compressed.mp4' }); } };
  const media = load('utils/work-media.js', { './cloud-service': { MAX_VIDEO_FILE_BYTES: limit, fileSize: async () => size } }, wx);
  assert.equal((await media.prepareVideo('source.mov')).size, 12345);
  assert.equal(compression.resolution, 1 / 3);
  assert.equal(compression.fps, 30);
  assert.equal(compression.quality, undefined, 'quality must not override bitrate/resolution');
  size = limit;
  await media.prepareVideo('source.mov');
  size++;
  await assert.rejects(media.prepareVideo('source.mov'), /500M/);
  wx.compressVideo = o => o.fail({});
  await assert.rejects(media.prepareVideo('source.mov'), /压缩失败/);

  const downloaded = [], savedToAlbum = [], toasts = [];
  const video = { mediaType: 'video', filePath: 'cloud://video.mp4', fileUrl: 'https://cloud.example/video.mp4?sign=test' };
  const downloadWx = {
    showLoading() {}, hideLoading() {}, showToast: ({ title }) => toasts.push(title),
    cloud: { downloadFile: async () => ({ tempFilePath: 'wxfile://video.mp4' }) },
    downloadFile(options) { downloaded.push(options.url); options.success({ statusCode: 200, tempFilePath: 'wxfile://friend.mp4' }); },
    saveVideoToPhotosAlbum(options) { savedToAlbum.push(options.filePath); options.success(); }
  };
  const videoDownload = load('utils/work-media.js', { './cloud-service': { isRemoteFile: () => true } }, downloadWx);
  await videoDownload.saveVideo(() => video);
  assert.deepEqual(savedToAlbum, ['wxfile://video.mp4']);
  assert.deepEqual(downloaded, []);
  downloadWx.cloud.downloadFile = async () => { throw new Error('storage permission denied'); };
  await videoDownload.saveVideo(() => video);
  assert.deepEqual(downloaded, [video.fileUrl]);
  assert.deepEqual(savedToAlbum, ['wxfile://video.mp4', 'wxfile://friend.mp4']);
  await videoDownload.saveVideo(() => null);
  assert.equal(downloaded.length, 1);
  assert.equal(savedToAlbum.length, 2);
  assert.equal(toasts.at(-1), '该视频暂不可下载');

  let batch = 0, saved = [], failOnce = true;
  const cloud = {
    isRemoteFile: () => true, persistFile: async p => `cloud://${p}`, showUploadError() {},
    async persistImages(paths, category, onBatch) { onBatch(await Promise.all(paths.map(path => this.persistFile(path, category)))); }
  };
  const album = load('pages/album/editor.js', {
    '../../utils/cloud-service': cloud, '../../utils/nav': {},
    '../../utils/privacy': { chooseMedia: async o => o.success({ tempFiles: Array.from({ length: 12 }, (_, i) => ({ tempFilePath: `${batch}-${i}` })) }) },
    '../../utils/data': { stageDraft() {}, savePhotoAsync: async item => { if (saved.length === 5 && failOnce) { failOnce = false; throw new Error('network'); } saved.push(item); } }
  }, wx);
  album.data.folderId = 'folder'; album.data.context = { campId: 'rural', stageId: 'camper' }; album.data.visibilityOptions = [{ value: 'self' }, { value: 'friends' }];
  await album.chooseImages();
  // Callback-based chooser returns before async uploads complete.
  while (album._busy) await new Promise(resolve => setImmediate(resolve));
  batch++;
  await album.chooseImages();
  while (album._busy) await new Promise(resolve => setImmediate(resolve));
  assert.equal(album.data.images.length, 24, 'album selection must accumulate beyond nine');
  await album.save();
  assert.equal(saved.length, 5);
  await album.save();
  assert.equal(saved.length, 24, 'retry must not duplicate already-saved photos');
  assert(saved.every(item => item.folderId === 'folder'));

  let picked = 0;
  const growth = load('pages/growth/editor.js', {
    '../../utils/data': {}, '../../utils/nav': {}, '../../utils/cloud-service': cloud,
    '../../utils/privacy': { chooseMedia: o => { picked++; assert.equal(o.count, 1); } }
  }, wx);
  growth.data.images = Array(9).fill('image'); growth.chooseImages(); assert.equal(picked, 0);
  growth.data.images.pop(); growth.chooseImages(); assert.equal(picked, 1);

  let actual = limit, writes = 0;
  const sdk = { init() {}, database: () => ({ command: {}, collection: () => ({ add: async () => { writes++; return { _id: 'record' }; } }) }) };
  const backend = load('cloudfunctions/hui-api/index.js', {
    'wx-server-sdk': sdk,
    './content-manager': { createManager: () => ({ commit: async (openid, jobs) => { writes++; jobs.forEach(job => { job.record._id = 'record'; }); } }) },
    './media-files': Object.assign({}, require('../cloudfunctions/hui-api/media-files'), { storedFileSize: async () => actual })
  }, {}, '\nownProfile = async () => ({uid: "1234567"}); findContent = async () => null; checkSubmission = async () => {}; module.exports = {upsertContent};');
  const payload = { kind: 'work', item: { id: 'work', filePath: 'cloud://video', fileSize: 1, fileName: 'video.mp4' } };
  await backend.upsertContent('owner', payload); assert.equal(writes, 1);
  actual++;
  await assert.rejects(backend.upsertContent('owner', payload), /VIDEO_FILE_TOO_LARGE/);
  assert.equal(writes, 1, 'server must reject oversized real files even when client claims one byte');
  actual = 20 * 1024 * 1024;
  const photoPayload = { kind: 'photo', item: { id: 'photo', image: 'cloud://photo', fileSize: 1 } };
  await backend.upsertContent('owner', photoPayload);
  actual++;
  await assert.rejects(backend.upsertContent('owner', photoPayload), /IMAGE_FILE_TOO_LARGE/);
  const imageAttachment = { kind: 'work', item: { id: 'image-work', filePath: 'cloud://image', fileName: 'picture.jpg', fileSize: 1 } };
  await assert.rejects(backend.upsertContent('owner', imageAttachment), /IMAGE_FILE_TOO_LARGE/);
  actual = 1000 * 1024 * 1024;
  const documentPayload = { kind: 'work', item: { id: 'document', filePath: 'cloud://document', fileName: 'report.pdf', fileSize: 1 } };
  await backend.upsertContent('owner', documentPayload); actual++;
  await assert.rejects(backend.upsertContent('owner', documentPayload), /MEDIA_FILE_TOO_LARGE/);
  const sanitization = load('cloudfunctions/hui-api/index.js', { 'wx-server-sdk': sdk }, {}, '\nmodule.exports = {sanitizeContent};');
  assert.equal(sanitization.sanitizeContent('companion', { id: 'person', visibility: 'public' }).visibility, 'friends');
  assert.equal(sanitization.sanitizeContent('photo', { id: 'photo', visibility: 'public' }).visibility, 'public');
  let rangeOptions, destroyed = false;
  const serverFiles = load('cloudfunctions/hui-api/media-files.js', { https: {
    request(url, options, callback) {
      rangeOptions = options;
      const request = { setTimeout() {}, on() {}, end() { callback({ statusCode: 206, headers: { 'content-range': `bytes 0-0/${limit}`, 'content-length': '1' }, destroy() { destroyed = true; } }); } };
      return request;
    }
  } }, {});
  assert.equal(await serverFiles.storedFileSize({ getTempFileURL: async () => ({ fileList: [{ fileID: 'cloud://file', tempFileURL: 'https://storage.test/file?sign=test' }] }) }, 'cloud://file'), limit);
  assert.equal(rangeOptions.headers.Range, 'bytes=0-0'); assert(destroyed);

  const records = Array.from({ length: 205 }, (_, i) => ({ contentId: `p${i}`, kind: 'photo', ownerOpenid: 'owner' }));
  const readSdk = { init() {}, database: () => ({ command: {}, collection: () => ({ where(filter) {
    const matches = records.filter(record => Object.entries(filter).every(([key, value]) => record[key] === value));
    let offset = 0;
    return { orderBy() { return this; }, skip(value) { offset = value; return this; },
      limit(size) { return { get: async () => ({ data: matches.slice(offset, offset + size) }) }; } };
  } }) }) };
  const reads = load('cloudfunctions/hui-api/index.js', { 'wx-server-sdk': readSdk }, {}, '\nmodule.exports = {ownerContentRecords, findContent};');
  assert.equal((await reads.ownerContentRecords('owner')).data.length, 205);
  assert.equal((await reads.findContent('owner', 'photo', 'p204')).contentId, 'p204');
  console.log('video compression, 500M boundary, server size verification, 24-photo batch/retry and record nine-image limit passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
