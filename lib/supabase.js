import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const siteUrl = import.meta.env.VITE_SITE_URL || 'http://localhost:5173'

// Check if Supabase is properly configured
if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'your_project_url_here' || supabaseAnonKey === 'your_anon_key_here') {
    console.error('Supabase credentials not configured! Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
    auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
})

// Export site URL for use in auth flows
export const getSiteUrl = () => siteUrl
