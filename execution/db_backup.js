import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

// Load environment variables from ../.env
dotenv.config({ path: envPath });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey || supabaseUrl === 'your_project_url_here' || supabaseKey === 'your_service_role_key_here') {
  console.error("❌ Please provide valid VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tables = [
    'players',
    'tournaments',
    'tournament_players',
    'rounds',
    'pairings',
    'games'
];

async function backupData() {
    console.log("🚀 Starting database backup...");
    const backupData = {};
    
    for (const table of tables) {
        console.log(`⏳ Fetching from ${table}...`);
        const { data, error } = await supabase.from(table).select('*');
        if (error) {
            console.error(`❌ Error fetching table ${table}:`, error);
            process.exit(1);
        }
        backupData[table] = data;
        console.log(`✅ Backed up ${data.length} rows from ${table}`);
    }
    
    const outputPath = path.join(__dirname, 'supabase_backup.json');
    fs.writeFileSync(outputPath, JSON.stringify(backupData, null, 2));
    console.log(`\n🎉 Backup successfully saved to ${outputPath}`);
}

backupData();
