// Public template configuration. Do not put AppSecret, payment AppKey, OPENID or
// other credentials in this file. Secrets belong in cloud-function environment variables.
module.exports = {
  brandName: '同行足迹',
  brandSlogan: '记录同行时光，收藏共同成长',
  cloudEnvId: '', // Fill in your CloudBase environment ID, e.g. cloud1-xxxxxxxx.
  cloudFunctionName: 'hui-api', // Kept for compatibility; you may rename it before deployment.
  storagePrefix: 'community-footprint'
};

