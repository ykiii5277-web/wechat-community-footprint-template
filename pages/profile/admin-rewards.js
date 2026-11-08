const cloud = require('../../utils/cloud-service');
const catalog = require('../../utils/virtual-items');

function pad(value) { return String(value).padStart(2, '0'); }
function newCampaignKey() {
  const date = new Date();
  return `reward-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function chinaDateValue(addDays = 0) {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000 + addDays * 24 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function confirm(options) { return new Promise(resolve => wx.showModal(Object.assign({}, options, { success: result => resolve(!!result.confirm), fail: () => resolve(false) }))); }

Page({
  data: {
    loading: true,
    isAdmin: false,
    totalUsers: 0,
    items: catalog.items,
    itemIndex: 0,
    scope: 'all',
    targetUid: '',
    quantity: '3',
    campaignKey: '',
    minDate: '',
    expiresDate: '',
    title: '全服福利',
    body: '感谢大家的支持，请收下这份福利。',
    sending: false,
    processed: 0,
    created: 0,
    skipped: 0,
    progressText: '',
    deletionUid: '',
    deletionConfirmUid: '',
    deletionTarget: null,
    previewingDeletion: false,
    deletingAccount: false
  },
  onLoad() {
    this.setData({ campaignKey: newCampaignKey(), minDate: chinaDateValue(), expiresDate: chinaDateValue(7) });
  },
  onShow() { this.loadStatus(); },
  async loadStatus() {
    const result = await cloud.getAdminStatus();
    if (!result || result.error || !result.isAdmin) {
      this.setData({ loading: false, isAdmin: false });
      wx.showToast({ title: result && result.message ? result.message : '没有开发者管理权限', icon: 'none' });
      return setTimeout(() => wx.navigateBack({ delta: 1 }), 700);
    }
    this.setData({ loading: false, isAdmin: true, totalUsers: Number(result.totalUsers) || 0 });
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  scope(e) {
    if (this.data.sending) return;
    this.setData({ scope: e.currentTarget.dataset.scope, processed: 0, created: 0, skipped: 0, progressText: '' });
  },
  itemChange(e) { this.setData({ itemIndex: Number(e.detail.value) || 0 }); },
  deadlineChange(e) { this.setData({ expiresDate: e.detail.value }); },
  resetCampaign() { if (!this.data.sending) this.setData({ campaignKey: newCampaignKey(), processed: 0, created: 0, skipped: 0, progressText: '' }); },
  deletionUidInput(e) {
    this.setData({ deletionUid: e.detail.value, deletionConfirmUid: '', deletionTarget: null });
  },
  deletionConfirmInput(e) { this.setData({ deletionConfirmUid: e.detail.value }); },
  async previewDeletion() {
    if (this.data.previewingDeletion || this.data.deletingAccount || !this.data.isAdmin) return;
    const uid = String(this.data.deletionUid || '').trim();
    if (!/^\d{7}$/.test(uid)) return wx.showToast({ title: '请输入完整的 7 位 UID', icon: 'none' });
    this.setData({ previewingDeletion: true, deletionTarget: null, deletionConfirmUid: '' });
    try {
      const result = await cloud.previewAccountDeletion(uid);
      if (!result || result.error || !result.target) throw new Error(result && result.message || '查询账号失败');
      if (String(this.data.deletionUid || '').trim() !== uid) return;
      this.setData({ deletionTarget: result.target });
    } catch (error) {
      wx.showModal({ title: '无法删除该账号', content: String(error && error.message || '请稍后重试'), showCancel: false });
    } finally {
      this.setData({ previewingDeletion: false });
    }
  },
  async deleteAccount() {
    if (this.data.deletingAccount || !this.data.isAdmin) return;
    const target = this.data.deletionTarget;
    if (!target || String(this.data.deletionUid || '').trim() !== target.uid || String(this.data.deletionConfirmUid || '').trim() !== target.uid) return wx.showToast({ title: '请核对并再次输入 UID', icon: 'none' });
    const agreed = await confirm({ title: `永久删除 UID ${target.uid}？`, content: `账号：${target.name}\n将删除其资料、内容、评论、好友、聊天、道具、任务、邮箱及关联云文件，也可能影响与该账号互动的其他用户。无法恢复；目标账号再次登录会新建资料。`, confirmText: '确认删除', confirmColor: '#B3473E' });
    if (!agreed || this.data.deletionTarget !== target) return;
    this.setData({ deletingAccount: true });
    wx.showLoading({ title: '正在删除账号', mask: true });
    try {
      const result = await cloud.deleteAccountByUid(target.uid, target.accountKey);
      if (!result || result.error) throw new Error(result && result.message || '云端删除失败，请先核对账号状态');
      if (!result.completed) throw new Error(`有 ${Number(result.failed) || 0} 项未完成。请保留原 UID，再次查询并重试；不要另建同 UID 账号。`);
      this.setData({ deletionUid: '', deletionConfirmUid: '', deletionTarget: null, totalUsers: Math.max(0, this.data.totalUsers - 1) });
      const shared = Number(result.storage && result.storage.sharedRetained) || 0;
      wx.showModal({ title: '账号已删除', content: `UID ${target.uid} 的账号及关联记录已清理，删除云文件 ${Number(result.storage && result.storage.removed) || 0} 个。${shared ? `另有 ${shared} 个文件仍被其他记录引用，已保留以免影响其他用户。` : ''}该微信账号再次登录会重新建档。`, showCancel: false, confirmText: '知道了' });
    } catch (error) {
      wx.showModal({ title: '删除未确认完成', content: String(error && error.message || '请到云端核对后再重试'), showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ deletingAccount: false });
    }
  },
  async send() {
    if (this.data.sending || !this.data.isAdmin) return;
    const item = this.data.items[this.data.itemIndex];
    const quantity = Math.floor(Number(this.data.quantity));
    const campaignKey = String(this.data.campaignKey || '').trim();
    const title = String(this.data.title || '').trim();
    const body = String(this.data.body || '').trim();
    const targetUid = String(this.data.targetUid || '').trim();
    const expiresDate = String(this.data.expiresDate || '').trim();
    if (!item) return wx.showToast({ title: '请选择道具', icon: 'none' });
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999) return wx.showToast({ title: '数量应为 1 至 999', icon: 'none' });
    if (this.data.scope === 'uid' && !/^\d{7}$/.test(targetUid)) return wx.showToast({ title: '请输入接收账号的 7 位 UID', icon: 'none' });
    if (!/^[a-zA-Z0-9_-]{3,60}$/.test(campaignKey)) return wx.showToast({ title: '请检查批次标识', icon: 'none' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresDate) || expiresDate < this.data.minDate) return wx.showToast({ title: '请选择有效的截止日期', icon: 'none' });
    if (!title) return wx.showToast({ title: '请填写邮件标题', icon: 'none' });
    const isSingle = this.data.scope === 'uid';
    const recipientText = isSingle ? `UID ${targetUid}` : `当前 ${this.data.totalUsers} 位用户`;
    const agreed = await confirm({ title: isSingle ? '确认发放单人福利？' : '确认发放全服福利？', content: `将向${recipientText}发放 ${item.name} × ${quantity}。\n\n领取截止：${expiresDate} 23:59（北京时间）\n批次：${campaignKey}\n同一批次对同一用户不会重复发放。`, confirmText: '确认发放', confirmColor: '#1F513E' });
    if (!agreed) return;
    this.setData({ sending: true, processed: 0, created: 0, skipped: 0, progressText: '正在准备发放…' });
    let offset = 0;
    let processed = 0;
    let created = 0;
    let skipped = 0;
    let totalUsers = this.data.totalUsers;
    try {
      if (isSingle) {
        const result = await cloud.sendRewardToUid({ targetUid, campaignKey, itemId: item.id, quantity, title, body, expiresDate });
        if (!result || result.error) throw new Error(result && result.message ? result.message : '福利发放失败');
        processed = Number(result.processed) || 0;
        created = Number(result.created) || 0;
        skipped = Number(result.skipped) || 0;
        const targetName = result.target && result.target.name ? `（${result.target.name}）` : '';
        this.setData({ processed, created, skipped, progressText: created ? `已向 UID ${targetUid}${targetName}发送奖励邮件` : `UID ${targetUid}${targetName}在该批次已收到奖励` });
        wx.showModal({ title: created ? '福利发放完成' : '未重复发放', content: created ? `已向 UID ${targetUid}发送 ${item.name} × ${quantity}，请对方在 ${expiresDate} 23:59 前领取。` : '该账号已经收到过此批次福利，系统没有重复生成邮件。', showCancel: false, confirmText: '知道了' });
        return;
      }
      for (let page = 0; page < 500; page += 1) {
        const result = await cloud.broadcastReward({ campaignKey, itemId: item.id, quantity, title, body, expiresDate, offset });
        if (!result || result.error) throw new Error(result && result.message ? result.message : '福利发放失败');
        processed += Number(result.processed) || 0;
        created += Number(result.created) || 0;
        skipped += Number(result.skipped) || 0;
        totalUsers = Number(result.totalUsers) || totalUsers;
        this.setData({ processed, created, skipped, totalUsers, progressText: `已处理 ${processed} / ${totalUsers} 位用户` });
        if (!result.hasMore) break;
        const nextOffset = Number(result.nextOffset) || 0;
        if (nextOffset <= offset) throw new Error('发放进度未推进，请稍后重试');
        offset = nextOffset;
      }
      this.setData({ progressText: `发放完成：新增 ${created} 封，跳过 ${skipped} 封` });
      wx.showModal({ title: '福利发放完成', content: `已为 ${created} 位用户新增奖励邮件。\n同批次已有 ${skipped} 位用户，因此未重复发放。`, showCancel: false, confirmText: '知道了' });
    } catch (error) {
      this.setData({ progressText: `已处理 ${processed} 位，过程中出现错误，可保留原批次标识后重试。` });
      wx.showModal({ title: '发放未全部完成', content: String(error && error.message || '请稍后使用相同批次标识重试'), showCancel: false });
    } finally {
      this.setData({ sending: false });
    }
  }
});
