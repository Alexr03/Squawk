// Generates docs/logo.svg: a radar scope and the SQUAWK wordmark in square pixels (no fonts, so it renders the same everywhere).
import { writeFileSync } from 'node:fs';
const G = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
};
const px = 10, gap = 2, W = 760, H = 200, x0 = 226, y0 = 42;
let rects = '', shadow = '';
[...'SQUAWK'].forEach((ch, i) => G[ch].forEach((row, r) => [...row].forEach((b, c) => {
  if (b !== '1') return;
  const x = x0 + i * (5 * (px + gap) + 16) + c * (px + gap), y = y0 + r * (px + gap);
  shadow += `<rect x="${x + 3}" y="${y + 4}" width="${px}" height="${px}"/>`;
  rects += `<rect x="${x}" y="${y}" width="${px}" height="${px}"/>`;
})));
const cx = 112, cy = 100;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Squawk">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#13243b"/><stop offset="1" stop-color="#070e1c"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#3ee6a8" stop-opacity="0.25"/><stop offset="1" stop-color="#3ee6a8" stop-opacity="0"/></radialGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3ee6a8" stop-opacity="0"/><stop offset="1" stop-color="#3ee6a8" stop-opacity="0.55"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="28" fill="url(#bg)"/>
  <circle cx="${cx}" cy="${cy}" r="76" fill="url(#glow)"/>
  <g fill="none" stroke="#3ee6a8" stroke-opacity="0.35" stroke-width="2">
    <circle cx="${cx}" cy="${cy}" r="66"/><circle cx="${cx}" cy="${cy}" r="44"/><circle cx="${cx}" cy="${cy}" r="22"/>
    <path d="M${cx - 70} ${cy}H${cx + 70}M${cx} ${cy - 70}V${cy + 70}" stroke-opacity="0.18"/>
  </g>
  <path d="M${cx} ${cy}L${cx + 66} ${cy}A66 66 0 0 0 ${cx + 46.7} ${cy - 46.7}Z" fill="url(#sweep)"/>
  <path d="M${cx} ${cy}L${cx + 66} ${cy}" stroke="#3ee6a8" stroke-width="3"/>
  <rect x="${cx + 26}" y="${cy - 34}" width="9" height="9" fill="#ffb547"/>
  <rect x="${cx - 40}" y="${cy + 18}" width="7" height="7" fill="#eef3f8" fill-opacity="0.85"/>
  <rect x="${cx + 10}" y="${cy + 38}" width="7" height="7" fill="#6cb7ff"/>
  <g fill="#000" fill-opacity="0.45">${shadow}</g>
  <g fill="#3ee6a8">${rects}</g>
  <text x="${x0}" y="${H - 34}" fill="#9fb3cc" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="17" letter-spacing="0.3">Air traffic control at London's airports · real traffic, real radio</text>
</svg>
`;
writeFileSync(new URL('../docs/logo.svg', import.meta.url), svg);
console.log('docs/logo.svg written');
