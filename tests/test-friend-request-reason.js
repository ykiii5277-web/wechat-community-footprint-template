const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));
function loadPage(file, data, wx, extra = {}) {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { Page: value => { page = value; }, wx, setTimeout: fn => fn(), clearTimeout() {}, ...extra,
    require(name) { if (name.endsWith('/data')) return data; return require(name.startsWith('.') ? path.resolve(root, path.dirname(file), name) : name); } });
  page.data = copy(page.data); page.setData = changes => Object.assign(page.data, changes); return page;
}
async function frontendTests() {
  const sent = [], messages = []; let resolve, backs = 0;
  const editor = loadPage('pages/friends/editor.js', { createFriendRequestAsync: body => { sent.push(body); return new Promise(done => { resolve = done; }); } }, { showToast: value => messages.push(value.title), navigateBack: () => backs++ });
  editor.onLoad({}); editor.data.uid = '1234567';
  for (const reason of ['', ' \n\t ', '\u200B\u200D']) { editor.data.reason = reason; await editor.save(); }
  assert.equal(sent.length, 0, 'blank and invisible explanations must not be submitted');
  editor.data.reason = '  我是营地同组伙伴，想和你联系  ';
  const first = editor.save(); await editor.save(); assert.equal(sent.length, 1, 'double tap must not send repeated requests'); assert.equal(sent[0].reason, '我是营地同组伙伴，想和你联系'); assert.equal(editor.data.submitting, true);
  resolve({ error: '网络失败' }); await first; assert.equal(editor.data.submitting, false); assert.equal(backs, 0); assert(editor.data.reason.includes('营地同组伙伴'));
  const second = editor.save(); editor.onUnload(); resolve({ request: { id: 'ok' } }); await second; assert.equal(backs, 0, 'a late success cannot pop an unrelated page after leaving the editor');
  let modal;
  const friends = loadPage('pages/friends/index.js', {}, { showModal: value => { modal = value; }, showActionSheet() { throw new Error('default group must not offer delete'); } });
  friends.data.groups = [{ id: 'camp-friends', name: '营地好友', isDefault: true }]; friends.updateManagement = async body => { sent.push(body); return true; };
  friends.groupMenu({ currentTarget: { dataset: { id: 'camp-friends' } } }); assert.equal(modal.editable, true);
  await modal.success({ confirm: true, content: '新朋友' }); modal.complete(); assert.equal(sent.at(-1).operation, 'rename'); assert.equal(sent.at(-1).groupId, 'camp-friends');
}
async function backendTests() {
  let reads = 0, safety = [], inserted;
  const sdk = { init() {}, database: () => ({ command: {}, collection: () => ({ where: () => ({ orderBy() { return this; }, skip() { return this; }, limit() { return this; }, get: async () => ({ data: [] }) }), add: async ({ data }) => { inserted = data; return { _id: 'request' }; } }) }) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/hui-api/index.js'), 'utf8') + `
    ownProfile = async () => { globalThis.recordRead(); return { uid: '1111111' }; };
    profileByUid = async () => ({_id: 'target', uid: '2222222'}); friendship = async () => null;
    checkTextSafety = async (openid, values) => globalThis.recordSafety(values);
    module.exports = {requestFriend, errorMessage};
  `, { module, exports: module.exports, process, Buffer, recordRead: () => reads++, recordSafety: value => { safety = value; },
    require(name) { return name === 'wx-server-sdk' ? sdk : require(name.startsWith('.') ? path.join(root, 'cloudfunctions/hui-api', name) : name); } });
  for (const reason of ['', '  \n', '\u200B']) await assert.rejects(module.exports.requestFriend('owner', { toUid: '2222222', reason }), /FRIEND_REQUEST_REASON_REQUIRED/);
  assert.equal(reads, 0); assert.equal(inserted, undefined);
  await module.exports.requestFriend('owner', { toUid: '2222222', reason: '  你好  ' });
  assert.equal(inserted.reason, '你好'); assert.equal(safety[0], inserted.reason);
  assert(module.exports.errorMessage(new Error('FRIEND_REQUEST_REASON_REQUIRED')).message.includes('申请内容'));
}
frontendTests().then(backendTests).then(() => console.log('required request explanations, whitespace/invisible input, duplicate submission, retained input, late response safety and default-group rename UI passed')).catch(error => { console.error(error); process.exitCode = 1; });
