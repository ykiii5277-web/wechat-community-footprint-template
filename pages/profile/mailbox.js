const cloud = require('../../utils/cloud-service');

Page({
  data: { mails: [], loading: true },
  onShow() { this.refresh(); },
  async refresh() {
    this.setData({ loading: true });
    const result = await cloud.getMailbox();
    if (!result || result.error) {
      this.setData({ loading: false });
      return wx.showToast({ title: result && result.message ? result.message : '邮箱读取失败', icon: 'none' });
    }
    this.setData({ mails: result.mails || [], loading: false });
    if ((result.mails || []).some(item => !item.readAt)) {
      cloud.markMailboxRead().then(marked => {
        if (marked && !marked.error) this.setData({ mails: this.data.mails.map(item => Object.assign({}, item, { readAt: item.readAt || Date.now() })) });
      });
    }
  },
  remove(e) {
    const mail = this.data.mails.find(item => item.id === e.currentTarget.dataset.id);
    if (!mail) return;
    const warning = mail.status === 'pending' ? '这封邮件中的奖励尚未领取，删除后奖励也会一并失去。是否继续？' : '删除后无法恢复，是否继续？';
    wx.showModal({ title: '删除这封邮件？', content: warning, confirmText: '删除', confirmColor: '#B64D42', success: async result => {
      if (!result.confirm) return;
      const removed = await cloud.deleteMail(mail.id);
      if (!removed || removed.error) return wx.showToast({ title: removed && removed.message ? removed.message : '删除失败', icon: 'none' });
      this.setData({ mails: this.data.mails.filter(item => item.id !== mail.id) });
      wx.showToast({ title: '已删除', icon: 'success' });
    } });
  },
  async claim(e) {
    const result = await cloud.claimMail(e.currentTarget.dataset.id);
    if (!result || result.error) return wx.showToast({ title: result && result.message ? result.message : '领取失败', icon: 'none' });
    wx.showToast({ title: '奖励已放入背包', icon: 'success' });
    this.refresh();
  },
  preview(e) {
    const mail = this.data.mails.find(item => item.id === e.currentTarget.dataset.id);
    if (mail && mail.images && mail.images.length) wx.previewImage({ current: mail.images[Number(e.currentTarget.dataset.index) || 0], urls: mail.images });
  }
});
