const cloud = require('../../utils/cloud-service');
const catalog = require('../../utils/virtual-items');

function compareVersion(left, right) {
  const a = String(left || '').split('.').map(Number);
  const b = String(right || '').split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function loginCode() { return new Promise((resolve, reject) => wx.login({ success: result => result.code ? resolve(result.code) : reject(new Error('LOGIN_CODE_EMPTY')), fail: reject })); }
function requestPayment(payData) { return new Promise((resolve, reject) => wx.requestVirtualPayment(Object.assign({}, payData, { success: resolve, fail: reject }))); }

Page({
  data: { products: catalog.items.filter(item => item.purchasable).map(item => Object.assign({}, item, { priceText: `¥${(item.priceFen / 100).toFixed(0)}` })), modeText: '', configured: false, buying: '' },
  async onShow() {
    const result = await cloud.getPaymentStatus();
    if (result && !result.error) this.setData({ configured: !!result.configured, modeText: result.configured ? (result.env === 1 ? '沙箱调试' : '现网支付') : '支付配置待完成' });
    else this.setData({ configured: false, modeText: '支付服务连接失败' });
    cloud.reconcilePayments();
  },
  checkSupport() {
    if (!wx.requestVirtualPayment || !wx.canIUse('requestVirtualPayment')) { wx.showModal({ title: '暂不支持', content: '当前微信版本不支持虚拟支付，请升级微信后重试。', showCancel: false }); return false; }
    const system = wx.getSystemInfoSync();
    if (system.platform === 'ios' && compareVersion(system.version, '8.0.68') < 0) { wx.showModal({ title: '请升级微信', content: 'iOS 虚拟支付需要微信 8.0.68 或以上版本。', showCancel: false }); return false; }
    return true;
  },
  async buy(e) {
    const productId = e.currentTarget.dataset.id;
    if (this.data.buying) return;
    if (!this.data.configured) {
      wx.showModal({ title: '支付尚未配置', content: '云函数尚未配置支付环境变量，暂时无法拉起微信支付。请先在 hui-api 中配置轮换后的 AppSecret 与 AppKey，并选择沙箱或现网环境。', showCancel: false, confirmText: '知道了' });
      return;
    }
    if (!this.checkSupport()) return;
    this.setData({ buying: productId });
    wx.showLoading({ title: '正在创建订单' });
    try {
      const code = await loginCode();
      const order = await cloud.createPaymentOrder(productId, code);
      wx.hideLoading();
      if (!order || order.error) throw new Error(order && order.message ? order.message : '订单创建失败');
      await requestPayment(order.payData);
      wx.showLoading({ title: '正在确认发货' });
      // success 回调不是唯一发货依据；这里只主动查单加速到账，最终仍以云端推送/查单幂等发货。
      await new Promise(resolve => setTimeout(resolve, 1200));
      const checked = await cloud.queryPayment(order.outTradeNo);
      wx.hideLoading();
      if (checked && checked.delivered) wx.showToast({ title: '道具已到账', icon: 'success' });
      else wx.showToast({ title: '支付成功，到账确认中', icon: 'none' });
    } catch (error) {
      wx.hideLoading();
      const text = String(error && (error.errMsg || error.message) || '支付未完成');
      if (!/cancel|-2/i.test(text)) wx.showToast({ title: text.slice(0, 28), icon: 'none' });
    } finally { this.setData({ buying: '' }); }
  }
});
