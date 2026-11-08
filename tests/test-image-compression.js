const assert = require('assert');
const service = require('../utils/cloud-service');
const privacy = require('../utils/privacy');
const target = 900 * 1024;
let sizes, info, compressed, uploaded, compress;
function setup(sourceSize, dimensions, compressResult) {
  sizes = { 'wxfile://source': sourceSize };
  info = dimensions;
  compressed = [];
  uploaded = [];
  compress = compressResult;
  global.wx = {
    getFileInfo(options) {
      if (!(options.filePath in sizes)) return options.fail(new Error('file missing'));
      options.success({ size: sizes[options.filePath] });
    },
    getImageInfo(options) { options.success(Object.assign({ type: 'png' }, info)); },
    compressImage(options) {
      compressed.push(options);
      const output = `wxfile://compressed-${compressed.length}`;
      sizes[output] = compress(options);
      options.success({ tempFilePath: output });
    },
    cloud: {
      init() {}, callFunction() {},
      async uploadFile(options) { uploaded.push(options); return { fileID: 'cloud://uploaded' }; }
    }
  };
}
async function upload(category = 'photos') {
  return service.persistFile('wxfile://source', category, '', { silent: true });
}
async function run() {
  // The entire picker pipeline must request originals, including chooseMedia's fallback.
  setup(800 * 1024, { width: 2000, height: 1500 }, () => { throw new Error('small original must not be compressed'); });
  let selection;
  wx.chooseImage = options => {
    assert.deepEqual(options.sizeType, ['original']);
    options.success({ tempFilePaths: ['wxfile://source'] });
  };
  privacy.chooseMedia({ success: result => { selection = result.tempFiles[0].tempFilePath; } });
  assert.equal(selection, 'wxfile://source');
  await service.persistFile(selection, 'photos', '', { silent: true });
  assert.equal(uploaded[0].filePath, selection, 'small original must reach storage without re-encoding');
  wx.chooseMedia = options => { assert.deepEqual(options.sizeType, ['original']); options.fail({ errMsg: 'unsupported count' }); };
  selection = '';
  privacy.chooseMedia({ count: 20, preferMedia: true, success: result => { selection = result.tempFiles[0].tempFilePath; } });
  assert.equal(selection, 'wxfile://source');
  delete wx.chooseImage;
  wx.chooseMedia = options => {
    assert.deepEqual(options.sizeType, ['original']);
    options.success({ tempFiles: [{ tempFilePath: 'wxfile://source' }] });
  };
  selection = '';
  privacy.chooseMedia({ preferMedia: true, success: result => { selection = result.tempFiles[0].tempFilePath; } });
  assert.equal(selection, 'wxfile://source');

  // A 10MB group photo must first keep its full 4000x3000 resolution, then choose
  // the highest quality within the byte limit, rather than immediately using 2048px/75.
  setup(10 * 1024 * 1024, { width: 4000, height: 3000, type: 'jpeg' }, options => Math.round(options.compressedWidth * options.compressedHeight * 0.12 * Math.pow(options.quality / 100, 5)));
  await upload();
  const chosen = compressed[Number(uploaded[0].filePath.match(/-(\d+)$/)[1]) - 1];
  assert.equal(chosen.compressedWidth, 4000);
  assert.equal(chosen.compressedHeight, 3000);
  assert.equal(chosen.quality, 91, 'find the highest fitting JPEG quality at the same resolution');
  assert(sizes[uploaded[0].filePath] > 800 * 1024 && sizes[uploaded[0].filePath] <= target);
  assert(compressed.every(options => options.quality >= 88));

  setup(20 * 1024 * 1024, { width: 6000, height: 4000, type: 'jpeg' }, options => Math.round(options.compressedWidth * options.compressedHeight * 0.4 * Math.pow(options.quality / 100, 5)));
  await upload();
  assert(sizes[uploaded[0].filePath] <= target);
  assert(compressed.some(options => options.compressedWidth < 6000), 'resize only after full-size high-quality compression cannot fit');
  assert(compressed.every(options => options.compressedWidth >= 1080 && options.quality >= 88));
  assert(compressed.every(options => options.src === 'wxfile://source'));

  // PNG-like encoder: lowering quality has no effect; only reducing pixels works.
  setup(12 * 1024 * 1024, { width: 4000, height: 3000 }, options => options.compressedWidth * options.compressedHeight * 0.7 + 1024);
  assert.equal(await upload(), 'cloud://uploaded');
  assert(compressed.length > 1);
  assert(sizes[uploaded[0].filePath] <= target);
  assert.equal(uploaded[0].cloudPath.slice(-4), '.png');
  compressed.forEach(options => {
    assert.equal(options.src, 'wxfile://source', 'always compress original, not a previous compressed copy');
    assert(Math.abs(options.compressedHeight - options.compressedWidth * 3 / 4) < 1.1, 'preserve aspect ratio within integer-pixel rounding');
    assert(options.compressedWidth <= info.width && options.compressedHeight <= info.height);
    assert(options.compressedWidth >= 1080, 'do not silently sacrifice large photos to tiny thumbnails');
  });

  setup(4 * 1024 * 1024, { width: 3000, height: 4000 }, () => 600 * 1024);
  await upload('avatars');
  assert.equal(compressed.length, 1, 'stop as soon as compressed image fits');
  assert.equal(compressed[0].compressedWidth, 3000);
  assert.equal(compressed[0].compressedHeight, 4000);
  assert.equal(compressed[0].quality, 98);

  setup(2 * 1024 * 1024, { width: 320, height: 240 }, () => 100 * 1024);
  await upload('folder-covers');
  assert.equal(compressed[0].compressedWidth, 320, 'never upscale small images');

  setup(target, { width: 640, height: 480 }, () => { throw new Error('unexpected compression'); });
  await upload();
  assert.equal(compressed.length, 0);
  assert.equal(uploaded[0].filePath, 'wxfile://source');

  setup(service.MAX_IMAGE_FILE_BYTES + 1, { width: 4000, height: 3000 }, () => 1);
  await assert.rejects(upload(), /20M/);
  assert.equal(compressed.length, 0, 'oversized originals must be rejected before compression');
  assert.equal(uploaded.length, 0);

  setup(2 * 1024 * 1024, { width: 4000, height: 3000 }, () => 2 * 1024 * 1024);
  await assert.rejects(upload(), /保留清晰度/);
  assert.equal(uploaded.length, 0, 'never upload an image that the safety check cannot accept');

  setup(2 * 1024 * 1024, { width: 4000, height: 3000 }, () => 0);
  await assert.rejects(upload(), /无法读取压缩后的图片/);
  assert.equal(uploaded.length, 0);

  setup(2 * 1024 * 1024, { width: 4000, height: 3000 }, () => 1);
  wx.compressImage = options => options.fail({ errMsg: 'decode fail' });
  await assert.rejects(upload(), /图片自动压缩失败/);
  assert.equal(uploaded.length, 0);
  // Simulate one lost upload receipt while another image in the same group succeeds.
  setup(500 * 1024, { width: 640, height: 480 }, () => 0);
  const inputs = ['wxfile://first', 'wxfile://second', 'wxfile://third'];
  inputs.forEach(input => { sizes[input] = 500 * 1024; });
  let active = 0, peak = 0, promptCount = 0;
  const batches = [];
  wx.showModal = options => { promptCount++; options.success({ confirm: true }); };
  wx.cloud.uploadFile = async options => {
    uploaded.push(options);
    const attempt = uploaded.filter(upload => upload.filePath === options.filePath).length;
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, options.filePath === inputs[0] ? 8 : 1));
    active--;
    if (options.filePath === inputs[0] && attempt === 1) throw new Error('network');
    return { fileID: options.filePath.replace('wxfile:', 'cloud:') };
  };
  await service.persistImages(inputs, 'photos', images => batches.push(...images));
  assert.equal(peak, 2);
  assert.equal(promptCount, 1);
  assert.deepEqual(batches, ['cloud://first', 'cloud://second', 'cloud://third']);
  const retries = uploaded.filter(upload => upload.filePath === inputs[0]);
  assert.equal(retries.length, 2);
  assert.equal(retries[0].cloudPath, retries[1].cloudPath);
  assert.equal(uploaded.filter(upload => upload.filePath === inputs[1]).length, 1);
  console.log('original picker/fallback, unchanged small photos, full-resolution JPEG quality search, PNG clarity floor and upload errors passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
