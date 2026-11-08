const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
function load(file, data, wx = {}, nav = {}) {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    Page: value => { page = value; }, wx,
    require(name) {
      if (name.endsWith('/data')) return data;
      if (name.endsWith('/nav')) return nav;
      if (name.endsWith('/actions')) return { ready: async () => {} };
      return {};
    }
  });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = (change, done) => { Object.assign(page.data, change); if (done) done(); };
  return page;
}
async function run() {
  let total = 101, delayed, fail = false, requests = [], toasts = [], modal, dialogs = 0;
  const data = {
    getHotRankingYearsAsync: async () => [2026], camps: () => [{ id: 'rural', name: '营地' }], shouldShowProfileGuide: () => false,
    async getHotRankingPageAsync(options) {
      requests.push(options);
      if (delayed) await delayed;
      if (fail) throw new Error('offline');
      return { items: [{ id: String(options.page) }], page: options.page, pageSize: 20, total, hasNext: options.page * 20 < total };
    }
  };
  const page = load('pages/fun/index.js', data, { showToast: value => toasts.push(value.title), showModal: options => { modal = options; dialogs++; } });
  Object.assign(page.data, { activeRange: 'month', activeKind: 'photo', campId: 'rural', keyword: '合照', selectedYear: 2026, selectedMonth: 8 });
  await page.refresh(); assert.equal(page.data.totalPages, 6);
  await page.lastPage(); assert.equal(page.data.page, 6); assert.equal(page.data.hasNext, false);
  assert.equal(requests.at(-1).keyword, '合照'); assert.equal(requests.at(-1).kind, 'photo'); assert.equal(requests.at(-1).month, 8); assert.equal(requests.at(-1).campId, 'rural');
  await page.firstPage(); assert.equal(page.data.page, 1);
  page.jumpPage(); assert.equal(modal.editable, true); assert.equal(modal.confirmText, '跳转');
  page.jumpPage(); assert.equal(dialogs, 1, 'repeated taps must not open duplicate input dialogs');
  await modal.success({ confirm: true, content: '4' }); modal.complete(); assert.equal(page.data.page, 4);
  const cancelledAt = requests.length; page.jumpPage(); await modal.success({ confirm: false }); modal.complete(); assert.equal(requests.length, cancelledAt);
  for (const input of ['', '0', '-1', '1.2', '7', 'abc']) { const count = requests.length; await page.jumpToPage(input); assert.equal(requests.length, count); }
  assert.equal(toasts.length, 6);
  let resolve; delayed = new Promise(done => { resolve = done; });
  const moving = page.nextPage(); assert.equal(page.data.rankingLoading, true);
  await new Promise(done => setImmediate(done)); const before = requests.length;
  await page.nextPage(); await page.lastPage(); await page.firstPage(); assert.equal(requests.length, before, 'repeated taps while loading must not start another jump');
  resolve(); await moving; delayed = null;
  total = 21; await page.refresh(6); assert.equal(page.data.page, 2); assert.equal(page.data.totalPages, 2, 'deleted items should move an out-of-range page to the new last page');
  total = 0; await page.refresh(); assert.equal(page.data.page, 1); assert.equal(page.data.totalPages, 1);
  fail = true; await page.refresh(); assert.equal(page.data.rankingLoading, false);
  let companion;
  const companions = {
    visibilityOptions: () => [{ value: 'self', name: '仅自己可见' }, { value: 'friends', name: '仅好友可见' }, { value: 'public', name: '公开' }],
    getCompanion: () => companion, getSyncDraft: () => null
  };
  const editor = load('pages/companions/editor.js', companions, {}, { contextFrom: () => ({}), decode: value => value });
  for (const scope of ['public', 'friends', 'self']) {
    companion = { id: 'person', visibility: scope }; await editor.onLoad({ id: 'person' });
    assert(!editor.data.visibilityOptions.some(option => option.value === 'public'));
    assert.equal(editor.data.visibilityOptions[editor.data.visibilityIndex].value, scope === 'self' ? 'self' : 'friends');
  }
  await editor.onLoad({}); assert.equal(editor.data.visibilityOptions[editor.data.visibilityIndex].value, 'friends');
  console.log('first/last/custom page navigation, input validation, filter retention, loading locks, shrinking pages and companion scopes passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
