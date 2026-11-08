const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
let errors = 0;
function error(message) { errors++; console.error(message); }
const routes = [...app.pages, ...(app.subPackages || []).flatMap(pkg => pkg.pages.map(page => `${pkg.root}/${page}`))];
for (const route of routes) {
  for (const suffix of ['.js', '.json', '.wxml', '.wxss']) if (!fs.existsSync(path.join(root, route + suffix))) error(`Missing page: ${route + suffix}`);
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.git', 'codex-build-resources', '文件'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
for (const file of files(root)) {
  if (/\.js$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) error(result.stderr);
  }
  if (/\.json$/.test(file)) { try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { error(`${file}: ${e.message}`); } }
  if (!/\.wxml$/.test(file)) continue;
  const markup = fs.readFileSync(file, 'utf8');
  const script = fs.existsSync(file.replace(/\.wxml$/, '.js')) ? fs.readFileSync(file.replace(/\.wxml$/, '.js'), 'utf8') : '';
  for (const match of markup.matchAll(/\b(?:bind|catch)(?::?[a-zA-Z]+)="([a-zA-Z_$][\w$]*)"/g)) {
    if (!new RegExp(`\\b${match[1]}\\s*(?:\\(|:)`).test(script)) error(`Missing event handler ${match[1]}: ${path.relative(root, file)}`);
  }
  for (const match of markup.matchAll(/(?:src|url)="(\/assets\/[^"{}]+)"/g)) if (!fs.existsSync(path.join(root, match[1].slice(1)))) error(`Missing asset ${match[1]}: ${file}`);
}
if (errors) process.exitCode = 1;
else console.log('All registered pages, scripts, JSON, static event handlers and image paths passed');
