# 初学者阅读指南

WXML 决定页面结构，WXSS 决定样式，JavaScript 处理交互，JSON 声明组件和页面配置。先阅读 `README.md`、`CLOUD_SETUP.md`，再部署自己的云环境。

| 想了解什么 | 主要入口 |
| --- | --- |
| 启动与首次完善简介 | `app.js`、`utils/profile-onboarding.js` |
| 引导与分包 | `utils/feature-guide.js`、`app.json` |
| 环境与上传 | `config/app-config.js`、`utils/cloud-service.js` |
| 内容缓存 | `utils/data.js` |
| 提交、重试与账号隔离 | `utils/content-sync.js`、`utils/retry.js` |
| 云端权限和业务 | `cloudfunctions/hui-api/index.js` |
| 原子内容与批量操作 | `cloudfunctions/hui-api/content-manager.js` |
| 视频与全屏图片 | `utils/work-media.js`、`pages/media/image-viewer.js` |
| 审核同步 | `pages/profile/work-review.js`、`utils/work-review-sync.js` |

页面向云函数提交内容，服务端检查微信身份、权限、版本和安全结果，再写入数据库。正式列表只缓存云端确认的数据，未提交输入与失败请求单独保存。

选中文件后最初得到本机临时路径，上传成功取得 `cloud://` 文件 ID 后才可跨设备保存。能看到预览不代表上传完成。云端是正式来源，本地缓存用于加快浏览，未提交草稿不能保证跨设备恢复。

修改时同步处理页面初始值、输入、保存和后端字段白名单。权限必须在云端检查。刷新审核状态时避免覆盖正在编辑的表单。修改云函数需要单独部署，上传客户端不会自动创建集合或安装触发器。

运行 `npm run check`、`npm test` 后，再在开发者工具和真机验证。测试使用隔离内存与模拟接口，不包含生产用户数据。
