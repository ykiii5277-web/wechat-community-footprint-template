const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const app = JSON.parse(read('app.json'));
const config = JSON.parse(read('project.config.json'));
const before = JSON.parse(read('tests/fixtures/package-layout.json'));
const packages = app.subPackages || [];
const routes = [...app.pages, ...packages.flatMap(pkg => pkg.pages.map(page => pkg.root + '/' + page))];
assert.strictEqual(new Set(routes).size, routes.length, 'Duplicate page registration');
assert.strictEqual(app.pages[0], 'pages/profile/intro-editor');
for (const tab of app.tabBar.list) assert(app.pages.includes(tab.pagePath), 'Tab page must stay in main package');
for (const route of before.oldRoutes) assert(routes.includes(route), `Old page URL lost: ${route}`);
for (const route of routes) for (const ext of ['.js', '.json', '.wxml', '.wxss']) assert(fs.existsSync(path.join(root, route + ext)), `Missing ${route + ext}`);
for (const pkg of packages) {
  assert(!app.pages.some(route => route.startsWith(pkg.root + '/')), 'Main page inside a subpackage');
  assert(!packages.some(other => other !== pkg && other.root.startsWith(pkg.root + '/')), 'Nested subpackage roots');
}
function owner(relative) { return packages.find(pkg => relative.startsWith(pkg.root + '/'))?.root || 'main'; }
function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    if (['.git', 'node_modules'].includes(entry.name) || relative === config.cloudfunctionRoot.replace(/\/$/, '')) return [];
    if (config.packOptions.ignore.some(rule => relative === rule.value || rule.type === 'folder' && relative.startsWith(rule.value + '/'))) return [];
    return entry.isDirectory() ? walk(path.join(directory, entry.name), relative + '/') : [relative];
  });
}
const files = walk(root);
const sizes = {};
for (const relative of files) {
  // Configuration and Markdown aren't mini-program runtime payload.
  if (/\.md$/.test(relative) || /^project(?:\.private)?\.config\.json$/.test(relative)) continue;
  const pkg = owner(relative);
  sizes[pkg] = (sizes[pkg] || 0) + fs.statSync(path.join(root, relative)).size;
  if (!/\.(js|json|wxml|wxss)$/.test(relative)) continue;
  const source = read(relative);
  const references = [];
  for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) references.push(match[1]);
  if (/\.json$/.test(relative)) {
    const json = JSON.parse(source);
    references.push(...Object.values(json.usingComponents || {}));
  }
  for (const match of source.matchAll(/['"](\/(?:assets|packages)\/[^'"?{}]+\.(?:jpg|png|jpeg|webp|svg))['"]/g)) references.push(match[1]);
  for (const match of source.matchAll(/(?:src=|@import\s*)['"]([^'"{}]+)['"]/g)) if (!/^(?:https?:|cloud:)/.test(match[1])) references.push(match[1]);
  for (const ref of references) {
    if (!ref.startsWith('.') && !ref.startsWith('/')) continue;
    const resolved = path.posix.normalize(ref.startsWith('/') ? ref.slice(1) : path.posix.join(path.posix.dirname(relative), ref));
    const targetOwner = owner(resolved);
    assert(targetOwner === 'main' || targetOwner === pkg, `${relative} depends on another package: ${ref}`);
    assert(['', '.js', '.json', '/index.js'].some(ext => fs.existsSync(path.join(root, resolved + ext))), `Missing dependency ${relative}: ${ref}`);
  }
}
for (const [name, hash] of Object.entries(before.hashes)) {
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'packages/camps/assets', name))).digest('hex'), hash, 'Artwork must remain byte-identical');
}
// Existing deep links must preserve encoded activity names, UID and stage context, without adding stack levels.
for (const [from, to] of before.moves) {
  let page, navigation;
  vm.runInNewContext(read(from + '.js'), { Page: value => { page = value; }, wx: { redirectTo: options => { navigation = options; } } });
  const options = { id: '1000001', campId: 'other', activityName: '乡村 & 夏令营', subcampId: 'A/B', stageId: 'camper' };
  page.onLoad(options);
  assert.strictEqual(navigation.url.split('?')[0], '/' + to);
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(navigation.url.split('?')[1])), options);
}
for (const step of require('../utils/feature-guide').steps) assert(routes.includes(step.route), `Guide points to unregistered page: ${step.route}`);
assert(sizes.main < 1900 * 1024, 'Main source payload must have headroom below 2 MB');
for (const bytes of Object.values(sizes)) assert(bytes < 2 * 1024 * 1024, 'Package source payload exceeds 2 MB');
const result = { note: 'Source byte estimates; actual compiled sizes must be checked in WeChat Developer Tools.', sizes, routes: routes.length, unchangedImages: Object.keys(before.hashes) };

console.log(JSON.stringify(result, null, 2));
