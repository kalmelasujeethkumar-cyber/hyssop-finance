import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const loopbackHost = '127.0.0.1';
const devPort = 5173;
const previewPort = 4173;
const defaultApiProxyTarget = `http://${loopbackHost}:3000`;

/**
 * `smoke` mode is used by the browser acceptance run. It pins the same-origin API
 * path so the built bundle is exercised through the preview proxy, which keeps the
 * smoke result independent of whatever port the API run happens to use.
 */
const smokeModeApiBaseUrl = '/api/v1';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, repositoryRoot, '');
  const configuredApiBaseUrl =
    mode === 'smoke'
      ? smokeModeApiBaseUrl
      : (process.env['VITE_API_BASE_URL'] ?? env['VITE_API_BASE_URL']);
  const apiProxyTarget =
    process.env['API_PROXY_TARGET'] ?? env['API_PROXY_TARGET'] ?? defaultApiProxyTarget;

  if (command === 'build' && (configuredApiBaseUrl ?? '').trim() === '') {
    throw new Error(
      'VITE_API_BASE_URL must be set for a production build. Copy .env.example to .env and set it.',
    );
  }

  return {
    root: appRoot,
    envDir: repositoryRoot,
    plugins: [react(), tailwindcss()],
    ...(mode === 'smoke'
      ? { define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(smokeModeApiBaseUrl) } }
      : {}),
    server: {
      host: loopbackHost,
      port: devPort,
      strictPort: true,
      proxy: { '/api': { target: apiProxyTarget, changeOrigin: false } },
    },
    preview: {
      host: loopbackHost,
      port: previewPort,
      strictPort: true,
      proxy: { '/api': { target: apiProxyTarget, changeOrigin: false } },
    },
    build: {
      outDir: 'dist',
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  };
});
