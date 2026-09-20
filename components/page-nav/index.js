// 可复用页头：接收标题和副标题，点击左侧按钮返回上一页。
Component({
  properties: { title: { type: String, value: '' }, subtitle: { type: String, value: '' } },
  methods: { back() { wx.navigateBack({ delta: 1 }); } }
});
