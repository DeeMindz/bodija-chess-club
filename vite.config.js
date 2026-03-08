import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        port: 3000,
    },
    build: {
        minify: 'esbuild',
        target: 'esnext',
        rollupOptions: {
            output: {
                manualChunks: {
                    supabase: ['@supabase/supabase-js']
                }
            }
        }
    }
})
