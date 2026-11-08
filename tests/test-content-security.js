const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const api = {}, logs = [];
let textResponse = { errCode: 0, result: { suggest: 'pass' } };
let imageResponse = { errCode: 0 };
let textFailure, imageFailure, downloaded = Buffer.from('image');
const sdk = {
  init() {}, database: () => ({ command: {} }),
  downloadFile: async () => ({ fileContent: downloaded }),
  openapi: { security: {
    msgSecCheck: async () => { if (textFailure) throw textFailure; return textResponse; },
    imgSecCheck: async () => { if (imageFailure) throw imageFailure; return imageResponse; }
  } }
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/hui-api/index.js'), 'utf8') + '\nObject.assign(exports, {checkTextSafety, checkImageSafety, errorMessage, securityError});', {
  exports: api, Buffer, process,
  console: { warn: (...args) => logs.push(args) },
  require(name) { return name === 'wx-server-sdk' ? sdk : require(name.startsWith('.') ? path.join(root, 'cloudfunctions/hui-api', name) : name); }
});
async function failure(task, code, type) {
  await assert.rejects(task, error => {
    assert.equal(error.message, code);
    if (type) assert.equal(error.securityType, type);
    return true;
  });
}
async function run() {
  await api.checkTextSafety('private-openid', ['private-text']);
  await api.checkImageSafety(['cloud://private-photo.png']);
  textResponse = { errCode: 0, result: { suggest: 'review' }, traceId: 'test-trace' };
  await failure(api.checkTextSafety('private-openid', ['private-text']), 'CONTENT_REVIEW_REQUIRED', 'text');
  textResponse = { errCode: 0, result: { suggest: 'risky' } };
  await failure(api.checkTextSafety('private-openid', ['private-text']), 'CONTENT_UNSAFE', 'text');
  textResponse = { errCode: 87014 };
  await failure(api.checkTextSafety('private-openid', ['private-text']), 'CONTENT_UNSAFE', 'text');
  textFailure = { errCode: 48001, errMsg: 'API permission review required' };
  await failure(api.checkTextSafety('private-openid', ['private-text']), 'CONTENT_CHECK_UNAVAILABLE', 'text');
  assert.equal(api.securityError(new Error('request 870140 timeout')).message, 'CONTENT_CHECK_UNAVAILABLE');
  imageFailure = { errCode: 87014, errMsg: 'imgSecCheck:fail' };
  await failure(api.checkImageSafety(['cloud://private-photo.png']), 'CONTENT_UNSAFE', 'image');
  imageFailure = null;
  imageResponse = { errcode: 87014 };
  await failure(api.checkImageSafety(['cloud://private-photo.png']), 'CONTENT_UNSAFE', 'image');
  imageResponse = { errCode: 45009 };
  await failure(api.checkImageSafety(['cloud://private-photo.png']), 'CONTENT_CHECK_UNAVAILABLE', 'image');
  imageResponse = null;
  await failure(api.checkImageSafety(['cloud://private-photo.png']), 'CONTENT_CHECK_UNAVAILABLE', 'image');
  imageResponse = {};
  await failure(api.checkImageSafety(['cloud://private-photo.png']), 'CONTENT_CHECK_UNAVAILABLE', 'image');
  downloaded = Buffer.alloc(1024 * 1024 + 1);
  await failure(api.checkImageSafety(['cloud://private-photo.png']), 'IMAGE_SECURITY_SIZE_LIMIT', 'image');
  for (const type of ['text', 'image']) {
    const error = Object.assign(new Error('CONTENT_UNSAFE'), { securityType: type });
    assert(api.errorMessage(error).message.includes(type === 'image' ? '图片' : '文字'));
    error.message = 'CONTENT_REVIEW_REQUIRED';
    assert(api.errorMessage(error).message.includes('复核'));
    error.message = 'CONTENT_CHECK_UNAVAILABLE';
    assert(api.errorMessage(error).message.includes('暂时不可用'));
  }
  const output = JSON.stringify(logs);
  assert(!/private-openid|private-text|private-photo/.test(output), 'diagnostics must not log private content');
  assert(output.includes('test-trace'), 'keep the platform trace ID for diagnosis');
  console.log('safety pass/risk/review, permission/limit failures, missing results, image size and private diagnostics passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
