// 伙伴编辑页：保存姓名、评价、故事及可选的人物照片。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: { id: '', context: {}, name: '', avatar: '', avatarScale: 1.3, avatarOffsetX: 0, avatarOffsetY: 0, avatarCropVisible: false, avatarCropSource: '', avatarCropScale: 1, avatarCropOffsetX: 0, avatarCropOffsetY: 0, genders: ['男', '女', '不透露'], genderIndex: 2, genderName: '不透露', introduction: '', story: '', visibilityOptions: [], visibilityIndex: 1, visibilityName: '仅好友可见', visibilityHint: '' },
  onLoad(options) {
    const companion = options.id ? data.getCompanion(options.id) : null;
    const context = Object.assign(nav.contextFrom(options), companion ? { activityName: companion.activityName || '' } : {});
    const genders = this.data.genders;
    const storedGenderIndex = companion ? genders.indexOf(companion.gender) : -1;
    const genderIndex = storedGenderIndex >= 0 ? storedGenderIndex : 2;
    const visibilityOptions = data.visibilityOptions();
    const visibilityIndex = Math.max(0, visibilityOptions.findIndex(item => item.value === (companion ? companion.visibility : 'friends')));
    this.setData({ id: companion ? companion.id : '', context, name: companion ? companion.name : '', avatar: companion ? companion.avatar || '' : '', avatarScale: companion && Number(companion.avatarScale) ? Number(companion.avatarScale) : 1.3, avatarOffsetX: companion && Number.isFinite(Number(companion.avatarOffsetX)) ? Number(companion.avatarOffsetX) : 0, avatarOffsetY: companion && Number.isFinite(Number(companion.avatarOffsetY)) ? Number(companion.avatarOffsetY) : 0, genderIndex, genderName: genders[genderIndex], introduction: companion ? companion.introduction : '', story: companion ? companion.story : '', visibilityOptions, visibilityIndex, visibilityName: visibilityOptions[visibilityIndex].name, visibilityHint: visibilityOptions[visibilityIndex].hint });
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  genderChange(e) { const genderIndex = Number(e.detail.value); this.setData({ genderIndex, genderName: this.data.genders[genderIndex] }); },
  visibilityChange(e) { const visibilityIndex = Number(e.detail.value); const visibility = this.data.visibilityOptions[visibilityIndex]; this.setData({ visibilityIndex, visibilityName: visibility.name, visibilityHint: visibility.hint }); },
  // 头像为选填项；用户取消选择时不修改已经选好的图片。
  chooseAvatar() {
    privacy.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: result => this.openAvatarCrop(result.tempFiles[0].tempFilePath),
      fail: privacy.showChooseImageError
    });
  },
  openAvatarCrop(source, scale = 1, offsetX = 0, offsetY = 0) { this.setData({ avatarCropVisible: true, avatarCropSource: source, avatarCropScale: scale, avatarCropOffsetX: offsetX, avatarCropOffsetY: offsetY }); },
  editAvatar() { if (this.data.avatar) this.openAvatarCrop(this.data.avatar, this.data.avatarScale, this.data.avatarOffsetX, this.data.avatarOffsetY); },
  avatarCropCancel() { this.setData({ avatarCropVisible: false, avatarCropSource: '' }); },
  avatarCropComplete(e) { this.setData({ avatar: e.detail.tempFilePath, avatarScale: 1, avatarOffsetX: 0, avatarOffsetY: 0, avatarCropVisible: false, avatarCropSource: '' }); },
  clearAvatar() { this.setData({ avatar: '', avatarScale: 1.3, avatarOffsetX: 0, avatarOffsetY: 0 }); },
  async save() {
    const name = this.data.name.trim();
    if (!name) return wx.showToast({ title: '请填写伙伴姓名', icon: 'none' });
    let avatar = this.data.avatar;
    wx.showLoading({ title: '正在保存' });
    try {
      if (avatar && !cloud.isRemoteFile(avatar)) avatar = await cloud.persistFile(avatar, 'companion-avatars');
    } catch (error) {
      wx.hideLoading();
      return cloud.showUploadError(error, '头像上传失败');
    }
    data.saveCompanion({ id: this.data.id, name, avatar, avatarScale: this.data.avatarScale, avatarOffsetX: this.data.avatarOffsetX, avatarOffsetY: this.data.avatarOffsetY, gender: this.data.genders[this.data.genderIndex], introduction: this.data.introduction.trim(), story: this.data.story.trim(), campId: this.data.context.campId, stageId: this.data.context.stageId, subcampId: this.data.context.subcampId, activityName: this.data.context.activityName || '', visibility: this.data.visibilityOptions[this.data.visibilityIndex].value });
    wx.hideLoading();
    wx.showToast({ title: '伙伴已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
  },
  remove() { wx.showModal({ title: '删除这位伙伴？', content: '删除后无法恢复，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) { data.deleteCompanion(this.data.id); wx.navigateBack({ delta: 1 }); } } }); }
});
