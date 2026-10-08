// Build identity, injected by Vite (see vite.config.ts). The version follows SemVer: MAJOR.MINOR.PATCH.
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const COMMIT = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev';
export const BUILT = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : '';
export const REPO = 'https://github.com/Alexr03/Squawk';
/** "v0.9.0 · a1b2c3d" */
export const versionLabel = `v${VERSION} · ${COMMIT}`;
