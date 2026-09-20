// 好友详情页只保留简介和足迹两个入口；记录与作品都收纳在足迹的对应阶段内。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const catalog = require('../../utils/virtual-items');

Page({
  data: { friend: null, initial: '', primaryReceivedItems: catalog.receivedGroups().primary, otherReceivedItems: [], showOtherGifts: false },
  onLoad(options) { this.id = options.id; this.refresh(); },
  onShow() { if (this.id) this.refresh(); },
  async refresh() { const friend = await data.getFriendAsync(this.id); if (!friend) return wx.navigateBack(); friend.affection = friend.affection || { points: 0, level: 1, title: '萍水相逢', description: '茫茫人海中命运交织，不过一面之缘。' }; const received = catalog.receivedGroups(friend.received || {}); this.setData({ friend, initial: (friend.name || '好').slice(0, 1), primaryReceivedItems: received.primary, otherReceivedItems: received.other }); },
  open(e) { nav.go(`/pages/friends/content?id=${this.id}&type=${e.currentTarget.dataset.type}`); },
  chat() { nav.go(`/pages/friends/chat?id=${encodeURIComponent(this.id)}`); },
  edit() { nav.go(`/pages/friends/editor?id=${this.id}`); },
  toggleOtherGifts() { this.setData({ showOtherGifts: !this.data.showOtherGifts }); },
  remove() { wx.showModal({ title: '删除这位好友？', content: '删除后将无法继续查看对方仅好友可见的内容，是否继续？', confirmColor: '#C84A3A', success: async result => { if (result.confirm) { const removed = await data.deleteFriendAsync(this.id); if (removed && !removed.error) wx.navigateBack({ delta: 1 }); else wx.showToast({ title: removed && removed.error ? removed.error : '删除失败', icon: 'none' }); } } }); }
});
