import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const siteUrl = import.meta.env.VITE_SITE_URL || 'http://localhost:5173'

// Check if Supabase is properly configured
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey &&
    supabaseUrl !== 'your_project_url_here' &&
    supabaseAnonKey !== 'your_anon_key_here')

if (!isSupabaseConfigured) {
    console.error('Supabase credentials not configured! Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file')
}

// Only create client if credentials are configured
export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            flowType: 'pkce',
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
        }
    })
    : null

// Export site URL for use in auth flows
export const getSiteUrl = () => siteUrl
