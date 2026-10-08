// Start a new version: node tools/release.mjs <major|minor>
// Sets package.json to X.Y (shown as X.Y.0 at that commit; the last number then counts commits automatically),
// opens a CHANGELOG section, commits and tags vX.Y.0 locally. Push with git push --follow-tags.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const part = process.argv[2];
if (!['major', 'minor'].includes(part)) { console.error('usage: node tools/release.mjs <major|minor>   (the patch number counts commits by itself)'); process.exit(1); }
if (execSync('git status --porcelain').toString().trim()) { console.error('Commit or stash your changes first.'); process.exit(1); }
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [ma, mi] = pkg.version.split('.').map(Number);
const next = part === 'major' ? `${ma + 1}.0.0` : `${ma}.${mi + 1}.0`;
pkg.version = next;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const date = new Date().toISOString().slice(0, 10);
writeFileSync('CHANGELOG.md', readFileSync('CHANGELOG.md', 'utf8').replace('## Unreleased', `## Unreleased\n\n## ${next} — ${date}`));
execSync(`git commit -am "Release v${next}"`, { stdio: 'inherit' });
execSync(`git tag -a v${next} -m "Squawk v${next}"`, { stdio: 'inherit' });
console.log(`Tagged v${next}. Push with: git push --follow-tags`);
