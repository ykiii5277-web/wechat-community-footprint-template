const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
function load(file, dependencies, extra = {}) {
  let page;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { module, exports: module.exports, Page: value => { page = value; }, setTimeout() {}, ...extra,
    require(name) { assert(name in dependencies, name); return dependencies[name]; }
  });
  if (!page) return module.exports;
  page.data = JSON.parse(JSON.stringify(page.data)); page.setData = value => Object.assign(page.data, value);
  return page;
}
async function main() {
  const storage = new Map(); let uid = '1234567', rejectStorage = false;
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => { if (rejectStorage) throw Error('quota'); storage.set(key, value); }, removeStorageSync: key => storage.delete(key), showToast() {}, showModal() {}, showLoading() {}, hideLoading() {}, navigateBack() {} };
  const data = { getProfile: () => ({ uid }), getFriendAsync: async () => ({uid:'7654321',name:'friend'}) };
  const deps = { './data': data, './cloud-service': { CLOUD_ENV_ID: 'env' } };
  const intents = load('utils/request-intent.js', deps, { wx });
  const first = intents.begin('gift_heart', { toUid: '7654321', quantity: 1 });
  const reloaded = load('utils/request-intent.js', deps, { wx });
  assert.equal(reloaded.begin('gift_heart', { toUid: '7654321', quantity: 1 }).requestId, first.requestId);
  uid = '7654321'; assert.equal(reloaded.read('gift_heart'), null); uid = '1234567';
  const second = intents.begin('gift_heart', { toUid: '7654321', quantity: 2 });
  intents.complete(first); assert.equal(intents.read('gift_heart').requestId, second.requestId, 'late completion must not erase newer intent');
  intents.complete(second); assert.equal(intents.read('gift_heart'), null);
  rejectStorage = true; assert.throws(() => intents.begin('gift_heart', { quantity: 1 }), /quota/); rejectStorage = false;

  const giftPayload = {toUid:'7654321',itemId:'heart',quantity:1,message:'',images:[]};
  const lostGift = intents.begin('gift_heart',giftPayload); let sentGift;
  const giftCloud = { getInventory: async()=>({wallet:{items:{heart:0}}}), getFriends:async()=>({friends:[]}), sendGift:async payload=>{sentGift=payload;return {sent:true};} };
  const gift = load('pages/profile/gift.js', {
    '../../utils/cloud-service':giftCloud, '../../utils/virtual-items':{getItem:()=>({id:'heart'})}, '../../utils/privacy':{},
    '../../utils/request-intent':intents, '../../utils/actions':{ready:async()=>{}}
  },{wx});
  await gift.onLoad({item:'heart'});assert.equal(gift.data.count,0);assert(gift.data.pending);
  await gift.send();assert.equal(sentGift.requestId,lostGift.requestId);assert.equal(intents.read('gift_heart'),null);

  let requests=[],offline=true;
  const chatCloud={ getChatMessages:async(uid,before,version)=>version==='latest'&&!before
    ? {unchanged:true,version,markedRead:0}
    : {messages:before?[{id:'m0',body:'old',createdAt:0}]:[{id:'m2',body:'new',createdAt:2},{id:'m1',body:'first',createdAt:1}],hasMore:!before,before:{time:1,id:'m1'},version:before?'':'latest'},
    sendChatMessage:async(uid,body,requestId)=>{requests.push(requestId);return offline?{error:'offline'}:{message:{id:'confirmed'}};}
  };
  const chat = load('pages/friends/chat.js',{'../../utils/cloud-service':chatCloud,'../../utils/data':data,'../../utils/request-intent':intents,'../../utils/actions':{ready:async()=>{}}},{wx,setInterval(){},clearInterval(){}});
  chat.uid='7654321';chat._alive=true;
  await chat.refresh();await chat.loadOlder();assert.equal(chat.data.messages.length,3);
  const renderedMessages=chat.data.messages;
  await chat.refresh();assert.strictEqual(chat.data.messages,renderedMessages,'unchanged polling must keep history and avoid rerendering');
  chat.data.body='hello';await chat.send();assert.equal(chat.data.body,'hello');
  offline=false;await chat.send();assert.equal(requests[0],requests[1]);assert.equal(chat.data.body,'');assert.equal(intents.read('chat_7654321'),null);
  console.log('intent persistence/account isolation/storage failures; zero-stock lost gift receipt; chat history merge and send retry passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
