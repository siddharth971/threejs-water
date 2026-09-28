import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ command }) => ({
  // Use '/' for dev server, '/threejs-water/' for production build
  base: command === 'serve' ? '/' : '/threejs-water/',
  plugins: [glsl(), basicSsl()],
  server: {
    host: '0.0.0.0',
    port: 5175,
  },
}))
