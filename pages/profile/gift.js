const cloud = require('../../utils/cloud-service');
const catalog = require('../../utils/virtual-items');
const privacy = require('../../utils/privacy');
const intents = require('../../utils/request-intent');

Page({
  data: { item: null, count: 0, quantity: 1, mode: 'uid', uid: '', friends: [], friendIndex: 0, message: '', images: [], sending: false, pending: false },
  async onLoad(options) {
    await require('../../utils/actions').ready();
    const item = catalog.getItem(options.item);
    if (!item) return wx.navigateBack();
    this.setData({ item });
    const [inventory, friendsResult] = await Promise.all([cloud.getInventory(), cloud.getFriends()]);
    if (!inventory || inventory.error) return wx.showToast({ title: inventory && inventory.message ? inventory.message : '背包读取失败', icon: 'none' });
    const friends = friendsResult && !friendsResult.error ? (friendsResult.friends || []).map(value => Object.assign({}, value, { displayName: value.remark || value.name || value.uid })) : [];
    this.setData({ count: Number(inventory.wallet && inventory.wallet.items && inventory.wallet.items[item.id]) || 0, friends });
    const pending = intents.read(`gift_${item.id}`);
    if (pending) this.setData({ mode: 'uid', uid: pending.payload.toUid, quantity: pending.payload.quantity, message: pending.payload.message, images: pending.payload.images || [], pending: true });
  },
  mode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  friendChange(e) { this.setData({ friendIndex: Number(e.detail.value) || 0 }); },
  quantity(e) {
    const delta = Number(e.currentTarget.dataset.delta) || 0;
    this.setData({ quantity: Math.max(1, Math.min(99, this.data.count, this.data.quantity + delta)) });
  },
  previewImage(e) { return require('../../utils/image-preview').open(this.data.images, e.currentTarget.dataset.index); },
  chooseImages() {
    const remain = 9 - this.data.images.length;
    if (remain < 1) return;
    privacy.chooseMedia({ count: remain, mediaType: ['image'], success: async result => {
      wx.showLoading({ title: '正在上传' });
      try {
        const uploaded = await Promise.all(result.tempFiles.map(file => cloud.persistFile(file.tempFilePath, 'memory-books')));
        this.setData({ images: this.data.images.concat(uploaded).slice(0, 9) });
      } catch (error) {
        cloud.showUploadError(error, '图片上传失败');
      } finally { wx.hideLoading(); }
    }, fail: privacy.showChooseImageError });
  },
  removeImage(e) { const images = this.data.images.slice(); images.splice(Number(e.currentTarget.dataset.index), 1); this.setData({ images }); },
  async send() {
    if (this.data.sending || !this.data.item) return;
    const friend = this.data.friends[this.data.friendIndex];
    const toUid = this.data.mode === 'friend' ? friend && (friend.uid || friend.id) : String(this.data.uid || '').trim();
    if (!/^\d{7}$/.test(String(toUid || ''))) return wx.showToast({ title: '请选择好友或填写 7 位 UID', icon: 'none' });
    const limit = this.data.item.id === 'memory_book' ? 5000 : this.data.item.id === 'envelope' ? 3000 : 0;
    if (limit && Array.from(this.data.message).length > limit) return wx.showToast({ title: `留言不能超过 ${limit} 字`, icon: 'none' });
    const payload = { toUid, itemId: this.data.item.id, quantity: this.data.quantity, message: limit ? this.data.message : '', images: this.data.item.id === 'memory_book' ? this.data.images : [] };
    let intent;
    try { intent = intents.begin(`gift_${this.data.item.id}`, payload); } catch (error) { return wx.showToast({ title: '无法保留提交信息，请清理缓存空间后再试', icon: 'none' }); }
    this.setData({ sending: true, pending: true });
    const result = await cloud.sendGift(Object.assign({}, payload, { requestId: intent.requestId }));
    this.setData({ sending: false });
    if (!result || result.error) return wx.showToast({ title: result && result.message ? result.message : '赠送失败', icon: 'none' });
    intents.complete(intent);
    if (result.bonusText) {
      return wx.showModal({ title: '赠送成功', content: result.bonusText, showCancel: false, confirmText: '知道了', success: () => wx.navigateBack() });
    }
    wx.showToast({ title: '赠送成功', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 450);
  }
});
