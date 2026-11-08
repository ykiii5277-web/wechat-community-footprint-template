// 道具目录是前端展示用的镜像；道具仅通过任务、邮箱、榜单和开发者福利获得。
const items = [
  { id: 'heart', name: '爱心', image: '/assets/images/virtual-items/heart.jpg', affection: 1, affectionText: '每个可增加 1 点好友好感度', intro: '赠送后增加 1 点好感度。' },
  { id: 'star', name: '星星', image: '/assets/images/virtual-items/star.jpg', affection: 3, affectionText: '每个可增加 3 点好友好感度', intro: '赠送后增加 3 点好感度。' },
  { id: 'envelope', name: '信封', image: '/assets/images/virtual-items/envelope.jpg', affection: 5, affectionText: '每个可增加 5 点好友好感度', intro: '赠送后增加 5 点好感度，可附写 3000 字以内的话。' },
  { id: 'gift_box', name: '礼盒', image: '/assets/images/virtual-items/gift-box.jpg', affectionMin: 1, affectionMax: 10, affectionText: '随机增加 1–10 点好感，并有概率开出额外道具', intro: '赠送后随机增加 1–10 点好感度，并可能额外开出爱心、星星或信封。' },
  { id: 'memory_book', name: '纪念册', image: '/assets/images/virtual-items/memory-book.jpg', affection: 520, affectionText: '每个可增加 520 点好友好感度', intro: '年榜与开发者奖励道具，可写 5000 字并附 9 张图片，赠送后增加 520 点好感度。' },
  { id: 'mooncake', name: '月饼', image: '/assets/images/virtual-items/mooncake.jpg', affectionMin: 1, affectionMax: 5, affectionText: '每个可随机增加 1–5 点好友好感度', intro: '开发者限定道具，赠送后随机增加 1–5 点好感度。' },
  { id: 'red_packet', name: '红包', image: '/assets/images/virtual-items/red-packet.jpg', affectionMin: 1, affectionMax: 10, affectionText: '每个可随机增加 1–10 点好友好感度', intro: '开发者限定道具，赠送后随机增加 1–10 点好感度。' }
];

function getItem(id) { return items.find(item => item.id === id); }
function withCounts(counts = {}, received = {}) { return items.map(item => Object.assign({}, item, { count: Number(counts[item.id]) || 0, received: Number(received[item.id]) || 0 })); }
function receivedGroups(received = {}) {
  const counted = withCounts({}, received);
  return {
    primary: ['heart', 'star', 'envelope', 'gift_box'].map(id => counted.find(item => item.id === id)),
    other: counted.filter(item => ['heart', 'star', 'envelope', 'gift_box'].indexOf(item.id) < 0 && item.received > 0)
  };
}

module.exports = { items, getItem, withCounts, receivedGroups };
