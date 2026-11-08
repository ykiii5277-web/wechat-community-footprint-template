// “趣闻”首页把相册、记录和作品汇总为同一份热度榜，方便发现近期受关注的内容。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const featureGuide = require('../../utils/feature-guide');
const publicBrowser = require('../../utils/public-browser');

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
const rewardGuide = [
  { id: 'day', name: '每日榜', badge: '日', itemName: '星星', tiers: [{ rank: '第 1–3 名', quantity: 3 }, { rank: '第 4–6 名', quantity: 2 }, { rank: '第 7–10 名', quantity: 1 }] },
  { id: 'week', name: '每周榜', badge: '周', itemName: '信封', tiers: [{ rank: '第 1–5 名', quantity: 3 }, { rank: '第 6–10 名', quantity: 2 }, { rank: '第 11–20 名', quantity: 1 }] },
  { id: 'month', name: '每月榜', badge: '月', itemName: '礼盒', tiers: [{ rank: '第 1–5 名', quantity: 6 }, { rank: '第 6–10 名', quantity: 4 }, { rank: '第 11–20 名', quantity: 2 }] },
  { id: 'year', name: '每年榜', badge: '年', itemName: '纪念册', tiers: [{ rank: '第 1 名', quantity: 3 }, { rank: '第 2 名', quantity: 2 }, { rank: '第 3 名', quantity: 1 }] }
];

Page({
  data: { periods, contentTypes, monthLabels, rewardGuide, showRewardGuidePanel: false, activeRange: 'latest', activeKind: '', years: [], selectedYear: 0, selectedMonth: 1, yearIndex: 0, monthIndex: 0, campOptions: [], campIndex: 0, campId: '', campName: '全部营地', searchText: '', keyword: '', items: [], page: 1, total: 0, totalPages: 1, rankingLoading: false, hasPrevious: false, hasNext: false, rangeNote: '', showProfileGuide: false },
  onShow() { if (getApp().ensureProfileOnboarding && getApp().ensureProfileOnboarding()) return; this.setTabSelection(); this.refresh(); featureGuide.syncPage(this); getApp().maybeOpenFeatureGuide(); },
  // custom-tab-bar 不会自动识别当前页，因此每次显示时显式同步高亮项。
  setTabSelection() { const tabBar = this.getTabBar && this.getTabBar(); if (tabBar) tabBar.setSelected(0); },
  // 每次回到首页都重新计算：内容被浏览、点赞或新发布后，榜单会立即更新。
  async refresh(requestedPage) {
    const request = this._refreshRequest = (this._refreshRequest || 0) + 1;
    this.setData({ rankingLoading: true });
    try {
    // 云端函数会汇总所有用户明确设为“公开”的内容；未部署云端时自动回退到本机演示数据。
    const requestedYear = Number(this.data.selectedYear) || 0;
    const selectedMonth = Number(this.data.selectedMonth) || new Date().getMonth() + 1;
    const activeRange = this.data.activeRange;
    const campOptions = [{ id: '', name: '全部营地' }].concat(data.camps().map(item => ({ id: item.id, name: item.name })));
    const campIndex = Math.max(0, campOptions.findIndex(item => item.id === this.data.campId));
    const selectedCamp = campOptions[campIndex];
    // 三个“其他足迹”分类和原有四营地均可作为每一种榜单的筛选条件。
    const campId = selectedCamp.id;
    const page = Math.max(1, Number(requestedPage) || Number(this.data.page) || 1);
    const keyword = String(this.data.keyword || '').trim();
    const rankingOptions = { range: activeRange, year: requestedYear, month: selectedMonth, campId, kind: this.data.activeKind, keyword };
    let ranking = await data.getHotRankingPageAsync(Object.assign({}, rankingOptions, { page, includeYears: true }));
    if (request !== this._refreshRequest) return;
    // 兼容尚未更新的云函数。新版直接随榜单返回年份，省去第二次扫描。
    const years = ranking.years || await data.getHotRankingYearsAsync();
    if (request !== this._refreshRequest) return;
    const selectedYear = years.includes(requestedYear) ? requestedYear : years[0];
    rankingOptions.year = selectedYear;
    if (!ranking.years && !ranking.error && selectedYear !== requestedYear && (activeRange === 'month' || activeRange === 'year')) {
      ranking = await data.getHotRankingPageAsync(Object.assign({}, rankingOptions, { page }));
      if (request !== this._refreshRequest) return;
    }
    if (ranking.error) { wx.showToast({ title: ranking.error, icon: 'none' }); return this.setData({ items: [], page: 1, total: 0, totalPages: 1, hasNext: false, hasPrevious: false, rangeNote: '云端暂未加载成功，请稍后重试' }); }
    this._rankingOptions = rankingOptions;
    this._rankingPageSize = Number(ranking.pageSize) || 20;
    const totalPages = Math.max(1, Math.ceil((Number(ranking.total) || 0) / this._rankingPageSize));
    if (page > totalPages) return this.refresh(totalPages);
    const kindName = (contentTypes.find(item => item.id === this.data.activeKind) || contentTypes[0]).name;
    const campNote = campId ? ` · ${selectedCamp.name}` : '';
    const periodNote = activeRange === 'latest' ? `${kindName}公开内容按最新发布时间排列${campNote}` : activeRange === 'week' ? `本周发布的${kindName}公开内容热度排行${campNote}` : activeRange === 'month' ? `${selectedYear} 年 ${selectedMonth} 月 · ${kindName}公开内容热度排行${campNote}` : `${selectedYear} 年${campNote} · ${kindName}公开内容热度排行`;
    const rangeNote = keyword ? `搜索“${keyword}” · ${periodNote}` : periodNote;
    const items = ranking.items.map(item => item.kind !== 'photo' ? item : Object.assign({}, item, {
      title: item.name || (item.title !== '相册中的一段记忆' && item.title) || '未命名图片',
      summary: item.hideUid || !item.ownerUid ? '' : `UID：${item.ownerUid}`
    }));
    this.setData({ years, selectedYear, selectedMonth, yearIndex: Math.max(0, years.indexOf(selectedYear)), monthIndex: selectedMonth - 1, campOptions, campIndex, campId: selectedCamp.id, campName: selectedCamp.name, items, page: ranking.page, total: ranking.total, totalPages, hasPrevious: ranking.page > 1, hasNext: ranking.hasNext, rangeNote, showProfileGuide: data.shouldShowProfileGuide() });
    } catch (error) {
      if (request === this._refreshRequest) wx.showToast({ title: '榜单加载失败，请重试', icon: 'none' });
    } finally {
      if (request === this._refreshRequest) this.setData({ rankingLoading: false });
    }
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
  previousPage() { if (!this.data.rankingLoading && this.data.hasPrevious) return this.refresh(this.data.page - 1); },
  nextPage() { if (!this.data.rankingLoading && this.data.hasNext) return this.refresh(this.data.page + 1); },
  firstPage() { if (!this.data.rankingLoading && this.data.hasPrevious) return this.refresh(1); },
  lastPage() { if (!this.data.rankingLoading && this.data.hasNext) return this.refresh(this.data.totalPages); },
  jumpPage() {
    if (this.data.rankingLoading || this._jumpDialogOpen) return;
    this._jumpDialogOpen = true;
    wx.showModal({
      title: '跳转到指定页', editable: true, content: '', placeholderText: `请输入 1–${this.data.totalPages} 的页码`, confirmText: '跳转', cancelText: '取消', confirmColor: '#315F49',
      success: result => { if (result.confirm) return this.jumpToPage(result.content); },
      complete: () => { this._jumpDialogOpen = false; }
    });
  },
  jumpToPage(input) {
    if (this.data.rankingLoading) return;
    const value = String(input == null ? '' : input).trim();
    const page = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(page) || page < 1 || page > this.data.totalPages) return wx.showToast({ title: `请输入 1–${this.data.totalPages} 的整数页码`, icon: 'none' });
    if (page !== this.data.page) return this.refresh(page);
  },
  showRewardGuide() { this.setData({ showRewardGuidePanel: true }); },
  hideRewardGuide() { this.setData({ showRewardGuidePanel: false }); },
  stopRewardGuideTap() {},
  // 点击榜单内容仍进入原有详情页，原详情页会自动累计一次浏览量。
  openItem(e) {
    const { id, kind, ownerUid, recordId, index } = e.currentTarget.dataset;
    const preview = this.data.items[Number(index)];
    if (preview) wx.setStorageSync('hui_time_public_preview_v1', preview);
    const browseSession = preview ? publicBrowser.create({
      items: this.data.items, index: Number(index), options: this._rankingOptions || {},
      page: this.data.page, pageSize: this._rankingPageSize, total: this.data.total, hasNext: this.data.hasNext,
      loadPage: options => data.getHotRankingPageAsync(options)
    }) : '';
    wx.navigateTo({
      url: `/pages/community/detail?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&ownerUid=${encodeURIComponent(ownerUid || '')}&recordId=${encodeURIComponent(recordId || '')}${browseSession ? `&browseSession=${encodeURIComponent(browseSession)}` : ''}`,
      fail: () => { publicBrowser.discard(browseSession); wx.showToast({ title: '内容打开失败，请重试', icon: 'none' }); }
    });
  },
  guideEdit() { data.markProfileGuideSeen(); this.setData({ showProfileGuide: false }); nav.go('/pages/profile/intro-editor'); },
  guideSkip() { data.markProfileGuideSeen(); this.setData({ showProfileGuide: false }); }
});
