// 小程序入口：启动时初始化云环境和本地缓存。云端不可用时仍可在开发工具中预览本地原型。
const data = require('./utils/data');
const cloud = require('./utils/cloud-service');
const appConfig = require('./config/app-config');

App({
  onLaunch() {
    cloud.initCloud();
    data.init();
    // 云端会以微信 OPENID 识别当前用户，并为首次使用者分配唯一 UID。
    cloud.bootstrap(data.getProfile()).then(result => {
      if (result && !result.error && result.profile) {
        // 只更新缓存，不在启动时把旧缓存再次写回云端。
        if (!data.hasPendingProfile()) data.applyCloudProfile(result.profile);
        else data.refreshCurrentProfileAsync();
        data.hydrateOwnCloudState();
        // 首次登录福利邮件在云端幂等创建；同时顺带查补可能遗漏推送的待发货订单。
        cloud.getInventory();
        cloud.reconcilePayments();
      }
    });
  },
  globalData: {
    brandName: appConfig.brandName
  }
});
