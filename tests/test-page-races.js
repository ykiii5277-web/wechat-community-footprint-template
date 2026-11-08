const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cloud = require('../utils/cloud-service');

async function run() {
  assert.equal(cloud.isRemoteFile('http://tmp/local.jpg'), false);
  assert.equal(cloud.isRemoteFile('wxfile://photo'), false);
  assert.equal(cloud.isRemoteFile('cloud://env/file.jpg'), true);
  assert.equal(cloud.isRemoteFile('https://example.com/file.jpg'), true);
  const batches = [];
  global.wx = { cloud: { init() {}, callFunction() {}, getTempFileURL: async ({ fileList }) => { assert(fileList.length <= 50); batches.push(fileList); return { fileList: fileList.map(id => ({ fileID: id, tempFileURL: `https://media.test/${id.slice(8)}` })) }; } } };
  const ids = Array.from({ length: 125 }, (_, i) => `cloud://${i}`);
  const urls = await cloud.resolveCloudFiles(ids);
  assert.equal(batches.length, 3); assert.equal(urls.length, 125); assert(urls.every(url => url.startsWith('https://media.test/')));

  let page;
  const requests = [];
  let yearRequests = 0;
  const data = { getHotRankingYearsAsync: async () => { yearRequests++; return [2026]; }, camps: () => [], shouldShowProfileGuide: () => false, getHotRankingPageAsync: options => new Promise(resolve => requests.push({ options, resolve })) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/fun/index.js'), 'utf8'), {
    Page: value => { page = value; }, require: name => name.includes('/data') ? data : {}, wx: { showToast() {} }, console
  });
  page.data = JSON.parse(JSON.stringify(page.data)); page.setData = values => Object.assign(page.data, values);
  page.data.keyword = 'first';
  const first = page.refresh();
  while (!requests.length) await new Promise(resolve => setImmediate(resolve));
  page.data.keyword = 'second';
  const second = page.refresh();
  while (requests.length < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[1].options.includeYears, true);
  requests[1].resolve({ items: [{ id: 'second-result' }], years: [2026], page: 1, total: 1, hasNext: false }); await second;
  requests[0].resolve({ items: [{ id: 'first-result' }], page: 1, total: 1, hasNext: false }); await first;
  assert.equal(page.data.items[0].id, 'second-result', 'late search response cannot replace current search');
  assert.equal(yearRequests, 0, 'combined responses and superseded requests must not fetch years separately');
  let component;
  global.Component = options => { component = options; };
  global.wx.getWindowInfo = () => ({ statusBarHeight: 47 });
  global.wx.getMenuButtonBoundingClientRect = () => ({ top: 51, height: 32 });
  require('../components/page-nav/index');
  const instance = { data: {}, setData(values) { Object.assign(this.data, values); } };
  component.lifetimes.attached.call(instance);
  assert.equal(instance.data.statusBarHeight, 47); assert.equal(instance.data.navHeight, 40, 'notched phones must use measured status-bar space');
  let tabDefinition;
  const activeTimers = new Set(), badgeReplies = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../custom-tab-bar/index.js'), 'utf8'), {
    Component: value => { tabDefinition = value; },
    require: () => ({ getNoticeBadges: () => new Promise(resolve => badgeReplies.push(resolve)) }),
    setInterval: callback => { activeTimers.add(callback); return callback; },
    clearInterval: callback => activeTimers.delete(callback)
  });
  const tab = Object.assign({ data: { badge: 0, reviewBadge: 0 }, setData(values) { Object.assign(this.data, values); } }, tabDefinition.methods);
  tabDefinition.lifetimes.attached.call(tab);
  tabDefinition.pageLifetimes.show.call(tab);
  assert.equal(activeTimers.size, 1);
  assert.equal(badgeReplies.length, 1);
  tabDefinition.pageLifetimes.hide.call(tab);
  assert.equal(activeTimers.size, 0);
  badgeReplies[0]({count:9,reviewCount:7});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tab.data.badge, 0, 'hidden tab must ignore late badge replies');
  assert.equal(tab.data.reviewBadge, 0, 'hidden tab must ignore late reviewer badge replies');
  tabDefinition.pageLifetimes.show.call(tab);
  badgeReplies[1]({count:2,reviewCount:3});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tab.data.badge, 2);
  assert.equal(tab.data.reviewBadge, 3);
  const cleared=tab.refreshBadge();badgeReplies[2]({count:0,reviewCount:0});await cleared;
  assert.equal(tab.data.reviewBadge,0,'finished review queue clears the profile badge');
  tabDefinition.lifetimes.detached.call(tab);
  assert.equal(activeTimers.size, 0);
  console.log('temporary-file classification, 125-file URL batching and latest-search response passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
