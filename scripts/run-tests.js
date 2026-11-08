const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => /^test-.*\.js$/.test(name)).sort();
for (const file of tests) {
  const result = spawnSync(process.execPath, [path.join(root, 'tests', file)], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) { console.error(file, result.stdout, result.stderr); process.exit(result.status || 1); }
  console.log('PASS ' + file);
}
console.log(tests.length + ' regression scripts passed');
