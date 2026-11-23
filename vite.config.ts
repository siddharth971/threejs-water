import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  // Use relative base path so assets load correctly on root domains (Hostinger), subdirectories, and GitHub Pages
  base: './',
  plugins: [glsl(), basicSsl()],
  server: {
    host: '0.0.0.0',
    port: 5175,
  },
})
