const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
let writes = 0;
const cloud = { init() {}, database: () => ({ command: {}, collection: () => ({ doc: () => ({ get: async () => { throw new Error('DATABASE_TIMEOUT'); }, set: async () => { writes++; } }) }) }) };
const exported = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/hui-api/index.js'), 'utf8') + '\nexports.read = profileByOpenid; exports.own = ownProfile;', {
  exports: exported, process, Buffer,
  require(name) { return name === 'wx-server-sdk' ? cloud : require(name.startsWith('.') ? path.join(__dirname, '../cloudfunctions/hui-api', name) : name); }
});
async function run() {
  await assert.rejects(exported.read('existing-user'), /DATABASE_TIMEOUT/);
  await assert.rejects(exported.own('existing-user'), /DATABASE_TIMEOUT/);
  assert.equal(writes, 0, 'a failed profile read cannot create a replacement profile or change UID');
  console.log('profile read failures never overwrite existing accounts passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
