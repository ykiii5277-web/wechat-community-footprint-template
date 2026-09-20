// 页面跳转工具：query/contextFrom 负责把营地上下文带到下一个页面。
function go(url) { wx.navigateTo({ url }); }
function back() { wx.navigateBack({ delta: 1 }); }
// 开发者工具不会在所有跳转层级自动解码 query。活动名称经过多页传递时可能变成
// %E4... 甚至 %25E4...；这里最多连续解码三次，兼容已经写入的旧数据。
function decode(value) {
  let result = String(value || '');
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(result);
      if (next === result) break;
      result = next;
    } catch (error) { break; }
  }
  return result;
}
function query(context) {
  const pairs = Object.keys(context || {}).filter(key => context[key]).map(key => `${key}=${encodeURIComponent(context[key])}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}
function contextFrom(options) { return { campId: decode(options.campId), stageId: decode(options.stageId), subcampId: decode(options.subcampId), activityName: decode(options.activityName) }; }
module.exports = { go, back, query, contextFrom, decode };
