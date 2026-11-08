const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const comments = new Map(); let count = 0;
const clone = value => JSON.parse(JSON.stringify(value));
const db = {
  command: { inc: value => ({ increment: value }) },
  async runTransaction(fn) {
    const staged = new Map(Array.from(comments, ([id, item]) => [id, clone(item)])); let pending = count;
    const result = await fn({ collection: name => ({ doc: id => ({
      get: async () => { if (!staged.has(id)) throw new Error('DATABASE_DOCUMENT_NOT_EXIST'); return { data: staged.get(id) }; },
      set: async ({ data }) => staged.set(id, clone(data)),
      update: async ({ data }) => { pending += data.commentCount.increment; }
    }) }) });
    comments.clear(); staged.forEach((item, id) => comments.set(id, item)); count = pending; return result;
  }
};
const cloud = { init() {}, database: () => db };
const exported = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/hui-api/index.js'), 'utf8') + '\nownProfile = async () => ({uid:"1111111"}); findContent = async () => ({_id:"post",kind:"photo",contentId:"photo",ownerOpenid:"author",visibility:"public"}); checkTextSafety = async () => {}; exports.submit = saveComment;', {
  exports: exported, process, Buffer,
  require(name) { return name === 'wx-server-sdk' ? cloud : require(name.startsWith('.') ? path.join(__dirname, '../cloudfunctions/hui-api', name) : name); }
});
async function run() {
  const request = { comment: { id: 'request-a', targetType: 'photo', targetId: 'photo', body: 'hello' } };
  await exported.submit('owner', request); await exported.submit('owner', request);
  assert.equal(comments.size, 1); assert.equal(count, 1, 'retry must not double-count');
  await assert.rejects(exported.submit('other-user', request), /FORBIDDEN/);
  assert.equal(comments.get('request-a').authorOpenid, 'owner', 'cannot overwrite another author by supplying their comment ID');
  await assert.rejects(exported.submit('owner', { comment: Object.assign({}, request.comment, { body: 'changed body' }) }), /CONTENT_CONFLICT/);
  assert.equal(comments.get('request-a').body, 'hello');
  console.log('comment ownership, retry idempotence and count consistency passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
