// 可复用页头：接收标题和副标题，点击左侧按钮返回上一页。
Component({
  properties: { title: { type: String, value: '' }, subtitle: { type: String, value: '' }, showBack: { type: Boolean, value: true } },
  data: { statusBarHeight: 20, navHeight: 44 },
  lifetimes: {
    attached() {
      try {
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const statusBarHeight = Number(info.statusBarHeight) || 20;
        const menu = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null;
        const navHeight = menu && menu.height > 0 && menu.top >= statusBarHeight ? Math.max(40, (menu.top - statusBarHeight) * 2 + menu.height) : 44;
        this.setData({ statusBarHeight, navHeight });
      } catch (error) { /* 旧客户端使用默认安全高度。 */ }
    }
  },
  methods: { back() { if (this.data.showBack !== false) wx.navigateBack({ delta: 1 }); } }
});
