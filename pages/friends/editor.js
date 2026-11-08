// 好友编辑页：添加时只发起 UID 申请；成为好友后仅允许编辑“我的备注”，对方资料始终由对方本人管理。
const data = require('../../utils/data');

Page({
  data: { id: '', uid: '', requestMode: false, submitting: false, pageTitle: '添加好友', reason: '', name: '', remark: '', bio: '', tags: [] },
  onUnload() { this._unloaded = true; },
  onLoad(options) {
    if (!options.id) return this.setData({ requestMode: true, pageTitle: '添加好友' });
    this.id = options.id;
    this.loadFriend();
  },
  async loadFriend() {
    const friend = await data.getFriendAsync(this.id);
    if (!friend) return wx.navigateBack();
    this.setData({ id: friend.id || friend.uid, uid: friend.uid || friend.id, requestMode: false, pageTitle: '好友备注', name: friend.name || '', remark: friend.remark || '', bio: friend.bio || '', tags: friend.tags || [] });
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  async save() {
    if (this.data.requestMode) {
      if (this._requestSubmitting) return;
      const toUid = String(this.data.uid || '').trim(), reason = String(this.data.reason || '').trim();
      if (!/^\d{7}$/.test(toUid)) return wx.showToast({ title: '请输入对方的7位 UID', icon: 'none' });
      if (!reason.replace(/[\s\u200B-\u200D\uFEFF]/g, '')) return wx.showToast({ title: '请填写申请内容后再提交', icon: 'none' });
      this._requestSubmitting = true; this.setData({ submitting: true });
      try {
        const result = await data.createFriendRequestAsync({ toUid, reason });
        if (this._unloaded) return;
        if (!result || result.error) return wx.showToast({ title: result && (result.message || result.error) || '申请未发送成功，请重试', icon: 'none' });
        wx.showToast({ title: '好友申请已提交', icon: 'success' });
        return setTimeout(() => { if (!this._unloaded) wx.navigateBack({ delta: 1 }); }, 350);
      } catch (error) { if (!this._unloaded) wx.showToast({ title: error.message || '申请未发送成功，请重试', icon: 'none' }); }
      finally { this._requestSubmitting = false; if (!this._unloaded) this.setData({ submitting: false }); }
    }
    // 备注属于当前用户的好友关系数据，不会改动对方昵称、简介或足迹。
    try { await data.saveFriend({ id: this.data.id, uid: this.data.uid, name: this.data.name, bio: this.data.bio, tags: this.data.tags, remark: this.data.remark.trim() }); }
    catch (error) { return wx.showToast({ title: error.message, icon: 'none' }); }
    wx.showToast({ title: '备注已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
  },
  remove() { wx.showModal({ title: '删除这位好友？', content: '删除后将无法继续查看对方仅好友可见的内容，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) require('../../utils/actions').run(this, () => data.deleteFriend(this.data.id), '好友已删除', () => wx.navigateBack({ delta: 1 })); } }); }
});
