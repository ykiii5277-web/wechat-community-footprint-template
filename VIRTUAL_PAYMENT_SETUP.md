# 个人主体虚拟支付部署与验收

本模板示例使用“道具直购”模式 `short_series_goods`。商店直接购买服务端白名单内的道具，不建立可充值、可提现或二次消费的代币余额。主体资质、开放范围和审核要求可能调整，部署前请以微信最新官方文档为准。

支付相关实现全部位于云函数 `cloudfunctions/hui-api`。AppSecret、沙箱 AppKey、现网 AppKey 不会写入仓库，也不会返回前端。

## 已实现的业务

- 爱心：1 元直购，赠送增加 1 好感度。
- 星星：3 元直购，赠送增加 3 好感度。
- 信封：5 元直购，可写最多 3000 字，赠送增加 5 好感度。
- 礼盒：5 元直购，随机增加 1–10 好感度，并可能开出额外道具。
- 纪念册：不可购买，只能由年榜或开发者邮箱发放；最多 5000 字、9 张图，赠送增加 520 好感度。
- 月饼：不可购买，只能由开发者邮箱发放；每个赠送时由云端随机增加 1–5 好感度。
- 红包：不可购买，只能由开发者邮箱发放；每个赠送时由云端随机增加 1–10 好感度。
- 每个新用户首次登录会收到一封含 2 个信封的福利邮件，领取后才进入背包；钱包和固定邮件 ID 以事务创建，重复登录不会重复发放。
- 每日登录、浏览他人内容、点赞他人内容各可领取 1 个爱心；北京时间每日刷新。
- 一周内有 4 天完成全部三项每日任务，可领取 1 个星星。
- 好友双方共享历史赠送形成的好感度；每 3 点升一级。赠送会消耗发送者背包库存，接收者只累计收礼数量，不获得可再次赠送的库存，避免循环赠送刷好感度。未加好友时只累计收礼和赠送记录，成为好友后自动补算，删除好友后隐藏等级但不删除记录。
- “我的”首页显示累计收到的各道具数量；好友列表和好友资料显示好感等级、称号与释义。
- 邮箱承载日/周/月/年榜奖励与开发者发放的奖励，用户领取后才进入背包。
- 热度公式统一为：`浏览数 × 1 + 点赞数 × 10 + 评论数 × 5`。
- 排行奖励定时任务按触发器每天执行，业务日期统一按北京时间计算：昨日榜首 1 星星；每周前三 3/2/1 星星；每月前三 6/4/2 信封；每年前三 3/2/1 纪念册。奖励邮件 ID 固定，重复执行不会重复发奖。
- 支付发货以微信服务端消息或主动查单为准，前端 `success` 只用于触发查单；订单与发货事件均做幂等处理。
- 查询到已支付未发货的订单后，云端发放道具并调用 `notify_provide_goods`；若消息丢失或确认失败，`huiPendingPaymentReconcile` 会每 5 分钟查补一次，用户下次启动也会主动查补。
- 退款通知会扣回背包中仍可扣除的购买道具；若道具已经赠出，会在订单中记录 `unrecoveredQuantity`，便于后台审计。

## 一次性云端配置

### 1. 准备独立密钥

在微信公众平台生成当前小程序自己的 AppSecret、沙箱 AppKey 和现网 AppKey。不要复制示例项目或他人的密钥；如果密钥曾出现在聊天、截图、日志或 Git 历史中，应先轮换再配置正式环境。

### 2. 创建数据库集合

在当前云环境创建以下集合，权限全部选择“仅云函数可读写”：

`hui_profiles`、`hui_contents`、`hui_friend_requests`、`hui_friendships`、`hui_likes`、`hui_comments`、`hui_content_views`、`hui_chat_messages`、`hui_reports`、`hui_item_wallets`、`hui_item_gifts`、`hui_daily_tasks`、`hui_weekly_claims`、`hui_mailbox`、`hui_pay_orders`、`hui_payment_events`、`hui_reward_runs`。

本实现只使用单字段查询，不依赖额外组合索引。生产数据增大后，可根据控制台的慢查询提示为 `openid`、`recipientOpenid`、`ownerOpenid`、`contentRef` 等字段增加普通索引。

### 3. 配置云函数环境变量

在云开发控制台打开 `hui-api` 的“版本与配置 / 环境变量”，填写：

| 变量名 | 沙箱阶段 | 正式阶段 |
| --- | --- | --- |
| `HUI_WX_APP_SECRET` | 新生成的 AppSecret | 新生成的 AppSecret |
| `HUI_PAY_SANDBOX_APP_KEY` | 新生成的沙箱 AppKey | 可保留 |
| `HUI_PAY_APP_KEY` | 新生成的现网 AppKey | 新生成的现网 AppKey |
| `HUI_PAY_ENV` | `1` | `0` |
| `HUI_WX_APP_ID` | 必填：自己的小程序 AppID | 必填：自己的小程序 AppID |
| `HUI_PAY_OFFER_ID` | 必填：自己的支付应用 ID | 必填：自己的支付应用 ID |

不要在 `project.config.json`、页面 JavaScript、`config.json` 或云函数源代码中写入前三项密钥。

### 4. 部署云函数和定时触发器

在开发者工具中右键 `cloudfunctions/hui-api`，选择“上传并部署：云端安装依赖”。部署后再次右键该函数，选择“上传触发器”，使 `config.json` 中的三个触发器生效：`huiDailyRewards` 每天 `01:15` 结算奖励，`huiPendingPaymentReconcile` 每 5 分钟补查待完成支付，`huiExpiredRewardCleanup` 每小时清理已过领取截止时间的开发者福利邮件。触发器时区以控制台标注为准；本函数内部会将奖励日期和领取截止日统一按北京时间计算。

仅上传代码包而未更新触发器时，购买与赠送可用，但榜单奖励不会自动发放。

### 5. 订阅支付消息推送

按微信个人主体虚拟支付接入页，在云开发中把小程序消息推送订阅到 `hui-api`，至少订阅：

- `xpay_goods_deliver_notify`：支付成功后的道具发货。
- `xpay_refund_notify`：退款后的道具回收与审计。

推送函数成功时返回 `{ "ErrCode": 0, "ErrMsg": "success" }`。不要把支付回调配置到普通前端页面，也不要仅凭 `wx.requestVirtualPayment` 的 success 回调发货。

### 6. 核对道具配置

微信公众平台“虚拟支付 / 道具管理”中的可购买道具必须与代码逐字一致：

| 商品 ID | 名称 | 单价 |
| --- | --- | --- |
| `heart` | 爱心 | 100 分 |
| `star` | 星星 | 300 分 |
| `envelope` | 信封 | 500 分 |
| `gift_box` | 礼盒 | 500 分 |

`memory_book`、`mooncake`、`red_packet` 不要配置成可购买道具。若你删除或新增商品，应同时修改前端目录、云端白名单、平台商品和验收用例。

### 7. 开发者通过邮箱赠予

单个用户的临时人工发放，可以在 `hui_mailbox` 新建文档，而不是直接改用户背包。推荐文档结构：

```json
{
  "recipientOpenid": "接收者资料文档的 _id/openid",
  "type": "developer_reward",
  "title": "开发者赠予",
  "body": "奖励说明",
  "itemId": "memory_book",
  "quantity": 1,
  "status": "pending",
  "expiresDate": "2030-12-31",
  "expiresAt": 1924963199999,
  "expiresPendingAt": 1924963199999,
  "createdAt": 0,
  "date": "YYYY-MM-DD"
}
```

`createdAt` 请填写当前毫秒时间戳。示例中的三个截止值仅用于说明字段格式，实际应改成同一个截止日，并建议直接通过“我的—开发者福利”页面生成，避免手算北京时间时间戳。用户在邮箱点击“领取”后，云函数事务会把道具放入背包并把邮件改为 `claimed`，可防止重复领取。过期仍未领取的开发者福利会由定时任务删除；用户打开邮箱或尝试领取时也会即时校验并清理。旧邮件如果没有截止字段，会继续保留，不会被自动删除。

需要向全部用户或指定 UID 发放时，先在开发者自己的 `hui_profiles` 文档中增加布尔字段 `isAdmin: true`，再使用“我的—开发者福利”。发放时必须选择领取截止日期，截止时刻为该日北京时间 23:59:59。全服模式会分批读取全部用户；指定 UID 模式只为该账号创建邮件。同一批次对同一用户可安全重试，不会重复发放；重试同一批次时应保持原截止日期不变。不要把 `recipientOpenid` 写成 `all`，也不要直接修改用户背包。

## 沙箱验收步骤

1. 将 `HUI_PAY_ENV` 设为 `1`，确认商店顶部显示“沙箱调试”。沙箱支付只用于开发版/体验版；不要把沙箱配置提交审核。
2. 新账号首次登录后，确认邮箱出现一封含 2 个信封的登录福利邮件；领取前背包不增加，领取后增加 2 个，重复进入、换设备、重新登录均不会再次发放。
3. 分别购买 `heart`、`star`、`envelope`。支付后检查 `hui_pay_orders`：订单最终为 `delivered`，且 `platformNotifiedAt` 有值；背包各只增加 1 个。
4. 对同一笔订单重复触发查单或重复发送发货推送，确认背包数量不再增加；`hui_payment_events` 只有一条有效发货记录。
5. 使用两个微信账号：非好友赠送一次，确认接收方的“累计收到”增加但好友好感不显示；随后加好友，确认历史赠送自动计入双方好感；删除好友后，收礼数量不变且好感等级不再展示。
6. 信封分别测试 3000 字和 3001 字；后者必须被拒绝。纪念册测试 9 张和 10 张图片；页面最多允许上传 9 张。
7. 完成每日三项任务并分别领取，确认各得到 1 个爱心；同一奖励重复点击不能重复领取。用四个不同日期完成全套任务后，周奖励只能领取 1 次。
8. 对一条公开内容进行浏览、点赞和评论，确认热度分别增加 1、10、5；同一用户 5 分钟内重复浏览不重复增加浏览热度。
9. 在测试数据上手动触发 `huiDailyRewards`，确认奖励以待领取邮件出现；重复触发不重复发奖。
10. 发起退款测试，确认订单改为 `refunded`；背包仍有该道具时扣回，已赠出时记录未追回数量。

## 正式环境切换

1. 将 `HUI_PAY_ENV` 改为 `0`，确认 `HUI_PAY_APP_KEY` 使用新生成的现网 AppKey。
2. 重新部署/重启 `hui-api`，商店顶部应显示“现网支付”。
3. 使用一笔最低金额真实订单做冒烟测试，逐项核对微信订单、`hui_pay_orders`、`hui_payment_events`、背包到账和平台发货确认。
4. 核对个人主体月交易限额、Android/iOS 服务费、iOS 小程序名称/IAP 配置及微信客户端版本要求。
5. 观察云函数日志至少 24 小时，重点搜索 `PAY_QUERY_FAILED`、`PAY_NOTIFY_FAILED`、`INVALID_DELIVERY`、`WECHAT_API_FAILED`。

## 部署前检查清单

### 代码与数据

- [ ] 已在云函数环境变量填写自己的 AppID 与 OfferID，并与平台配置对齐。
- [x] 支付密钥未写入客户端或仓库，服务端只从环境变量读取。
- [x] 使用 `short_series_goods` 道具直购，不实现代币充值钱包。
- [x] 商品 ID、价格、好感度由服务端白名单再次校验。
- [x] 订单号唯一，签名参数使用同一份原始 `signData` 字符串。
- [x] 发货与邮箱领取具有幂等控制，退款保留审计字段。
- [x] 主动查单与平台发货确认已实现。
- [x] 每日/每周任务、礼物历史补算、排行榜奖励与新热度公式已实现。
- [x] JavaScript 语法和项目 JSON 已完成本地静态检查。

### 云端与平台（发布前必须人工确认）

- [ ] AppSecret、沙箱 AppKey、现网 AppKey 均为当前项目的有效值，且未进入仓库。
- [ ] 已在自己的云环境创建全部 17 个数据库集合。
- [ ] 已在控制台把全部集合权限逐项确认成“仅云函数可读写”。
- [ ] 三个支付环境变量已使用轮换后的值配置，`HUI_PAY_ENV` 与测试阶段一致。
- [ ] `hui-api` 代码已上传并由云端安装依赖；背包和任务接口已在模拟器实际调用成功。
- [ ] 已在函数配置中把超时由当前的 3 秒改为 60 秒。
- [ ] `huiDailyRewards`、`huiPendingPaymentReconcile` 与 `huiExpiredRewardCleanup` 三个定时触发器均已在云端控制台可见。
- [ ] 已查看控制台标注的触发器时区，确认实际执行时间位于北京时间跨日以后。
- [ ] 两个虚拟支付消息事件已订阅到 `hui-api`，并完成一次回调日志验证。
- [ ] 微信后台三个商品 ID 与价格逐字核对无误。
- [ ] 沙箱完成支付、重复回调、主动查单、退款和双账号赠送测试。
- [ ] 正式环境完成最低金额真实支付及到账验证。
- [ ] iOS 名称/IAP、微信版本要求、交易限额和费率已按发布时最新官方规则复核。

未勾完“云端与平台”部分前，代码虽然已经具备接入逻辑，但不能视为已经完成可发布的支付验收。

## 官方文档

- 个人主体虚拟支付接入：<https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person>
- `wx.requestVirtualPayment`：<https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html>
- 查询订单：<https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order.html>
- 确认发货：<https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_notify_provide_goods.html>
- 云开发个人主体接入：<https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/wechatpay/ai-virtualpayl-person>
- 云函数定时触发器：<https://docs.cloudbase.net/cloud-function/timer-trigger>
