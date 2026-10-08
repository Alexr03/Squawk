// Cut a release: node tools/release.mjs <major|minor|patch>
// Bumps the SemVer version in package.json, opens a CHANGELOG section for it, commits and tags vX.Y.Z (locally; push when ready).
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const part = process.argv[2];
if (!['major', 'minor', 'patch'].includes(part)) { console.error('usage: node tools/release.mjs <major|minor|patch>'); process.exit(1); }
if (execSync('git status --porcelain').toString().trim()) { console.error('Commit or stash your changes first.'); process.exit(1); }
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next = part === 'major' ? `${ma + 1}.0.0` : part === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
pkg.version = next;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const log = readFileSync('CHANGELOG.md', 'utf8');
const date = new Date().toISOString().slice(0, 10);
writeFileSync('CHANGELOG.md', log.replace('## Unreleased', `## Unreleased\n\n## ${next} — ${date}`));
execSync(`git commit -am "Release v${next}"`, { stdio: 'inherit' });
execSync(`git tag -a v${next} -m "Squawk v${next}"`, { stdio: 'inherit' });
console.log(`Tagged v${next}. Push with: git push --follow-tags`);
