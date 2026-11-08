const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
let page, calls = [], modals = [], toasts = [], nextResult = { reviewed: true }, release;
const item = { recordId: 'work-1', title: '营地作品', updatedAt: 123, checked: true };
vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/profile/work-review.js'), 'utf8'), {
  Page(value) { page = value; },
  require(name) {
    if (name === '../../utils/work-media') return { isVideo: () => false };
    assert.equal(name, '../../utils/cloud-service');
    return { async call(action, payload) {
      if (action === 'admin.work.pending') return { items: [item] };
      calls.push({ action, payload });
      if (release === 'wait') return new Promise(resolve => { release = resolve; });
      return nextResult;
    } };
  },
  wx: { showModal(options) { modals.push(options); options.success({ confirm: true }); }, showToast(options) { toasts.push(options); } }
});
page.data = JSON.parse(JSON.stringify(page.data));
page.setData = value => Object.assign(page.data, value);
const click = decision => ({ currentTarget: { dataset: { id: item.recordId, decision } } });
async function main() {
  page.data.items = [item];
  await page.review(click('rejected'));
  assert(page.data.rejecting);assert.equal(calls.length, 0);
  page.reasonInput({ detail: { value: '某个原因' } });page.cancelRejection();
  assert.equal(page.data.rejecting, null);assert.equal(calls.length, 0);
  await page.review(click('rejected'));await page.confirmRejection();
  assert.equal(calls[0].payload.reason, '');assert.equal(page.data.rejecting, null);assert(!page.data.busy);
  await page.review(click('rejected'));page.reasonInput({ detail: { value: ' 请重新上传完整附件。 ' } });
  nextResult = { error: 'OFFLINE', message: '连接失败' };await page.confirmRejection();
  assert(page.data.rejecting);assert.equal(page.data.rejectionReason, ' 请重新上传完整附件。 ');assert(!page.data.busy);
  nextResult = { reviewed: true };release = 'wait';
  const pending = page.confirmRejection(), count = calls.length;
  await page.confirmRejection();assert.equal(calls.length, count);page.cancelRejection();assert(page.data.rejecting);
  release(nextResult);release = null;await pending;
  assert.equal(calls.at(-1).payload.reason, '请重新上传完整附件。');
  assert.equal(calls.at(-1).payload.updatedAt, 123);assert.equal(page.data.rejecting, null);
  await page.review(click('rejected'));page.reasonInput({ detail: { value: '字'.repeat(201) } });
  const before = calls.length;await page.confirmRejection();assert.equal(calls.length, before);page.cancelRejection();
  page.data.items = [item];await page.review(click('approved'));
  assert.equal(modals.length, 1);assert.equal(calls.at(-1).payload.decision, 'approved');assert.equal(calls.at(-1).payload.reason, '');
  const markup = fs.readFileSync(path.join(root, 'pages/profile/work-review.wxml'), 'utf8');
  assert(markup.includes('maxlength="200"'));assert(markup.includes('原因选填'));assert(markup.includes('!rejecting'));
  const mailbox = fs.readFileSync(path.join(root, 'pages/profile/mailbox.wxml'), 'utf8');
  assert(mailbox.includes("item.type === 'work_review'"));assert(mailbox.includes('审核通知'));
  console.log('PASS rejection dialog cancellation, optional reason, failure recovery, duplicate submission guard, approvals and mailbox display');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
