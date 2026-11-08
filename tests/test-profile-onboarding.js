const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));
async function backendTests() {
  let saved = null, writes = 0, failCheck = false, now = 1, beforeCheck;
  const reference = {
    async get() { if (!saved) throw new Error('DATABASE_DOCUMENT_NOT_EXIST'); return { data: Object.assign({ _id: 'owner' }, copy(saved)) }; },
    async set({ data }) { writes++; saved = copy(data); },
    async update({ data }) { writes++; saved = Object.assign({}, saved, copy(data)); }
  };
  const module = { exports: {} };
  const db = { command: {}, collection: () => ({ doc: () => reference }), runTransaction: async fn => fn(db) };
  const sdk = { init() {}, getWXContext: () => ({ OPENID: 'owner' }), database: () => db };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/hui-api/index.js'), 'utf8') + `
    createUid = async () => '1234567'; syncUidReferences = async () => {};
    checkSubmission = async () => { if (globalThis.failContent()) throw new Error('CONTENT_UNSAFE'); };
    module.exports = { ownProfile, bootstrapProfile, ownPublicProfile, main: exports.main };
  `, {
    module, exports: module.exports, process, Buffer, failContent: () => { if (beforeCheck) { const hook = beforeCheck; beforeCheck = null; hook(); } return failCheck; },
    require(name) { return name === 'wx-server-sdk' ? sdk : require(name.startsWith('.') ? path.join(root, 'cloudfunctions/hui-api', name) : name); }
  });
  const api = module.exports;
  const created = await api.bootstrapProfile('owner', { profileCompleted: true });
  assert.equal(created.isNewUser, true); assert.equal(created.profile.profileCompleted, false, 'client cannot forge initial completion');
  const returned = await api.bootstrapProfile('owner', {}); assert.equal(returned.isNewUser, false); assert.equal(returned.profile.profileCompleted, false, 'unfinished accounts stay gated across launches/devices');
  await assert.rejects(api.ownProfile('owner', { name: '新人', bio: '   ', profileCompleted: true }, true), /PROFILE_INCOMPLETE/);
  assert.equal(saved.profileCompleted, false);
  const blocked = await api.main({ action: 'content.publicList', payload: {} });
  assert.equal(blocked.error, 'PROFILE_REQUIRED', 'business API must enforce onboarding independently of navigation');
  failCheck = true;
  await assert.rejects(api.ownProfile('owner', { name: '新人', bio: '我的故事' }, true), /CONTENT_UNSAFE/);
  assert.equal(saved.profileCompleted, false, 'moderation failure cannot unlock account');
  failCheck = false;
  const completed = await api.ownProfile('owner', { name: '新人', bio: '我的故事' }, true);
  assert.equal(completed.profileCompleted, true); assert.equal(saved.profileCompleted, true); assert(!('_id' in saved));
  assert.equal(api.ownPublicProfile(completed, 'owner').profileCompleted, true);
  assert.equal((await api.bootstrapProfile('owner', {})).profile.profileCompleted, true);
  saved = { uid: '1234567', name: '老用户', bio: '', updatedAt: now++ };
  assert.equal(api.ownPublicProfile(saved, 'owner').profileCompleted, true, 'legacy users keep access');
  assert.equal(api.ownPublicProfile(saved, 'owner').profileOnboardingVersion, 0);
  await api.ownProfile('owner', { name: '老用户', bio: '' }, true);
  assert.equal(saved.profileCompleted, true, 'normal legacy editing keeps its existing optional fields');
  saved.friendManagement = { sort: 'name' }; saved.contentRevision = 7;
  beforeCheck = () => { saved.friendManagement = { sort: 'affection', groups: [{ id: 'new', name: '刚建的分组' }] }; saved.contentRevision = 8; };
  await api.ownProfile('owner', { name: '新昵称', bio: '新简介' }, true);
  assert.equal(saved.friendManagement.sort, 'affection'); assert.equal(saved.contentRevision, 8, 'profile editing cannot overwrite concurrent friend settings or content revisions');
  console.log('server completion flags, cross-device persistence, required fields, moderation failure, business gate and legacy compatibility passed');
}
async function editorTests() {
  let page, profile = { uid: '1234567', name: '未命名用户', bio: '', stats: {}, profileCompleted: false }, failure = false, pending = false, obsolete = false, saves = 0, completions = 0, guides = 0, navigations = [], toasts = [], depth = 1;
  const app = {
    globalData: { profileRequired: true, bootstrapPromise: Promise.resolve({ profile, isNewUser: true }) },
    ensureProfileOnboarding() { return this.globalData.profileRequired; },
    completeProfileOnboarding(value) { if (value.profileCompleted !== true) throw new Error('云端尚未确认'); completions++; this.globalData.profileRequired = false; },
    maybeOpenFeatureGuide() { guides++; }, async syncInBackground() {}
  };
  const data = {
    getProfile: () => profile, getSyncDraft: () => null, stageDraft() {},
    async saveProfileAsync(input) { saves++; if (failure) throw new Error('offline'); return pending ? { pending: true } : Object.assign({}, input, { uid: profile.uid }, obsolete ? {} : { profileCompleted: true }); }
  };
  const wx = {
    showToast: value => toasts.push(value.title), showLoading() {}, hideLoading() {},
    switchTab(options) { navigations.push(options.url); if (options.success) options.success(); },
    navigateBack() { navigations.push('back'); }, reLaunch(options) { navigations.push(options.url); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/profile/intro-editor.js'), 'utf8'), {
    Page(value) { page = value; }, wx, getApp: () => app, getCurrentPages: () => Array.from({ length: depth }, () => ({ route: 'pages/profile/intro-editor' })), setTimeout: fn => fn(),
    require(name) {
      if (name.endsWith('/data')) return data;
      if (name.endsWith('/actions')) return { ready: async () => {} };
      if (name.endsWith('/cloud-service')) return { isRemoteFile: () => true, showUploadError() {} };
      if (name.endsWith('/nav')) return { decode: value => value };
      return {};
    }
  });
  page.data = copy(page.data); page.setData = changes => Object.assign(page.data, changes);
  await page.onLoad(); assert.equal(page.data.mandatory, true); assert.equal(navigations.length, 0);
  assert.equal(page.data.name, '', 'cloud display fallback must not fill the required nickname');
  await page.save(); assert.equal(saves, 0); assert.equal(toasts.at(-1), '请填写昵称');
  page.data.name = '新人'; await page.save(); assert.equal(saves, 0); assert.equal(toasts.at(-1), '请填写个人简介');
  page.data.bio = '我的故事'; failure = true; await page.save(); assert.equal(completions, 0); assert.equal(page.data.mandatory, true);
  failure = false; pending = true; await page.save(); assert.equal(completions, 0); assert.equal(navigations.length, 0);
  pending = false; obsolete = true; await page.save(); assert.equal(completions, 0); assert.equal(navigations.length, 0, 'old server without completion receipt cannot unlock');
  obsolete = false; await page.save(); assert.equal(completions, 1); assert.equal(guides, 1); assert.equal(navigations.at(-1), '/pages/fun/index'); assert.equal(page.data.saving, false);
  profile = { uid: '1234567', name: '已有用户', bio: '', stats: {}, profileCompleted: true };
  app.globalData.bootstrapPromise = Promise.resolve({ profile, isNewUser: false }); navigations = []; await page.onLoad();
  assert.equal(navigations.at(-1), '/pages/fun/index', 'existing users leave entry page automatically');
  depth = 2; navigations = []; await page.onLoad(); assert.equal(page.data.mandatory, false);
  assert.equal(page.data.name, '已有用户');
  await page.save(); assert.equal(navigations.at(-1), 'back', 'normal editing returns to its original page');
  app.globalData.bootstrapPromise = Promise.resolve({ error: 'offline' }); await page.loadProfile();
  assert(page.data.loadError); const count = saves; await page.save(); assert.equal(saves, count);
  const markup = fs.readFileSync(path.join(root, 'pages/profile/intro-editor.wxml'), 'utf8');
  assert(markup.includes('show-back="{{!mandatory && !loadingProfile}}"'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).pages[0], 'pages/profile/intro-editor');
  console.log('mandatory editor validation, retry/pending/old-server locks, guide after confirmed save, launch routing and normal editing passed');
}
backendTests().then(editorTests).catch(error => { console.error(error); process.exitCode = 1; });
