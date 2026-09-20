// 好友编辑页：添加时只发起 UID 申请；成为好友后仅允许编辑“我的备注”，对方资料始终由对方本人管理。
const data = require('../../utils/data');

Page({
  data: { id: '', uid: '', requestMode: false, pageTitle: '添加好友', reason: '', name: '', remark: '', bio: '', tags: [] },
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
      const result = await data.createFriendRequestAsync({ toUid: this.data.uid, reason: this.data.reason });
      if (result.error) return wx.showToast({ title: result.error, icon: 'none' });
      wx.showToast({ title: '好友申请已提交', icon: 'success' });
      return setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
    }
    // 备注属于当前用户的好友关系数据，不会改动对方昵称、简介或足迹。
    data.saveFriend({ id: this.data.id, uid: this.data.uid, name: this.data.name, bio: this.data.bio, tags: this.data.tags, remark: this.data.remark.trim() });
    wx.showToast({ title: '备注已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
  },
  remove() { wx.showModal({ title: '删除这位好友？', content: '删除后将无法继续查看对方仅好友可见的内容，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) { data.deleteFriend(this.data.id); wx.navigateBack({ delta: 1 }); } } }); }
});
