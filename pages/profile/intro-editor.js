// 简介编辑页：仅昵称必填；成长年限、活动经历和其余资料均可留空。
const data = require('../../utils/data');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: { name: '', bio: '', tagsText: '', age: '', campCount: '', avatar: '', avatarScale: 1.3, avatarOffsetX: 0, avatarOffsetY: 0, avatarCropVisible: false, avatarCropSource: '', avatarCropScale: 1, avatarCropOffsetX: 0, avatarCropOffsetY: 0 },
  onLoad() {
    const profile = data.getProfile();
    this.setData({ name: profile.name || '', bio: profile.bio || '', tagsText: (profile.tags || []).join('、'), age: profile.stats.age === '' || profile.stats.age == null ? '' : String(profile.stats.age), campCount: profile.stats.campCount === '' || profile.stats.campCount == null ? '' : String(profile.stats.campCount), avatar: profile.avatar || '', avatarScale: Number(profile.avatarScale) || 1.3, avatarOffsetX: Number(profile.avatarOffsetX) || 0, avatarOffsetY: Number(profile.avatarOffsetY) || 0 });
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  openAvatarCrop(source, scale = 1, offsetX = 0, offsetY = 0) { this.setData({ avatarCropVisible: true, avatarCropSource: source, avatarCropScale: scale, avatarCropOffsetX: offsetX, avatarCropOffsetY: offsetY }); },
  chooseAvatar() { privacy.chooseMedia({ count: 1, mediaType: ['image'], success: result => this.openAvatarCrop(result.tempFiles[0].tempFilePath), fail: privacy.showChooseImageError }); },
  editAvatar() { if (this.data.avatar) this.openAvatarCrop(this.data.avatar, this.data.avatarScale, this.data.avatarOffsetX, this.data.avatarOffsetY); },
  avatarCropCancel() { this.setData({ avatarCropVisible: false, avatarCropSource: '' }); },
  avatarCropComplete(e) { this.setData({ avatar: e.detail.tempFilePath, avatarScale: 1, avatarOffsetX: 0, avatarOffsetY: 0, avatarCropVisible: false, avatarCropSource: '' }); },
  clearAvatar() { this.setData({ avatar: '', avatarScale: 1.3, avatarOffsetX: 0, avatarOffsetY: 0 }); },
  async save() {
    const name = this.data.name.trim();
    const bio = this.data.bio.trim();
    const age = this.data.age.trim();
    const campCount = this.data.campCount.trim();
    // 昵称需要单独校验，避免用户只填写数字资料却没有可展示的名字。
    if (!name) return wx.showToast({ title: '请填写昵称', icon: 'none' });
    // 成长年限和经历次数允许留空；填写时只接受 0 或正整数。
    if ((age && !/^(0|[1-9]\d*)$/.test(age)) || (campCount && !/^(0|[1-9]\d*)$/.test(campCount))) return wx.showToast({ title: '成长年限和活动经历请填写 0 或正整数', icon: 'none' });
    const tags = this.data.tagsText.split(/[、，,\n]/).map(item => item.trim()).filter(Boolean).slice(0, 6);
    if (tags.some(item => Array.from(item).length > 10)) return wx.showToast({ title: '每个标签不能超过 10 个字', icon: 'none' });
    wx.showLoading({ title: '正在同步' });
    let avatar = this.data.avatar;
    try {
      if (avatar && !cloud.isRemoteFile(avatar)) avatar = await cloud.persistFile(avatar, 'avatars');
    } catch (error) {
      wx.hideLoading();
      return cloud.showUploadError(error, '头像上传失败');
    }
    if (avatar !== this.data.avatar) this.setData({ avatar });
    const result = await data.saveProfileAsync({ name, bio, tags, avatar, avatarScale: this.data.avatarScale, avatarOffsetX: this.data.avatarOffsetX, avatarOffsetY: this.data.avatarOffsetY, stats: { age: age === '' ? '' : Number(age), campCount: campCount === '' ? '' : Number(campCount) } });
    wx.hideLoading();
    if (result && result.error) return wx.showToast({ title: result.error, icon: 'none' });
    wx.showToast({ title: result && result.pending ? '已保存，等待云端同步' : '简介已保存', icon: result && result.pending ? 'none' : 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
  }
});
