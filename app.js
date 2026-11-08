// 小程序入口：启动时初始化云环境和本地缓存。云端不可用时仍可在开发工具中预览本地原型。
const appConfig = require('./config/app-config');
const data = require('./utils/data');
const cloud = require('./utils/cloud-service');
const featureGuide = require('./utils/feature-guide');
const onboarding = require('./utils/profile-onboarding');

App({
  onLaunch() {
    cloud.initCloud();
    data.resetCloudSession();
    this.globalData.profileRequired = false;
    this._onboardingRedirecting = false;
    // 兼容仍在运行旧版云函数的环境：首次在本机打开时也能看到引导。
    this.globalData.firstLocalVisit = !wx.getStorageSync('hui_time_initialized_v1');
    data.init();
    // 云端会以微信 OPENID 识别当前用户，并为首次使用者固定分配唯一 UID。
    this.globalData.bootstrapPromise = cloud.bootstrap({}).then(result => {
      if (result && !result.error && result.profile) {
        this.globalData.bootstrapUid = result.profile.uid;
        data.bindCloudAccount(result.profile);
        this.acceptOnboardingProfile(result);
        // 只更新缓存，不在启动时把旧缓存再次写回云端。
        data.applyCloudProfile(result.profile);
        this.globalData.hydrationPromise = data.hydrateOwnCloudState().then(result => {
          // 首屏可能早于云端恢复完成，恢复后重绘当前页面，避免空列表一直留在屏幕上。
          setTimeout(() => {
            const pages = getCurrentPages(); const page = pages[pages.length - 1];
            if (!page) return;
            const refresh = typeof page.refresh === 'function' ? page.refresh : page.onShow;
            if (typeof refresh === 'function') Promise.resolve(refresh.call(page)).catch(() => {});
          }, 0);
          return result;
        }).catch(() => false);
        // 首次登录福利邮件在云端幂等创建，并同步当前背包状态。
        cloud.getInventory();
        setTimeout(() => this.maybeOpenFeatureGuide(), 100);
      }
      return result;
    });
    if (!this._networkListener && typeof wx.onNetworkStatusChange === 'function') {
      this._networkListener = status => { if (status.isConnected) this.syncInBackground(); };
      wx.onNetworkStatusChange(this._networkListener);
    }
    this.syncInBackground();
  },
  onShow() { this.maybeOpenFeatureGuide(); this.syncInBackground(); },
  syncInBackground() {
    if (this._backgroundSyncPromise || !this.globalData.bootstrapPromise) return this._backgroundSyncPromise;
    this._backgroundSyncPromise = (async () => {
      let account = await this.globalData.bootstrapPromise;
      let reconnected = false;
      if (!account || account.error || !account.profile) {
        account = await cloud.bootstrap({});
        if (!account || account.error || !account.profile) return;
        this.globalData.bootstrapPromise = Promise.resolve(account);
        this.globalData.bootstrapUid = account.profile.uid;
        data.bindCloudAccount(account.profile);
        data.applyCloudProfile(account.profile);
        this.acceptOnboardingProfile(account);
        this.maybeOpenFeatureGuide();
        reconnected = true;
      }
      if (this.globalData.hydrationPromise) await this.globalData.hydrationPromise;
      const refreshed = typeof data.runBackgroundSync === 'function' && await data.runBackgroundSync();
      if (!reconnected && !refreshed) return;
      const pages = getCurrentPages(); const page = pages[pages.length - 1];
      if (page) {
        const refresh = typeof page.refresh === 'function' ? page.refresh : page.onShow;
        if (typeof refresh === 'function') await refresh.call(page);
      }
    })().catch(() => {}).finally(() => { this._backgroundSyncPromise = null; });
    return this._backgroundSyncPromise;
  },
  maybeOpenFeatureGuide() {
    const bootstrap = this.globalData.bootstrapPromise;
    if (!bootstrap) return;
    bootstrap.then(result => {
      const uid = result && !result.error && result.profile && result.profile.uid;
      if (this.globalData.profileRequired) return this.ensureProfileOnboarding();
      if (!uid || !featureGuide.shouldAutoOpen(uid) || featureGuide.isActive()) return;
      const pages = getCurrentPages();
      if (!pages.length) return;
      if (onboarding.route(pages[pages.length - 1]) === onboarding.EDITOR) return;
      data.markProfileGuideSeen();
      const page = pages[pages.length - 1];
      if (page.data && page.data.showProfileGuide) page.setData({ showProfileGuide: false });
      featureGuide.start(uid);
    });
  },
  acceptOnboardingProfile(account) {
    this.globalData.profileRequired = onboarding.required(account.profile, account.isNewUser === true);
    if (!this.globalData.profileRequired && account.profile.profileOnboardingVersion === 1) featureGuide.queue(account.profile.uid);
  },
  ensureProfileOnboarding() {
    if (!this.globalData.profileRequired) return false;
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    if (!page) return true;
    if (onboarding.route(page) === onboarding.EDITOR && pages.length === 1) {
      page.setData({ mandatory: true }); return true;
    }
    if (this._onboardingRedirecting) return true;
    this._onboardingRedirecting = true;
    wx.reLaunch({ url: '/pages/profile/intro-editor?onboarding=1', complete: () => { this._onboardingRedirecting = false; } });
    return true;
  },
  completeProfileOnboarding(profile) {
    if (!profile || profile.uid !== this.globalData.bootstrapUid || profile.profileCompleted !== true) throw new Error('云端尚未确认简介完善成功，请更新云函数后重试');
    this.globalData.profileRequired = false;
    this.globalData.bootstrapPromise = Promise.resolve({ profile, isNewUser: false });
    data.markProfileGuideSeen();
    featureGuide.queue(profile.uid);
  },
  globalData: {
    brandName: appConfig.brandName || '同行足迹',
    bootstrapPromise: null,
    bootstrapUid: '',
    firstLocalVisit: false
  }
});
