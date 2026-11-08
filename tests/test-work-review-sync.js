const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createSync } = require('../utils/content-sync');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const store = new Map();
  global.wx = { getStorageSync: key => store.has(key) ? copy(store.get(key)) : '',
    setStorageSync: (key, value) => store.set(key, copy(value)), removeStorageSync: key => store.delete(key) };
  const keys = Object.fromEntries(['profile','works','photos','growth','companions','folders','activities','favorites','comments','profilePending','pendingFolderDeletes'].map(key => [key,key]));
  const profile = { uid:'1234567',cacheKey:'account-a',syncVersion:2 };
  const work = { id:'work',title:'视频',body:'正文',campId:'rural',filePath:'cloud://work.mp4',fileName:'work.mp4',visibility:'public',reviewStatus:'pending',updatedAt:1 };
  let remote = [{...work,visibility:'self',reviewStatus:'rejected',updatedAt:2}], calls = 0, reply;
  const cloud = { CLOUD_ENV_ID:'review-sync-test',
    async call(action) { assert.equal(action,'state.works');calls++;return reply ? new Promise(resolve => { reply=resolve; }) : { works:copy(remote),cacheKey:'account-a' }; }
  };
  const sync = createSync({cloud,keys,init(){},today:()=> '2026.11.08',normalizeActivityName:value=>value||'',getProfile:()=>wx.getStorageSync('profile')||{}});
  sync.bindCloudAccount(profile);
  wx.setStorageSync('works',[work]);wx.setStorageSync('photos',[{id:'keep-photo'}]);
  sync.stageDraft('work',{...work,title:'未提交的修改'});
  assert.equal(await sync.refreshOwnWorks(),true);
  assert.equal(wx.getStorageSync('works')[0].visibility,'self');assert.equal(wx.getStorageSync('works')[0].reviewStatus,'rejected');
  assert.equal(wx.getStorageSync('photos')[0].id,'keep-photo');
  assert.equal(sync.getSyncStatus().items[0].item.title,'未提交的修改','review synchronization must preserve unsent user edits');
  assert.equal(await sync.refreshOwnWorks(),false,'identical remote state needs no rerender');
  reply=true;const first=sync.refreshOwnWorks(),second=sync.refreshOwnWorks();await tick();
  assert.strictEqual(first,second);assert.equal(calls,3,'multiple pages share one in-flight work request');
  reply({works:copy(remote),cacheKey:'account-a'});reply=null;await first;
  const original=cloud.call;
  cloud.call=async()=>({error:'CLOUD_CALL_FAILED',message:'offline'});
  await assert.rejects(sync.refreshOwnWorks(),/offline/);assert.equal(wx.getStorageSync('works')[0].updatedAt,2);
  cloud.call=async()=>({error:'UNKNOWN_ACTION'});cloud.getOwnState=async()=>({profile,works:copy(remote)});
  assert.equal(await sync.refreshOwnWorks(),false,'older deployments use the existing state API');
  cloud.call=original;reply=true;const old=sync.refreshOwnWorks();await tick();
  sync.bindCloudAccount({uid:'7654321',cacheKey:'account-b',syncVersion:2});wx.setStorageSync('works',[{id:'other-account'}]);
  reply({works:copy(remote),cacheKey:'account-a'});reply=null;
  await assert.rejects(old,/账号已切换/);assert.equal(wx.getStorageSync('works')[0].id,'other-account');

  let renderCount=0, pollCalls=0, resolvePoll;
  const timers = new Set();let pending=true;
  const controllerModule={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../utils/work-review-sync.js'),'utf8'), {
    module:controllerModule,require:()=>({getWorks:()=>pending?[work]:remote,
      refreshOwnWorks:async()=>{pollCalls++;return resolvePoll==='wait'?new Promise(resolve=>{resolvePoll=resolve;}):true;}}),
    setTimeout(callback){timers.add(callback);return callback;},clearTimeout(callback){timers.delete(callback);}
  });
  const controller=controllerModule.exports,page={};
  controller.start(page,()=>renderCount++);await tick();assert.equal(renderCount,1);assert.equal(timers.size,1);
  const timer=[...timers][0];timers.delete(timer);pending=false;await timer();assert.equal(renderCount,2);assert.equal(timers.size,0);
  resolvePoll='wait';controller.start(page,()=>renderCount++);await tick();controller.stop(page);resolvePoll(true);await tick();
  assert.equal(renderCount,2,'hidden pages ignore late work-state responses');assert.equal(timers.size,0);

  let editor;
  const choices=[{value:'public',name:'公开',hint:''},{value:'friends',name:'仅好友可见',hint:''},{value:'self',name:'仅自己可见',hint:''}];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/profile/work-editor.js'),'utf8'), {
    Page(value){editor=value;},require(name){
      if(name==='../../utils/actions')return {ready:async()=>{}};
      if(name==='../../utils/nav')return {contextFrom:()=>({}),decode:value=>value};
      if(name==='../../utils/work-media')return {isVideo:()=>false};
      if(name==='../../utils/data')return {refreshOwnWorks:async()=>{remote=[{...work,visibility:'self',reviewStatus:'rejected',updatedAt:2}];},
        camps:()=>[{id:'rural'}],getWork:()=>remote[0],visibilityOptions:()=>choices};
      return {};
    }
  });
  editor.data=copy(editor.data);editor.setData=value=>Object.assign(editor.data,value);
  await editor.onLoad({id:'work'});assert.equal(editor.data.visibilityName,'仅自己可见');assert.equal(editor.data.isPublic,false);assert.equal(editor._workVersion,2);
  console.log('PASS rejected work cache refresh, unsent edits, coalescing, offline/legacy handling, account isolation, visible polling and editor defaults');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
