/// <reference types="vite/client" />
declare module '*.svelte' {
  const component: import('svelte').Component;
  export default component;
}

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT__: string;
