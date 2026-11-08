// 首次使用先完成昵称与简介，收到云端成功回执后才开放其他功能。
const data = require('../../utils/data');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: { mandatory: true, loadingProfile: true, loadError: '', saving: false, name: '', bio: '', tagsText: '', age: '', campCount: '', avatar: '', avatarScale: 1.3, avatarOffsetX: 0, avatarOffsetY: 0, avatarCropVisible: false, avatarCropSource: '', avatarCropScale: 1, avatarCropOffsetX: 0, avatarCropOffsetY: 0 },
  async onLoad(options = {}) {
    this._options = options;
    return this.loadProfile();
  },
  async loadProfile() {
    this.setData({ loadingProfile: true, loadError: '' });
    try {
    const app = getApp();
    const account = await app.globalData.bootstrapPromise;
    if (!account || account.error || !account.profile || !account.profile.uid) throw new Error('账号暂时无法初始化，请稍后重新连接');
    const options = this._options || {};
    const mandatory = app.globalData.profileRequired === true;
    const pages = getCurrentPages();
    if (!mandatory && pages.length === 1 && !options.draftKey) {
      this.setData({ mandatory: false, loadingProfile: false });
      return wx.switchTab({ url: '/pages/fun/index', success: () => app.maybeOpenFeatureGuide() });
    }
    const profile = data.getSyncDraft(require('../../utils/nav').decode(options.draftKey)) || data.getProfile();
    const stats = profile.stats || {};
    const name = mandatory && profile.name === '未命名用户' ? '' : profile.name || '';
    this.setData({ mandatory, loadingProfile: false, name, bio: profile.bio || '', tagsText: (profile.tags || []).join('、'), age: stats.age === '' || stats.age == null ? '' : String(stats.age), campCount: stats.campCount === '' || stats.campCount == null ? '' : String(stats.campCount), avatar: profile.avatar || '', avatarScale: Number(profile.avatarScale) || 1.3, avatarOffsetX: Number(profile.avatarOffsetX) || 0, avatarOffsetY: Number(profile.avatarOffsetY) || 0 });
    if (mandatory) app.ensureProfileOnboarding();
    } catch (error) { this.setData({ loadingProfile: false, loadError: error.message || '资料加载失败，请重新连接' }); }
  },
  onShow() { const app = getApp(); if (app.globalData.profileRequired) app.ensureProfileOnboarding(); },
  async retryProfile() { if (this.data.loadingProfile) return; this.setData({ loadingProfile: true }); await getApp().syncInBackground(); return this.loadProfile(); },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  openAvatarCrop(source, scale = 1, offsetX = 0, offsetY = 0) { this.setData({ avatarCropVisible: true, avatarCropSource: source, avatarCropScale: scale, avatarCropOffsetX: offsetX, avatarCropOffsetY: offsetY }); },
  chooseAvatar() { privacy.chooseMedia({ count: 1, mediaType: ['image'], success: result => this.openAvatarCrop(result.tempFiles[0].tempFilePath), fail: privacy.showChooseImageError }); },
  editAvatar() { if (this.data.avatar) this.openAvatarCrop(this.data.avatar, this.data.avatarScale, this.data.avatarOffsetX, this.data.avatarOffsetY); },
  avatarCropCancel() { this.setData({ avatarCropVisible: false, avatarCropSource: '' }); },
  avatarCropComplete(e) { this.setData({ avatar: e.detail.tempFilePath, avatarScale: 1, avatarOffsetX: 0, avatarOffsetY: 0, avatarCropVisible: false, avatarCropSource: '' }); },
  clearAvatar() { this.setData({ avatar: '', avatarScale: 1.3, avatarOffsetX: 0, avatarOffsetY: 0 }); },
  async save() {
    if (this._saving || this.data.loadingProfile || this.data.loadError) return;
    this._saving = true;
    this.setData({ saving: true });
    try {
    const name = this.data.name.trim();
    const bio = this.data.bio.trim();
    const age = this.data.age.trim();
    const campCount = this.data.campCount.trim();
    // 昵称需要单独校验，避免用户只填写数字资料却没有可展示的名字。
    if (!name) return wx.showToast({ title: '请填写昵称', icon: 'none' });
    if (this.data.mandatory && !bio) return wx.showToast({ title: '请填写个人简介', icon: 'none' });
    // 同行年限和经历次数允许留空；填写时只接受 0 或正整数。
    if ((age && !/^(0|[1-9]\d*)$/.test(age)) || (campCount && !/^(0|[1-9]\d*)$/.test(campCount))) return wx.showToast({ title: '同行年限和社群经历请填写 0 或正整数', icon: 'none' });
    const tags = this.data.tagsText.split(/[、，,\n]/).map(item => item.trim()).filter(Boolean).slice(0, 6);
    if (tags.some(item => Array.from(item).length > 10)) return wx.showToast({ title: '每个标签不能超过 10 个字', icon: 'none' });
    data.stageDraft('profile', { name, bio, tags, avatar: this.data.avatar, avatarScale: this.data.avatarScale, avatarOffsetX: this.data.avatarOffsetX, avatarOffsetY: this.data.avatarOffsetY, stats: { age: age === '' ? '' : Number(age), campCount: campCount === '' ? '' : Number(campCount) } });
    wx.showLoading({ title: '正在同步' });
    let avatar = this.data.avatar;
    try {
      if (avatar && !cloud.isRemoteFile(avatar)) avatar = await cloud.persistFile(avatar, 'avatars');
    } catch (error) {
      wx.hideLoading();
      return cloud.showUploadError(error, '头像上传失败', () => this.save());
    }
    if (avatar !== this.data.avatar) this.setData({ avatar });
    let result;
    try { result = await data.saveProfileAsync({ name, bio, tags, avatar, avatarScale: this.data.avatarScale, avatarOffsetX: this.data.avatarOffsetX, avatarOffsetY: this.data.avatarOffsetY, stats: { age: age === '' ? '' : Number(age), campCount: campCount === '' ? '' : Number(campCount) } }); }
    catch (error) { wx.hideLoading(); return cloud.showUploadError(error, '资料未保存到云端', () => this.save()); }
    wx.hideLoading();
    if (result && result.error) return wx.showToast({ title: result.error, icon: 'none' });
    if (this.data.mandatory) {
      try { getApp().completeProfileOnboarding(result); }
      catch (error) { return cloud.showUploadError(error, '简介尚未完成', () => this.save()); }
      this.setData({ mandatory: false });
      wx.showToast({ title: '简介已保存', icon: 'success' });
      const enter = () => getApp().maybeOpenFeatureGuide();
      return wx.switchTab({ url: '/pages/fun/index', success: enter, fail: () => wx.reLaunch({ url: '/pages/fun/index', success: enter }) });
    }
    wx.showToast({ title: result && result.pending ? '已保存，等待云端同步' : '简介已保存', icon: result && result.pending ? 'none' : 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
    } finally { this._saving = false; this.setData({ saving: false }); }
  }
});
