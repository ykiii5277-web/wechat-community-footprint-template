const assert = require('assert');
const storage = new Map();
const navigations = [];
let app;
let profilePromptDismissed = false;
let page = makePage('/pages/fun/index');

function makePage(route) {
  return { route, data: {}, setData(changes) { Object.assign(this.data, changes); } };
}
function navigate(method, options) {
  navigations.push({ method, url: options.url });
  page = makePage(options.url.split('?')[0]);
  if (options.success) options.success();
  if (options.complete) options.complete();
}

global.wx = {
  getStorageSync: key => storage.has(key) ? storage.get(key) : '',
  setStorageSync: (key, value) => storage.set(key, value),
  switchTab: options => navigate('switchTab', options),
  navigateTo: options => navigate('navigateTo', options),
  redirectTo: options => navigate('redirectTo', options)
  ,reLaunch: options => navigate('reLaunch', options)
};
global.App = options => { app = options; };
global.getCurrentPages = () => [page];

const data = require('../utils/data');
const cloud = require('../utils/cloud-service');
const guide = require('../utils/feature-guide');
cloud.initCloud = () => true;
cloud.bootstrap = async () => ({ profile: { uid: '1234567', profileCompleted: false, profileOnboardingVersion: 1 }, isNewUser: true });
cloud.getInventory = () => Promise.resolve({});
data.init = () => storage.set('hui_time_initialized_v1', true);
data.resetCloudSession = () => {};
data.bindCloudAccount = () => {};
data.getProfile = () => ({ uid: 'temporary' });
data.hasPendingProfile = () => false;
data.applyCloudProfile = () => {};
data.hydrateOwnCloudState = () => Promise.resolve(true);
data.markProfileGuideSeen = () => { profilePromptDismissed = true; };
require('../app');

async function run() {
  app.onLaunch();
  await app.globalData.bootstrapPromise;
  app.maybeOpenFeatureGuide();
  await Promise.resolve();
  assert.strictEqual(guide.isActive(), false, '首次登录应先完善简介，不提前出现功能引导');
  assert.strictEqual(page.route, '/pages/profile/intro-editor');
  assert.strictEqual(app.globalData.profileRequired, true);
  assert.throws(() => app.completeProfileOnboarding({ uid: '1234567', profileCompleted: false }), /尚未确认/);
  app.completeProfileOnboarding({ uid: '1234567', name: '新朋友', bio: '热爱记录', profileCompleted: true, profileOnboardingVersion: 1 });
  page = makePage('/pages/fun/index');
  app.maybeOpenFeatureGuide(); await Promise.resolve();
  assert.strictEqual(guide.isActive(), true);
  assert.strictEqual(page.data.guideStep.id, 'fun', '首次引导直接出现在趣闻页面');
  assert.strictEqual(profilePromptDismissed, true);
  assert.deepStrictEqual(guide.steps.map(step => step.placement),
    ['bottom', 'bottom', 'top', 'center', 'bottom', 'bottom', 'bottom', 'bottom', 'bottom']);
  for (let index = 1; index < guide.steps.length; index += 1) {
    guide.next();
    assert.strictEqual(page.route, `/${guide.steps[index].route}`);
    assert.strictEqual(page.data.guideStep.id, guide.steps[index].id);
  }
  assert(navigations.some(item => item.method === 'switchTab' && item.url === '/pages/footprints/index'));
  assert(navigations.some(item => item.method === 'navigateTo' && item.url === '/packages/camps/camp-detail?campId=rural'));
  assert(navigations.some(item => item.method === 'redirectTo' && item.url === '/pages/profile/tasks'));
  guide.previous();
  assert.strictEqual(page.route, '/pages/profile/backpack');
  guide.next();
  guide.next();
  assert.strictEqual(guide.isActive(), false);
  assert.strictEqual(page.route, '/pages/profile/index');
  assert.strictEqual(guide.shouldAutoOpen('1234567'), false);
  guide.queue('1234567');
  assert.strictEqual(guide.shouldAutoOpen('1234567'), false, '已完成账号不应重新排队');

  guide.start('7654321');
  assert.strictEqual(guide.isActive(), true);
  guide.finish();
  assert.strictEqual(guide.isActive(), false);
  assert.strictEqual(guide.shouldAutoOpen('7654321'), false, '跳过也应记为已看过');

  cloud.bootstrap = async () => ({ profile: { uid: '2222222' }, isNewUser: false });
  app.onLaunch();
  await app.globalData.bootstrapPromise;
  app.maybeOpenFeatureGuide();
  await Promise.resolve();
  assert.strictEqual(guide.isActive(), false, '已有账号不应自动进入引导');
  console.log('feature guide page-to-page behavior passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
