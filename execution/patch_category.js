import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function patch() {
    console.log("Patching games with NULL category to 'rapid'...");
    const { data, error } = await supabase.from('games')
        .update({ category: 'rapid' })
        .is('category', null);
    
    if (error) {
        console.error("Error patching category:", error);
    } else {
        console.log("Successfully patched games!");
    }
}
patch();
