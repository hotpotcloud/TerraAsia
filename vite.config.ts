import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 前端根目录是 app/，产物直接落到仓库根的 dist/ —— 部署时只认 dist/ 一个目录。
 * 数据（terrain.png / world.png / data.json）走 public/data，由 Python 管线烘焙，
 * 不打进 bundle：省域高精补丁、世界底图这类增量数据以后可以按需替换，不用重打整包。
 */
export default defineConfig({
  root: 'app',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: false,
    fs: { allow: ['..'] },
  },
});
