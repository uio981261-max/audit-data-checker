import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Development-only downloads. The website never runs this script or calls a CDN.
// curl inherits the configured proxy and CA trust; URLs contain no credentials.
const directory = fileURLToPath(new URL('../vendor/', import.meta.url));
const files = [
  ['xlsx.full.min.js', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'],
  ['chart.umd.min.js', 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js'],
  ['LICENSE-SheetJS.txt', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE'],
  ['LICENSE-Chartjs.md', 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/LICENSE.md'],
];
mkdirSync(directory, { recursive: true });
for (const [name, url] of files) {
  const temporary = `${directory}/${name}.download`;
  const result = spawnSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '45', '--connect-timeout', '10', url, '-o', temporary], { stdio: 'inherit' });
  if (result.status !== 0) {
    rmSync(temporary, { force: true });
    throw new Error(`Unable to download ${name}; network permission is required.`);
  }
  renameSync(temporary, `${directory}/${name}`);
}
const require = createRequire(import.meta.url);
if (require('../vendor/xlsx.cjs').version !== '0.20.3') throw new Error('Unexpected SheetJS version');
if (!readFileSync(`${directory}/chart.umd.min.js`, 'utf8').includes('v4.5.1')) throw new Error('Unexpected Chart.js version');
writeFileSync(`${directory}/SHA256SUMS.txt`, files.map(([name]) => `${createHash('sha256').update(readFileSync(`${directory}/${name}`)).digest('hex')}  ${name}`).join('\n') + '\n');
console.log('Vendored libraries and licenses are ready. No CDN is used at runtime.');
