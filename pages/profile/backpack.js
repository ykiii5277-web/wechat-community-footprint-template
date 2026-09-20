const cloud = require('../../utils/cloud-service');
const catalog = require('../../utils/virtual-items');
const nav = require('../../utils/nav');

Page({
  data: { items: catalog.withCounts(), loading: true },
  onShow() { this.refresh(); },
  async refresh() {
    this.setData({ loading: true });
    const result = await cloud.getInventory();
    if (!result || result.error) {
      this.setData({ loading: false });
      return wx.showToast({ title: result && result.message ? result.message : '背包读取失败', icon: 'none' });
    }
    const wallet = result.wallet || {};
    // 背包只展示当前可以实际赠送的库存；累计收到但已经用完的道具不占据列表。
    const ownedItems = catalog.withCounts(wallet.items, wallet.received).filter(item => item.count > 0);
    this.setData({ items: ownedItems, loading: false });
  },
  gift(e) {
    const item = this.data.items.find(value => value.id === e.currentTarget.dataset.id);
    if (!item || item.count < 1) return wx.showToast({ title: '该道具数量不足', icon: 'none' });
    nav.go(`/pages/profile/gift?item=${encodeURIComponent(item.id)}`);
  },
  shop() { nav.go('/pages/profile/shop'); }
});
