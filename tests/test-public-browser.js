const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const publicBrowser = require('../utils/public-browser');
const root = path.resolve(__dirname, '..');
const item = (id, kind = 'growth', rank = 1) => ({ id, kind, rank, recordId: `r-${kind}-${id}`, ownerUid: '1234567', status: 'published', visibility: 'public', campId: 'rural', title: id, likes: 2, images: [] });
const first = item('first'), hidden = item('hidden', 'photo', 2), second = item('second', 'work', 3), last = item('last', 'photo', 4);
const tick = () => new Promise(resolve => setImmediate(resolve));
const toasts = [], navigations = [], reports = [], commentRequests = [];
let backCount = 0, pendingLike, delayedComments, delayComments = false, failSecond = false, failFirst = false, jumpModal, dialogs = 0;
const wx = {
  showToast: options => toasts.push(options.title), getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
  navigateBack() { backCount++; }, navigateTo: options => navigations.push(options), pageScrollTo() {},
  showModal(options) { jumpModal = options; dialogs++; }
};
function loadPage(file, dependencies) {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    Page(value) { page = value; }, wx, console, setTimeout, clearTimeout,
    require(name) {
      if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
      return require(name.startsWith('.') ? path.resolve(root, path.dirname(file), name) : name);
    }
  });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = changes => Object.entries(changes).forEach(([key, value]) => {
    const parts = key.split('.'); let object = page.data;
    parts.slice(0, -1).forEach(part => { object = object[part]; }); object[parts[parts.length - 1]] = value;
  });
  return page;
}
const cloud = {
  async getContent(kind, id) {
    if (id === 'first' && failFirst) return { error: 'FORBIDDEN' };
    if (id === 'hidden') return { error: 'FORBIDDEN' };
    if (id === 'second' && failSecond) return { error: 'CLOUD_CALL_FAILED', message: 'network error' };
    return { item: Object.assign({}, [first, hidden, second, last].find(value => value.id === id), { canEdit: false }) };
  },
  recordView: async () => ({ views: 1 }),
  getComments(kind, id) {
    if (delayComments && id === 'first') return new Promise(resolve => { delayedComments = resolve; });
    return Promise.resolve({ comments: [{ id: `comment-${id}` }] });
  },
  resolveCloudFiles: async paths => paths,
  toggleLike: () => new Promise(resolve => { pendingLike = resolve; }),
  saveComment: body => new Promise(resolve => commentRequests.push({ body, resolve })),
  createReport: async body => { reports.push(body); return {}; }
};
const data = { getProfile: () => ({ uid: 'me' }), getCampName: () => '营地', visibilityLabel: () => '公开', newContentId: () => `comment-${commentRequests.length}` };
function detail(session) {
  const page = loadPage('pages/community/detail.js', {
    '../../utils/cloud-service': cloud, '../../utils/data': data,
    '../../utils/comment-threads': { buildCommentThreads: list => list }, '../../utils/work-media': { isVideo: () => false }
  });
  page.onLoad({ kind: first.kind, id: first.id, ownerUid: first.ownerUid, recordId: first.recordId, browseSession: session });
  return page;
}
function session() { return publicBrowser.create({ items: [first, hidden, second, last], index: 0, page: 1, total: 4, hasNext: false, loadPage() { throw new Error('unexpected load'); } }); }
async function run() {
  const options = { range: 'month', year: 2026, month: 11, campId: 'rural', kind: '', keyword: '合照' };
  const calls = [];
  const id = publicBrowser.create({ items: [first, hidden], index: 1, page: 1, pageSize: 2, total: 4, hasNext: true, options, async loadPage(query) { calls.push(query); return { items: [hidden, second, second, last], total: 4, hasNext: false }; } });
  options.keyword = 'changed';
  const browser = publicBrowser.get(id);
  let target = await browser.neighbor(1);
  assert.equal(target.item.id, 'second', 'deduplicate across pages and within a fetched page');
  assert.equal(calls[0].keyword, '合照', 'keep the filters used for the displayed ranking');
  assert.equal(calls[0].range, 'month'); assert.equal(calls[0].page, 2);
  browser.commit(target.cursor);
  target = await browser.neighbor(-1); assert.equal(target.item.id, 'hidden');
  browser.markUnavailable(hidden);
  target = await browser.neighbor(-1); assert.equal(target.item.id, 'first');
  target = await browser.neighbor(1); browser.commit(target.cursor);
  assert.equal(browser.current().id, 'last'); assert.equal(browser.state().hasNext, false);
  assert.equal(calls.length, 1, 'previously loaded pages keep their order without refetching');
  publicBrowser.discard(id); assert.equal(publicBrowser.get(id), undefined);

  const emptyId = publicBrowser.create({ items: [first], index: 0, total: 1, hasNext: true, loadPage: async () => ({ items: [], total: 1, hasNext: false }) });
  const empty = publicBrowser.get(emptyId);
  assert.equal(await empty.neighbor(1), null); assert.equal(empty.state().hasNext, false);
  publicBrowser.discard(emptyId);

  const previousId = publicBrowser.create({ items: [second, last], index: 0, page: 2, pageSize: 2, total: 4, hasNext: false, options: { keyword: '同一筛选' }, loadPage: async query => { assert.equal(query.page, 1); assert.equal(query.keyword, '同一筛选'); return { items: [first, hidden], total: 4, hasNext: true }; } });
  assert.equal((await publicBrowser.get(previousId).neighbor(-1)).item.id, 'hidden');
  publicBrowser.discard(previousId);
  const listErrorId = publicBrowser.create({ items: [first], index: 0, total: 2, hasNext: true, loadPage: async () => ({ error: 'offline' }) });
  await assert.rejects(publicBrowser.get(listErrorId).neighbor(1), /offline/);
  assert.equal(publicBrowser.get(listErrorId).current().id, 'first');
  publicBrowser.discard(listErrorId);

  const distantCalls = [];
  const indexedItem = number => item(`entry-${number}`, 'growth', number);
  const distantId = publicBrowser.create({ items: Array.from({ length: 20 }, (_, i) => indexedItem(i + 1)), index: 0, page: 1, pageSize: 20, total: 1000, hasNext: true, options: { keyword: '保留筛选', range: 'year', year: 2026 }, async loadPage(query) {
    distantCalls.push(query); const start = (query.page - 1) * 20;
    return { items: Array.from({ length: 20 }, (_, i) => indexedItem(start + i + 1)), total: 1000, hasNext: query.page < 50 };
  } });
  const distant = publicBrowser.get(distantId);
  const at500 = await distant.seek(500); assert.equal(at500.item.id, 'entry-500'); assert.equal(distantCalls.length, 1); assert.equal(distantCalls[0].page, 25); assert.equal(distantCalls[0].keyword, '保留筛选');
  assert.equal(distant.current().id, 'entry-1', 'finding a target must not commit before permission confirmation');
  distant.commit(at500.cursor); assert.equal(distant.state().position, 500);
  const at1000 = await distant.seek(1000); assert.equal(at1000.item.id, 'entry-1000'); assert.equal(distantCalls.length, 2); assert.equal(distantCalls[1].page, 50);
  assert.equal((await distant.seek(1)).item.id, 'entry-1'); assert.equal(distantCalls.length, 2, 'jumping to cached entries does not reload intermediate pages');
  await assert.rejects(distant.seek(1001), /整数序号/); await assert.rejects(distant.seek(1.2), /整数序号/);
  publicBrowser.discard(distantId);
  const shrinkingId = publicBrowser.create({ items: [first], index: 0, pageSize: 2, total: 100, hasNext: true, loadPage: async () => ({ items: [], total: 1, hasNext: false }) });
  assert.equal(await publicBrowser.get(shrinkingId).seek(100), null); assert.equal(publicBrowser.get(shrinkingId).state().total, 1); publicBrowser.discard(shrinkingId);

  const token = session(), page = detail(token); await tick();
  assert.equal(page.data.item.id, 'first'); assert.equal(page.data.browsePrevious, false);
  page.data.commentBody = '未发出的第一条评论';
  await page.nextContent(); await tick();
  assert.equal(page.id, 'second'); assert.equal(page.kind, 'work');
  assert.equal(page.data.comments[0].id, 'comment-second');
  assert.equal(navigations.length, 0, 'switch within the same detail page rather than growing the navigation stack');
  await page.previousContent(); await tick();
  assert.equal(page.id, 'first'); assert.equal(page.data.commentBody, '未发出的第一条评论');

  const likeRequest = page.favorite();
  delayComments = true; const commentsRequest = page.refreshComments(); delayComments = false;
  await page.nextContent(); await tick();
  pendingLike({ favorite: true, likes: 999 }); await likeRequest;
  delayedComments({ comments: [{ id: 'stale-comment' }] }); await commentsRequest;
  assert.equal(page.data.item.id, 'second'); assert.equal(page.data.item.likes, 2);
  assert.equal(page.data.comments[0].id, 'comment-second');
  page.chooseReport = callback => callback('其他问题'); page.reportContent(); await tick();
  assert.equal(reports[0].id, 'second'); assert.equal(reports[0].kind, 'work');

  await page.previousContent(); await tick();
  page.data.commentBody = 'first sending'; const sendingFirst = page.submitComment();
  await page.nextContent(); await tick();
  page.data.commentBody = 'second sending'; const sendingSecond = page.submitComment();
  commentRequests[0].resolve({ comment: { id: 'done-first' } }); await sendingFirst;
  assert.equal(page._sendingComment, true, 'old send completion must not unlock the new comment request');
  assert.equal(page.data.commentBody, 'second sending');
  commentRequests[1].resolve({ comment: { id: 'done-second' } }); await sendingSecond;
  assert.equal(page._sendingComment, false); assert.equal(page.data.commentBody, '');
  assert.equal(commentRequests[0].body.targetId, 'first'); assert.equal(commentRequests[1].body.targetId, 'second');

  await page.nextContent(); await tick();
  assert.equal(page.id, 'last'); assert.equal(page.data.browseNext, false);
  await page.nextContent(); assert.equal(page.id, 'last');
  page.onUnload(); assert.equal(publicBrowser.get(token), undefined);

  const retryToken = session(), retryPage = detail(retryToken); await tick();
  failSecond = true; await retryPage.nextContent();
  assert.equal(retryPage.id, 'first'); assert.equal(retryPage.data.item.id, 'first');
  assert.equal(retryPage.data.browseLoading, false);
  failSecond = false; await retryPage.nextContent(); assert.equal(retryPage.id, 'second');
  retryPage.onUnload();

  failFirst = true;
  const unavailableToken = session(), unavailablePage = detail(unavailableToken); await tick();
  assert.equal(unavailablePage.data.item, null);
  assert.equal(unavailablePage.data.publicBrowseEnabled, true, 'navigation remains available for a removed opening item');
  failFirst = false;
  await Promise.all([unavailablePage.nextContent(), unavailablePage.nextContent()]);
  assert.equal(unavailablePage.id, 'second', 'repeated taps must not skip several entries');
  unavailablePage.onUnload();

  const jumpToken = session(), jumpPage = detail(jumpToken); await tick();
  jumpPage.data.commentBody = '跳转前的草稿'; await jumpPage.lastContent(); assert.equal(jumpPage.id, 'last'); assert.equal(jumpPage.data.browsePosition, 4);
  await jumpPage.firstContent(); assert.equal(jumpPage.id, 'first'); assert.equal(jumpPage.data.commentBody, '跳转前的草稿');
  jumpPage.jumpContent(); assert.equal(jumpModal.editable, true); assert.equal(jumpModal.confirmText, '跳转');
  jumpPage.jumpContent(); assert.equal(dialogs, 1);
  await jumpModal.success({ confirm: true, content: '3' }); jumpModal.complete(); assert.equal(jumpPage.id, 'second');
  jumpPage.jumpContent(); await jumpModal.success({ confirm: false }); jumpModal.complete(); assert.equal(jumpPage.id, 'second');
  for (const input of ['', '0', '5', '1.5', 'abc']) { await jumpPage.jumpToContent(input); assert.equal(jumpPage.id, 'second'); }
  await jumpPage.jumpToContent('2'); assert.equal(jumpPage.id, 'second', 'an exact jump to withdrawn content must keep the current detail');
  failSecond = true; await jumpPage.firstContent(); assert.equal(jumpPage.id, 'first'); await jumpPage.jumpToContent('3'); assert.equal(jumpPage.id, 'first', 'failed jump must keep the current detail and draft');
  failSecond = false; await jumpPage.jumpToContent('3'); assert.equal(jumpPage.id, 'second');
  jumpPage.onUnload();

  const funData = Object.assign({}, data, {
    getHotRankingYearsAsync: async () => [2026], camps: () => [{ id: 'rural', name: '营地' }], shouldShowProfileGuide: () => false,
    getHotRankingPageAsync: async () => ({ items: [first, second], page: 1, pageSize: 20, total: 2, hasNext: false })
  });
  const fun = loadPage('pages/fun/index.js', { '../../utils/data': funData });
  fun.data.keyword = '原始搜索'; fun.data.activeRange = 'week'; fun.data.campId = 'rural';
  await fun.refresh(1);
  fun.data.keyword = '尚未完成加载的新搜索';
  fun.openItem({ currentTarget: { dataset: Object.assign({ index: 0 }, first) } });
  const openedId = new URL(`https://test${navigations[navigations.length - 1].url}`).searchParams.get('browseSession');
  assert.equal(publicBrowser.get(openedId).current().id, 'first');
  publicBrowser.discard(openedId);
  assert.equal(backCount, 0);
  console.log('filtered cross-page browsing, duplicate/unavailable skips, fixed detail navigation, draft preservation and interaction race checks passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
