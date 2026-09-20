// “动态”首页把相册、记录和作品汇总为同一份热度榜，方便发现近期受关注的内容。
const data = require('../../utils/data');
const nav = require('../../utils/nav');

const periods = [
  { id: 'latest', name: '最新' },
  { id: 'week', name: '本周' },
  { id: 'month', name: '月份' },
  { id: 'year', name: '年份' }
];
const contentTypes = [
  { id: '', name: '全部' },
  { id: 'growth', name: '记录' },
  { id: 'work', name: '作品' },
  { id: 'photo', name: '相册' }
];
const monthLabels = Array.from({ length: 12 }, (_, index) => `${index + 1} 月`);

Page({
  data: { periods, contentTypes, monthLabels, activeRange: 'latest', activeKind: '', years: [], selectedYear: 0, selectedMonth: 1, yearIndex: 0, monthIndex: 0, campOptions: [], campIndex: 0, campId: '', campName: '全部营地', searchText: '', keyword: '', items: [], page: 1, total: 0, hasPrevious: false, hasNext: false, rangeNote: '', showProfileGuide: false },
  onShow() { this.setTabSelection(); this.refresh(); },
  // custom-tab-bar 不会自动识别当前页，因此每次显示时显式同步高亮项。
  setTabSelection() { const tabBar = this.getTabBar && this.getTabBar(); if (tabBar) tabBar.setSelected(0); },
  // 每次回到首页都重新计算：内容被浏览、点赞或新发布后，榜单会立即更新。
  async refresh(requestedPage) {
    // 云端函数会汇总所有用户明确设为“公开”的内容；未部署云端时自动回退到本机演示数据。
    const years = await data.getHotRankingYearsAsync();
    const selectedYear = years.indexOf(Number(this.data.selectedYear)) >= 0 ? Number(this.data.selectedYear) : years[0];
    const selectedMonth = Number(this.data.selectedMonth) || new Date().getMonth() + 1;
    const activeRange = this.data.activeRange;
    const campOptions = [{ id: '', name: '全部营地' }].concat(data.camps().map(item => ({ id: item.id, name: item.name })));
    const campIndex = Math.max(0, campOptions.findIndex(item => item.id === this.data.campId));
    const selectedCamp = campOptions[campIndex];
    // 更多活动分类和首页四类活动均可作为榜单筛选条件。
    const campId = selectedCamp.id;
    const page = Math.max(1, Number(requestedPage) || Number(this.data.page) || 1);
    const keyword = String(this.data.keyword || '').trim();
    const ranking = await data.getHotRankingPageAsync({ range: activeRange, year: selectedYear, month: selectedMonth, campId, kind: this.data.activeKind, keyword, page });
    const kindName = (contentTypes.find(item => item.id === this.data.activeKind) || contentTypes[0]).name;
    const campNote = campId ? ` · ${selectedCamp.name}` : '';
    const periodNote = activeRange === 'latest' ? `${kindName}公开内容按最新发布时间排列${campNote}` : activeRange === 'week' ? `本周发布的${kindName}公开内容热度排行${campNote}` : activeRange === 'month' ? `${selectedYear} 年 ${selectedMonth} 月 · ${kindName}公开内容热度排行${campNote}` : `${selectedYear} 年${campNote} · ${kindName}公开内容热度排行`;
    const rangeNote = keyword ? `搜索“${keyword}” · ${periodNote}` : periodNote;
    this.setData({ years, selectedYear, selectedMonth, yearIndex: Math.max(0, years.indexOf(selectedYear)), monthIndex: selectedMonth - 1, campOptions, campIndex, campId: selectedCamp.id, campName: selectedCamp.name, items: ranking.items, page: ranking.page, total: ranking.total, hasPrevious: ranking.page > 1, hasNext: ranking.hasNext, rangeNote, showProfileGuide: data.shouldShowProfileGuide() });
  },
  chooseRange(e) { this.setData({ activeRange: e.currentTarget.dataset.range, page: 1 }, () => this.refresh(1)); },
  chooseKind(e) { this.setData({ activeKind: e.currentTarget.dataset.kind, page: 1 }, () => this.refresh(1)); },
  yearChange(e) { this.setData({ selectedYear: this.data.years[Number(e.detail.value)], page: 1 }, () => this.refresh(1)); },
  monthChange(e) { this.setData({ selectedMonth: Number(e.detail.value) + 1, page: 1 }, () => this.refresh(1)); },
  campChange(e) { const camp = this.data.campOptions[Number(e.detail.value)]; this.setData({ campId: camp ? camp.id : '', page: 1 }, () => this.refresh(1)); },
  // 输入时只保存文字；点击搜索或键盘确认后才请求榜单，避免每打一个字就刷新页面。
  searchInput(e) { this.setData({ searchText: e.detail.value || '' }); },
  search() { this.setData({ keyword: String(this.data.searchText || '').trim(), page: 1 }, () => this.refresh(1)); },
  clearSearch() { this.setData({ searchText: '', keyword: '', page: 1 }, () => this.refresh(1)); },
  previousPage() { if (this.data.hasPrevious) this.refresh(this.data.page - 1); },
  nextPage() { if (this.data.hasNext) this.refresh(this.data.page + 1); },
  showRewardGuide() {
    wx.showModal({ title: '热度榜奖励说明', content: '每日 TOP1：1 个星星\n每周 TOP1/2/3：3/2/1 个星星\n每月 TOP1/2/3：6/4/2 个信封\n每年 TOP1/2/3：3/2/1 个纪念册\n\n奖励会发到“我的—邮箱”，领取后进入背包。', showCancel: false, confirmText: '知道了' });
  },
  // 点击榜单内容仍进入原有详情页，原详情页会自动累计一次浏览量。
  openItem(e) {
    const { id, kind, ownerUid, recordId, index } = e.currentTarget.dataset;
    const preview = this.data.items[Number(index)];
    if (preview) wx.setStorageSync('hui_time_public_preview_v1', preview);
    nav.go(`/pages/community/detail?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&ownerUid=${encodeURIComponent(ownerUid || '')}&recordId=${encodeURIComponent(recordId || '')}`);
  },
  guideEdit() { data.markProfileGuideSeen(); this.setData({ showProfileGuide: false }); nav.go('/pages/profile/intro-editor'); },
  guideSkip() { data.markProfileGuideSeen(); this.setData({ showProfileGuide: false }); }
});
