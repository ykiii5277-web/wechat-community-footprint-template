// Regression tests: all SDK, media and database operations use isolated in-memory fixtures.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
function memory(seed = {}) {
  const tables = clone(seed);
  const command = { inc: value => ({ increment: value }), in: values => ({ includes: values }), nin: values => ({ excludes: values }), lt: value => ({ lessThan: value }) };
  function collection(name) {
    const rows = tables[name] || (tables[name] = []);
    const matches = (row, filter) => Object.entries(filter).every(([key, value]) => value && Array.isArray(value.excludes) ? !value.excludes.includes(row[key]) : value && Object.prototype.hasOwnProperty.call(value, 'lessThan') ? row[key] < value.lessThan : value && Array.isArray(value.includes) ? value.includes.some(v => (row[key] || []).includes(v)) : row[key] === value);
    const update = (row, values) => Object.entries(values).forEach(([key, value]) => {
      const parts = key.split('.'); let node = row;
      parts.slice(0, -1).forEach(part => { node = node[part] || (node[part] = {}); });
      const last = parts[parts.length - 1];
      node[last] = value && typeof value.increment === 'number' ? (Number(node[last]) || 0) + value.increment : clone(value);
    });
    function query(filter = {}, offset = 0, size = 100, ordering = [], fields) {
      const project = row => {
        if (!fields) return row;
        const result = { _id: row._id };
        for (const key of Object.keys(fields)) {
          const parts = key.split('.'), value = parts.reduce((node, part) => node && node[part], row);
          if (value === undefined) continue;
          let node = result;
          parts.slice(0, -1).forEach(part => { node = node[part] || (node[part] = {}); });
          node[parts.at(-1)] = value;
        }
        return result;
      };
      return {
        where: value => query(value, offset, size, ordering, fields), skip: value => query(filter, value, size, ordering, fields), limit: value => query(filter, offset, value, ordering, fields), orderBy: (key, direction) => query(filter, offset, size, ordering.concat([[key, direction]]), fields), field: value => query(filter, offset, size, ordering, value),
        count: async () => ({ total: rows.filter(row => matches(row, filter)).length }),
        get: async () => ({ data: clone(rows.filter(row => matches(row, filter)).sort((a,b) => { for(const [key,direction] of ordering) { const value=a[key]===b[key]?0:a[key]<b[key]?-1:1; if(value) return direction==='desc'?-value:value; } return 0; }).slice(offset, offset + size).map(project)) })
      };
    }
    return Object.assign(query(), {
      add: async ({ data }) => { const id = `${name}-${rows.length}`; rows.push(Object.assign({ _id: id }, clone(data))); return { _id: id }; },
      doc: id => ({
        get: async () => { const row = rows.find(x => x._id === id); if (!row) throw Error('not found'); return { data: clone(row) }; },
        set: async ({ data }) => { const old = rows.findIndex(x => x._id === id); const row = Object.assign({ _id: id }, clone(data)); if (old >= 0) rows[old] = row; else rows.push(row); },
        update: async ({ data }) => { const row = rows.find(x => x._id === id); assert(row); update(row, data); },
        remove: async () => { const index = rows.findIndex(x => x._id === id); if (index >= 0) rows.splice(index, 1); }
      })
    });
  }
  let tail = Promise.resolve();
  const db = { collection, command, createCollection: async name => { if(tables[name]) throw Error('already exists'); tables[name]=[]; },
    runTransaction(callback) {
      const task=tail.then(async()=> { const previous=clone(tables); try { return await callback(db); } catch(error) { Object.keys(tables).forEach(key=>delete tables[key]);Object.assign(tables,previous);throw error; } });
      tail=task.catch(()=>{});return task;
    }
  };
  return { db, tables };
}
function load(seed = {}, overrides = '', injected = {}) {
  const store = memory(seed), checks = [], commits = [];
  const sdk = { init() {}, database: () => store.db, openapi: { security: {
    msgSecCheck: async () => { checks.push('text'); return { errCode: 0 }; },
    imgSecCheck: async () => { checks.push('image'); return { errCode: 0 }; }
  } } };
  const module = { exports: {} };
  const dependencies = {
    'wx-server-sdk': sdk, crypto: require('crypto'), url: require('url'), https: { get(url, callback) { const EventEmitter=require('events'); const request=new EventEmitter(); request.setTimeout=()=>{};request.destroy=error=>request.emit('error',error); const response=new EventEmitter();response.statusCode=200;response.headers={};response.resume=()=>{};queueMicrotask(()=>{callback(response);response.emit('data',Buffer.from('image'));response.emit('end');});return request; } },
    './media-files': Object.assign({}, require('../cloudfunctions/hui-api/media-files'), { storedFileSize: async () => 1000 }),
    './content-manager': { createManager: () => ({ commit: async (...args) => commits.push(args) }) },
    './friend-management': { createFriendManager: () => ({}) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/hui-api/index.js'), 'utf8') + '\n' + overrides + `
    module.exports = { canReadContent, imageBuffer, checkImageSafety, upsertContent, likeContent, viewContent,
      chatList, chatUnread, friendBadge, adminStatus, taskStatus, loadPublicContents, awardRankingPeriod, giftSend, createUid, ownProfile, markDailyTask, pendingWorkReviews, reviewWork, ownWorks, exposeContent, mailList, chatSend, publicList, likeComment, acceptRequest, publicYears };
  `, { module, exports: module.exports, Buffer, process, console: { warn() {} }, ...injected,
    require(name) { assert(name in dependencies, `unexpected dependency ${name}`); return dependencies[name]; }
  });
  return Object.assign(store, { api: module.exports, checks, commits });
}
const results=[];
async function test(name,fn){await fn();results.push(name);console.log('PASS '+name);}
async function main(){
  await test('drafts and unapproved public attachments are author-only, with normal access for friends-only works',async()=>{
    const {api}=load({},'friendship=async actor=>actor==="friend"?{}:null;');
    for(const visibility of ['public','friends','self']){
      assert.equal(await api.canReadContent('other',{ownerOpenid:'owner',visibility,status:'draft'}),false);
      for(const reviewStatus of ['pending','rejected',undefined]){
        const record={kind:'work',ownerOpenid:'owner',visibility,status:'published',reviewStatus,payload:{filePath:'cloud://video'}};
        assert.equal(await api.canReadContent('other',record),false);
        assert.equal(await api.canReadContent('friend',record),visibility==='friends');
      }
      assert.equal(await api.canReadContent('owner',{kind:'work',ownerOpenid:'owner',visibility,status:'draft',payload:{filePath:'cloud://video'}}),true);
      assert.equal(await api.canReadContent('friend',{kind:'work',ownerOpenid:'owner',visibility,status:'published',reviewStatus:'approved',payload:{filePath:'cloud://video'}}),visibility!=='self');
    }
  });
  await test('HTTPS module works, trusted origins only, HTTP never skipped',async()=>{
    const {api,checks}=load();
    assert.equal((await api.imageBuffer('https://bucket.tcb.qcloud.la/photo.jpg')).toString(),'image');
    await assert.rejects(api.imageBuffer('https://example.test/photo.jpg'),/UNTRUSTED_MEDIA_SOURCE/);
    await assert.rejects(api.checkImageSafety(['http://example.test/photo.jpg']));
    await api.checkImageSafety(['https://bucket.tcb.qcloud.la/photo.jpg']);assert.equal(checks.filter(x=>x==='image').length,1);
  });
  await test('image attachments checked; video/document held for review',async()=>{
    const calls=[];
    const {api,commits}=load({},`ownProfile=async()=>({uid:'1234567'});findContent=async()=>null;checkSubmission=async(o,t,i)=>securityCalls.push(i);`,{securityCalls:calls});
    for(const [name,type] of [['picture.jpg','image'],['video.mp4','video'],['report.pdf','file']]){
      await api.upsertContent('owner',{kind:'work',item:{id:name,title:'test',filePath:'cloud://test/'+name,fileName:name,mediaType:type,visibility:'public'}});
      const record=commits.at(-1)[1][0].record;
      assert.equal(record.reviewStatus,type==='image'?'approved':'pending');
      assert.equal(calls.at(-1).filter(Boolean).length,type==='image'?1:0);
    }
    await assert.rejects(api.upsertContent('owner',{kind:'photo',item:{id:'bad',image:'http://example.test/a.jpg'}}),/UNTRUSTED_MEDIA_SOURCE/);
  });
  await test('101 likes: correct unlike, deduplicate historical relations, desired-state retry',async()=>{
    const likes=Array.from({length:101},(_,i)=>({_id:'like'+i,contentRef:'content',actorOpenid:'viewer'+i}));
    const {api,tables}=load({hui_likes:likes,hui_contents:[{_id:'content',likes:101,visibility:'public'}]},`findContent=async()=>({_id:'content',ownerOpenid:'owner',visibility:'public'});markDailyTask=async()=>{};`);
    assert.equal((await api.likeContent('viewer100',{})).favorite,false);
    assert.equal(tables.hui_likes.filter(x=>x.actorOpenid==='viewer100').length,0);
    assert.equal(tables.hui_contents[0].likes,100);
    await Promise.all([api.likeContent('new',{favorite:true}),api.likeContent('new',{favorite:true})]);
    assert.equal(tables.hui_contents[0].likes,101);
    assert.equal(tables.hui_likes.filter(x=>x.actorOpenid==='new').length,1);
  });
  await test('101 viewers and simultaneous requests respect five-minute throttle',async()=>{
    const views=Array.from({length:101},(_,i)=>({_id:'v'+i,contentRef:'content',viewerOpenid:'viewer'+i,lastViewedAt:Date.now()}));
    const {api,tables}=load({hui_content_views:views,hui_contents:[{_id:'content',views:101,visibility:'public'}]},`findContent=async()=>({_id:'content',ownerOpenid:'owner',visibility:'public'});markDailyTask=async()=>{};`);
    assert.equal((await api.viewContent('viewer100',{})).counted,false);
    await Promise.all([api.viewContent('new',{}),api.viewContent('new',{})]);assert.equal(tables.hui_contents[0].views,102);
  });
  await test('chat latest page + history cursor covers 205 messages including timestamp ties',async()=>{
    const rows=Array.from({length:205},(_,i)=>({_id:'m'+String(i).padStart(3,'0'),conversationId:'a:b',senderOpenid:'a',receiverOpenid:'b',createdAt:Math.floor(i/3),body:'message'+i,readAt:0}));
    const {api,tables}=load({hui_chat_messages:rows},`chatTarget=async()=>({target:{_id:'b',uid:'7654321'},relation:{remarks:{a:'备注'}}});profilesByOpenids=async()=>({});`);
    let response=await api.chatList('a',{}),all=response.messages;
    assert.equal(all.at(-1).id,'m204');assert(response.hasMore);
    assert.equal(response.friend.remark,'备注');
    const snapshot=await api.chatList('a',{version:response.version});
    assert.equal(snapshot.unchanged,true);assert(!snapshot.messages);
    assert(JSON.stringify(snapshot).length<JSON.stringify(response).length/10);
    while(response.hasMore){response=await api.chatList('a',{before:response.before});all=all.concat(response.messages);}
    assert.equal(all.length,205);assert.equal(new Set(all.map(x=>x.id)).size,205);
    const beforeNew=await api.chatList('a',{});
    tables.hui_chat_messages.push({_id:'next',conversationId:'a:b',senderOpenid:'b',receiverOpenid:'a',createdAt:999,body:'new',readAt:0});
    const afterNew=await api.chatList('a',{version:beforeNew.version});
    assert.equal(afterNew.messages.at(-1).id,'next');assert.equal(afterNew.markedRead,1);
    assert.notEqual(afterNew.version,beforeNew.version);
  });
  await test('bottom badge counts incoming requests and unread messages only from current friends',async()=>{
    const {api}=load({
      hui_friend_requests:[{_id:'one',toOpenid:'a',status:'pending'},{_id:'done',toOpenid:'a',status:'accepted'},{_id:'other',toOpenid:'b',status:'pending'}],
      hui_friendships:[{_id:'friend',members:['a','b']}],
      hui_chat_messages:[{_id:'unread',receiverOpenid:'a',senderOpenid:'b',readAt:0},{_id:'old',receiverOpenid:'a',senderOpenid:'b',readAt:1},{_id:'stranger',receiverOpenid:'a',senderOpenid:'c',readAt:0}]
    },'profilesByOpenids=async()=>{throw Error("badge must not load sender profiles");};');
    assert.equal((await api.friendBadge('a')).count,2);
  });
  await test('weekly task ignores 100 older days; concurrent progress merges',async()=>{
    const old=Array.from({length:100},(_,i)=>({_id:'old'+i,openid:'owner',weekKey:'old',allComplete:true}));
    const fresh=Array.from({length:4},(_,i)=>({_id:'new'+i,openid:'owner',weekKey:'current',allComplete:true}));
    const {api}=load({hui_daily_tasks:old.concat(fresh)},`ensureDailyTask=async()=>({weekKey:'current',progress:{login:true}});ensureWallet=async()=>({});`);
    assert.equal((await api.taskStatus('owner')).weekly.daysCompleted,4);
    const second=load({hui_daily_tasks:[{_id:'day',progress:{login:true,view:false,like:false}}]},`ensureDailyTask=async()=> (await db.collection(COLLECTIONS.dailyTasks).doc('day').get()).data;`);
    await Promise.all([second.api.markDailyTask('owner','view'),second.api.markDailyTask('owner','like')]);
    assert(second.tables.hui_daily_tasks[0].allComplete);
  });
  await test('all 1001 public records are included',async()=>{
    const {api}=load({hui_contents:Array.from({length:1001},(_,i)=>({_id:'c'+i,visibility:'public',status:'published',commentCount:0}))});
    assert.equal((await api.loadPublicContents()).length,1001);
  });
  await test('reward snapshot freezes ranks across concurrent runs and retry',async()=>{
    const {api,tables}=load({hui_profiles:[{_id:'a'},{_id:'b'}]});const a={ownerOpenid:'a',views:20,publishedAt:1},b={ownerOpenid:'b',views:10,publishedAt:2};
    const rewards=[{itemId:'star',quantity:3},{itemId:'star',quantity:2}];
    await Promise.all([api.awardRankingPeriod('day','period',[a,b],rewards),api.awardRankingPeriod('day','period',[a,b],rewards)]);
    b.views=30;await api.awardRankingPeriod('day','period',[a,b],rewards);
    assert.equal(tables.hui_mailbox.length,2);assert.equal(tables.hui_mailbox.find(x=>x.recipientOpenid==='a').quantity,3);
    const legacy=load({hui_mailbox:[{_id:'rank_day_old_1_a',type:'ranking_reward',recipientOpenid:'a',status:'claimed'}]});
    await legacy.api.awardRankingPeriod('day','old',[b,a],rewards);assert.equal(legacy.tables.hui_mailbox.length,1);
  });
  await test('gift lost-receipt retry consumes once and rejects changed intent',async()=>{
    const {api,tables}=load({hui_item_wallets:[{_id:'sender',items:{heart:5},received:{}},{_id:'receiver',items:{},received:{}}]},`profileByUid=async()=>({_id:'receiver',uid:'7654321'});ownProfile=async()=>({uid:'1234567'});checkSubmission=async()=>{};ensureWallet=async()=>({});friendship=async()=>null;`);
    const request={toUid:'7654321',itemId:'heart',quantity:1,requestId:'request-123'};
    const [a,b]=await Promise.all([api.giftSend('sender',request),api.giftSend('sender',request)]);
    assert.equal(a.giftId,b.giftId);assert.equal(tables.hui_item_wallets[0].items.heart,4);assert.equal(tables.hui_item_gifts.length,1);
    await assert.rejects(api.giftSend('sender',{...request,quantity:2}),/CONTENT_CONFLICT/);
  });
  await test('atomic UID reservation and same-account profile creation',async()=>{
    const {api,tables}=load();const [a,b]=await Promise.all([api.createUid('a'),api.createUid('b')]);assert.notEqual(a,b);
    assert.equal(await api.createUid('a'),a);
    const created=await Promise.all([api.ownProfile('same',{}),api.ownProfile('same',{})]);assert.equal(created[0].uid,created[1].uid);assert.equal(tables.hui_profiles.filter(x=>x._id==='same').length,1);
  });
  await test('chat retry creates only one message',async()=>{
    const {api,tables}=load({},`chatTarget=async()=>({target:{_id:'b',uid:'7654321'},relation:{}});ownProfile=async()=>({uid:'1234567'});checkTextSafety=async()=>{};`);
    const request={body:'hello',requestId:'request-123'};await Promise.all([api.chatSend('a',request),api.chatSend('a',request)]);assert.equal(tables.hui_chat_messages.length,1);
  });
  await test('review queue and approvals accept only pending public submissions',async()=>{
    const record={_id:'w',kind:'work',contentId:'w',ownerOpenid:'owner',visibility:'public',status:'published',reviewStatus:'pending',updatedAt:1,payload:{filePath:'cloud://test/report.pdf',fileName:'report.pdf'}};
    const friendsWork={...record,_id:'friends',visibility:'friends'};
    const {api,tables}=load({hui_contents:[record,friendsWork],hui_profiles:[{_id:'owner',contentRevision:0}]},`requireAdmin=async owner=>{if(owner!=='admin')throw Error('ADMIN_FORBIDDEN');};friendship=async owner=>owner==='friend'?{}:null;`);
    assert.deepEqual(Array.from((await api.pendingWorkReviews('admin')).items,item=>item.recordId),['w']);
    await assert.rejects(api.reviewWork('other',{recordId:'w',updatedAt:1,decision:'approved'}),/ADMIN_FORBIDDEN/);
    await assert.rejects(api.reviewWork('admin',{recordId:'w',updatedAt:0,decision:'approved'}),/CONTENT_CONFLICT/);
    await assert.rejects(api.reviewWork('admin',{recordId:'friends',updatedAt:1,decision:'approved'}),/INVALID_REVIEW/);
    await api.reviewWork('admin',{recordId:'w',updatedAt:1,decision:'approved'});
    assert.equal((tables.hui_mailbox || []).length,0,'Approval must not send a rejection notice');
    assert.equal(await api.canReadContent('stranger',tables.hui_contents[0]),true);
    assert.equal(await api.canReadContent('stranger',tables.hui_contents[1]),false);
    assert.equal((await api.pendingWorkReviews('admin')).items.length,0);
  });
  await test('reviewer badges match the pending queue, cover multiple batches and clear after moderation',async()=>{
    const base={kind:'work',contentId:'work',ownerOpenid:'owner',visibility:'public',status:'published',reviewStatus:'pending',updatedAt:1,payload:{filePath:'cloud://test/video.mp4',fileName:'video.mp4'}};
    const records=Array.from({length:110},(_,i)=>({...base,_id:'pending-'+i,contentId:'pending-'+i}));
    records.push({...base,_id:'legacy',reviewStatus:undefined});
    for(const visibility of ['self','friends'])records.push({...base,_id:visibility,visibility});
    for(const reviewStatus of ['approved','rejected'])records.push({...base,_id:reviewStatus,reviewStatus});
    records.push({...base,_id:'draft',status:'draft'},{...base,_id:'payload-draft',payload:{...base.payload,status:'draft'}},
      {...base,_id:'image',payload:{filePath:'cloud://test/photo.jpg',fileName:'photo.jpg'}},{...base,_id:'empty',payload:{}},
      {...base,_id:'other-kind',kind:'growth'});
    const {api,tables}=load({hui_contents:records,hui_profiles:[{_id:'admin',isAdmin:true},{_id:'owner',contentRevision:0}]});
    assert.equal((await api.friendBadge('owner')).reviewCount,0);
    assert.equal((await api.adminStatus('owner')).pendingWorkCount,0);
    assert.equal((await api.friendBadge('admin')).reviewCount,111);
    assert.equal((await api.adminStatus('admin')).pendingWorkCount,111);
    assert.equal((await api.pendingWorkReviews('admin')).items.length,111);
    await api.reviewWork('admin',{recordId:'pending-0',updatedAt:1,decision:'approved'});
    assert.equal((await api.friendBadge('admin')).reviewCount,110);
    await api.reviewWork('admin',{recordId:'pending-1',updatedAt:1,decision:'rejected'});
    assert.equal((await api.friendBadge('admin')).reviewCount,109);
    tables.hui_contents.forEach(row=>{if(row.reviewStatus!=='approved')row.reviewStatus='rejected';});
    assert.equal((await api.friendBadge('admin')).reviewCount,0);
    const restricted=load({},'countPendingWorkReviews=async()=>{throw Error("ordinary users must not query reviews");};');
    assert.equal((await restricted.api.friendBadge('ordinary')).reviewCount,0);
  });
  await test('rejected work sends a private mailbox notice with optional reason, once per submission',async()=>{
    for(const reason of ['  请补充可正常打开的完整附件。\n当前文件缺页。  ','   ']){
      const record={_id:'w',kind:'work',contentId:'logical-w',ownerOpenid:'owner',visibility:'public',status:'published',reviewStatus:'pending',updatedAt:1,payload:{title:'营地记录',filePath:'cloud://test/report.pdf',fileName:'report.pdf'}};
      const {api,tables}=load({hui_contents:[record],hui_profiles:[{_id:'owner',contentRevision:0}]},`requireAdmin=async actor=>{if(actor!=='admin')throw Error('ADMIN_FORBIDDEN');};`);
      const request={recordId:'w',updatedAt:1,decision:'rejected',reason,recipientOpenid:'intruder'};
      await assert.rejects(api.reviewWork('other',request),/ADMIN_FORBIDDEN/);
      await assert.rejects(api.reviewWork('admin',{...request,reason:'字'.repeat(201)}),/REVIEW_REASON_TOO_LONG/);
      assert.equal((tables.hui_mailbox || []).length,0);
      const concurrent=await Promise.allSettled([api.reviewWork('admin',request),api.reviewWork('admin',request)]);
      assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(tables.hui_mailbox.length,1);
      const mail=tables.hui_mailbox[0];
      assert.equal(mail.recipientOpenid,'owner');assert.equal(mail.type,'work_review');
      assert.equal(mail.status,'message');assert(!mail.readAt);assert(!mail.itemId);
      const expectedReason=reason.trim()||'您上传的内容不符合小程序规范，具体规范请查询“我的”栏下的“安全与协议”，修改后可自行重新提交。';
      assert.equal(mail.contentId,'logical-w');assert.equal(mail.reviewReason,expectedReason);
      assert(mail.body.includes('《营地记录》'));assert(mail.body.includes('不通过原因：'+expectedReason));
      assert.equal(mail.reviewIntro,'你提交的作品《营地记录》未通过公开审核，当前仅自己可见。');
      assert.equal(mail.reviewAdvice,reason.trim()?'可修改作品后重新提交审核。':'');
      assert.equal(tables.hui_contents[0].reviewStatus,'rejected');
      assert.equal(tables.hui_contents[0].visibility,'self');
      assert.equal(tables.hui_contents[0].payload.visibility,'self');
      const own=(await api.ownWorks('owner')).works[0];
      assert.equal(own.visibility,'self');assert.equal(own.reviewStatus,'rejected');
      assert.equal(await api.canReadContent('intruder',tables.hui_contents[0]),false);
      assert.equal(tables.hui_contents[0].reviewReason,expectedReason);
      assert.equal(tables.hui_profiles[0].contentRevision,1);
      const received=(await api.mailList('owner')).mails;
      assert.equal(received.length,1);assert.equal(received[0].reviewReason,expectedReason);
      // 旧通知同样获得默认原因或保留原有手填原因，不改写已读状态。
      tables.hui_mailbox[0].reviewReason=reason.trim();tables.hui_mailbox[0].readAt=123;
      const legacy=(await api.mailList('owner')).mails[0];
      assert.equal(legacy.reviewReason,expectedReason);assert.equal(legacy.readAt,123);
      assert.equal(tables.hui_mailbox[0].reviewReason,reason.trim());
      assert.equal((await api.mailList('intruder')).mails.length,0);
      await assert.rejects(api.reviewWork('admin',request));assert.equal(tables.hui_mailbox.length,1);
    }
  });
  await test('a failed rejection notice rolls back the review and can be retried',async()=>{
    const state={fail:true};
    const {api,tables}=load({hui_contents:[{_id:'w',kind:'work',contentId:'w',ownerOpenid:'owner',visibility:'public',status:'published',reviewStatus:'pending',updatedAt:1,payload:{title:'视频',filePath:'cloud://test/video.mp4',fileName:'video.mp4',mediaType:'video'}}],hui_profiles:[{_id:'owner',contentRevision:0}]},`
      requireAdmin=async()=>{};
      const originalTransaction=db.runTransaction.bind(db);
      db.runTransaction=callback=>originalTransaction(transaction=>callback({collection(name){
        const table=transaction.collection(name);
        if(name!==COLLECTIONS.mailbox)return table;
        return {doc(id){const ref=table.doc(id);return {...ref,set:async value=>{if(state.fail)throw Error('MAIL_WRITE_FAILED');return ref.set(value);}};}};
      }}));`,{state});
    const request={recordId:'w',updatedAt:1,decision:'rejected',reason:'附件无法播放'};
    await assert.rejects(api.reviewWork('admin',request),/MAIL_WRITE_FAILED/);
    assert.equal(tables.hui_contents[0].reviewStatus,'pending');assert.equal(tables.hui_profiles[0].contentRevision,0);
    assert.equal(tables.hui_contents[0].visibility,'public');
    assert.equal(tables.hui_contents[0].payload.visibility,undefined);
    assert.equal((tables.hui_mailbox||[]).length,0);
    state.fail=false;await api.reviewWork('admin',request);
    assert.equal(tables.hui_contents[0].reviewStatus,'rejected');assert.equal(tables.hui_mailbox.length,1);
    assert.equal(tables.hui_profiles[0].contentRevision,1);
  });
  await test('legacy rejected public works restore private editor values and can be resubmitted only by the owner',async()=>{
    const old={_id:'old',kind:'work',contentId:'old',ownerOpenid:'owner',visibility:'public',status:'published',reviewStatus:'rejected',updatedAt:1,payload:{id:'old',title:'作品',fileName:'test.mp4',filePath:'cloud://test/video.mp4',visibility:'public'}};
    const {api,tables,commits}=load({hui_contents:[old],hui_profiles:[{_id:'owner',uid:'1234567'},{_id:'another',uid:'7654321'}]},'ownProfile=async()=>({uid:"1234567"});checkSubmission=async()=>{};');
    const restored=(await api.ownWorks('owner')).works[0];
    assert.equal(restored.visibility,'self');assert.equal(restored.reviewStatus,'rejected');
    assert.equal((await api.ownWorks('another')).works.length,0);
    await api.upsertContent('owner',{kind:'work',item:{...restored,visibility:'public'}});
    assert.equal(commits.at(-1)[1][0].record.reviewStatus,'pending');
    assert.equal(commits.at(-1)[1][0].record.visibility,'public');
  });
  await test('visibility changes to public and replacement public attachments require fresh review',async()=>{
    const state={previous:null};
    const {api,commits}=load({},`ownProfile=async()=>({uid:'1234567'});findContent=async()=>state.previous;checkSubmission=async()=>{};friendship=async()=>({});`,{state});
    for (const [fileName,mediaType] of [['work.mp4','video'],['work.pdf','file']]) {
      state.previous=null;
      const work={id:fileName,title:'work',filePath:'cloud://test/'+fileName,fileName,mediaType};
      const save=async (visibility,changes={})=>{
        const response=await api.upsertContent('owner',{kind:'work',item:{...work,...changes,visibility}});
        state.previous=commits.at(-1)[1][0].record;
        return response;
      };
      assert.equal((await save('self')).reviewStatus,'approved');
      assert.equal(state.previous.reviewStatus,'not_required');
      assert.equal((await save('friends')).reviewStatus,'approved');
      assert.equal(await api.canReadContent('friend',state.previous),true);
      assert.equal((await save('public',{reviewStatus:'approved'})).reviewStatus,'pending');
      assert.equal(await api.canReadContent('friend',state.previous),false);
      assert.equal((await save('friends')).reviewStatus,'approved');
      assert.equal((await save('public')).reviewStatus,'pending');
      state.previous.reviewStatus='approved';
      assert.equal((await save('public',{title:'Edited title'})).reviewStatus,'approved');
      assert.equal((await save('public',{filePath:'cloud://test/other-'+fileName})).reviewStatus,'pending');
      assert.equal((await save('self')).reviewStatus,'approved');
      assert.equal(await api.canReadContent('friend',state.previous),false);
    }
  });
  await test('comment likes beyond 100 use atomic exact-actor state',async()=>{
    const {api,tables}=load({hui_contents:[{_id:'content',visibility:'public',ownerOpenid:'owner'}],hui_comments:[{_id:'comment',contentRef:'content',likes:101}],hui_likes:Array.from({length:101},(_,i)=>({_id:'l'+i,commentRef:'comment',actorOpenid:'viewer'+i}))});
    assert.equal((await api.likeComment('viewer100',{id:'comment'})).favorite,false);assert.equal(tables.hui_comments[0].likes,100);
    await Promise.all([api.likeComment('new',{id:'comment',favorite:true}),api.likeComment('new',{id:'comment',favorite:true})]);assert.equal(tables.hui_comments[0].likes,101);
  });
  await test('parallel friend acceptance and repeated receipt cannot duplicate/recreate relations',async()=>{
    const {api,tables}=load({hui_friend_requests:[{_id:'request',fromOpenid:'a',toOpenid:'b',status:'pending'}]});
    await Promise.all([api.acceptRequest('b',{id:'request'}),api.acceptRequest('b',{id:'request'})]);assert.equal(tables.hui_friendships.length,1);
    tables.hui_friendships.splice(0);await assert.rejects(api.acceptRequest('b',{id:'request'}),/REQUEST_NOT_FOUND/);
  });
  await test('publication month/year and ranking tie-break ignore mutable content dates',async()=>{
    const records=[{_id:'a',contentId:'a',ownerOpenid:'a',kind:'growth',visibility:'public',status:'published',views:1,publishedAt:Date.parse('2026-11-02T12:00:00Z'),updatedAt:999,payload:{date:'2024.01.01',title:'a'}},{_id:'b',contentId:'b',ownerOpenid:'b',kind:'growth',visibility:'public',status:'published',views:1,publishedAt:Date.parse('2026-11-03T12:00:00Z'),updatedAt:1,payload:{date:'2024.01.01',title:'b'}}];
    const {api}=load({},`loadPublicContents=async()=>recordsForTest;profilesByOpenids=async()=>({});resolveSharedContentList=async items=>items;`,{recordsForTest:records});
    const response=await api.publicList({range:'month',year:2026,month:11});assert.equal(response.items.length,2);assert.equal(response.items[0].id,records[1].contentId);
    const years=await api.publicYears();assert(years.years.includes(2026));assert(!years.years.includes(2024));
  });
  await test('deleted reward recipient is never recreated by a partial settlement retry',async()=>{
    const {api,tables}=load();await api.awardRankingPeriod('day','deleted',[{ownerOpenid:'gone',views:1}],[{itemId:'star',quantity:3}]);assert.equal((tables.hui_mailbox||[]).length,0);
  });
  console.log('TOTAL '+results.length+' priority regression groups passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
