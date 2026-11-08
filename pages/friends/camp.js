// Compatibility entry for previously shared links.
Page({
  onLoad(options) {
    const query = Object.keys(options || {}).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(options[key])).join('&');
    wx.redirectTo({ url: '/packages/camps/friend-camp' + (query ? '?' + query : ''), fail: () => wx.showToast({ title: '页面加载失败，请返回重试', icon: 'none' }) });
  }
});
