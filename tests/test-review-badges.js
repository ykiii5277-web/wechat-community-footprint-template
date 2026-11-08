const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
function load(file, dependencies, extra = {}) {
  const module = { exports: {} }; let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module, exports: module.exports, Page(value) { page = value; },
    require(name) { assert(name in dependencies, name); return dependencies[name]; }, ...extra
  });
  if (!page) return module.exports;
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = values => Object.assign(page.data, values);
  return page;
}
async function main() {
  let requests = [], status = { isAdmin: true, pendingWorkCount: 4 }, resolveStatus, updates = [], navigation;
  const service = load('utils/cloud-service.js', { '../config/app-config': {} }, { wx: { cloud: {
    init() {}, callFunction(options) { return new Promise(resolve => requests.push({ options, resolve })); }
  } } });
  const all = service.getNoticeBadges(), friends = service.getFriendBadge();
  assert.equal(requests.length, 1, 'friend and reviewer badges share the same request');
  requests[0].resolve({ result: { count: 2, reviewCount: 4 } });
  assert.deepEqual(JSON.parse(JSON.stringify(await all)), { count: 2, reviewCount: 4 });assert.equal(await friends, 2);
  const old = service.getNoticeBadges();requests[1].resolve({ result: { count: 1 } });
  assert.equal((await old).reviewCount, null, 'old backend response cannot falsely clear the pending queue');
  const retry = service.getNoticeBadges();requests[2].resolve({ result: { error: 'CLOUD_CALL_FAILED' } });
  assert.equal(await retry, null);

  const page = load('pages/profile/index.js', {
    '../../utils/data': { getProfile: () => ({ stats: {} }), refreshCurrentProfileAsync: async () => null },
    '../../utils/nav': { go: value => { navigation = value; } },
    '../../utils/cloud-service': {
      getInventory: async () => null, getMailbox: async () => ({ mails: [] }), getTaskStatus: async () => null,
      getAdminStatus: () => resolveStatus === 'wait' ? new Promise(resolve => { resolveStatus = resolve; }) : Promise.resolve(status)
    },
    '../../utils/virtual-items': {}, '../../utils/feature-guide': { syncPage() {} }
  }, { getApp: () => ({ maybeOpenFeatureGuide() {} }) });
  const originalSetData = page.setData;
  page.setData = values => { updates.push(values); originalSetData(values); };
  await page.onShow();assert(page.data.isAdmin);assert.equal(page.data.pendingWorkCount, 4);
  const count = updates.length;page.onReviewBadgeChanged(4);assert.equal(updates.length, count, 'unchanged badge avoids rerender');
  page.onReviewBadgeChanged(0);assert.equal(page.data.pendingWorkCount, 0);
  page.open({ currentTarget: { dataset: { target: 'work-review' } } });
  assert.equal(navigation, '/pages/profile/work-review');
  status = { isAdmin: false, pendingWorkCount: 0 };await page.onShow();assert(!page.data.isAdmin);
  resolveStatus = 'wait';const pending = page.onShow();page.onHide();resolveStatus({ isAdmin: true, pendingWorkCount: 8 });await pending;
  assert(!page.data.isAdmin);assert.equal(page.data.pendingWorkCount, 0, 'hidden profile ignores stale admin responses');
  const markup = fs.readFileSync(path.join(root, 'pages/profile/index.wxml'), 'utf8');
  assert(/wx:if="\{\{isAdmin\}\}"[^>]*data-target="work-review"/.test(markup));
  console.log('PASS shared notification requests, old backend and network recovery, reviewer entry navigation, count clearing and stale profile protection');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
