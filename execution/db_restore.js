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

// Discard relationships: Delete child tables before parent tables to prevent foreign key errors
const deletionOrder = [
    'games',
    'pairings',
    'rounds',
    'tournament_players',
    'tournaments',
    'players'
];

// Restore relationships: Insert parent tables before child tables to satisfy foreign key constraints
const insertionOrder = [
    'players',
    'tournaments',
    'tournament_players',
    'rounds',
    'pairings',
    'games'
];

async function restoreData() {
    const backupPath = path.join(__dirname, 'supabase_backup.json');
    
    if (!fs.existsSync(backupPath)) {
        console.error("❌ Backup file not found at " + backupPath);
        process.exit(1);
    }
    
    console.log("📂 Loading backup data...");
    const rawData = fs.readFileSync(backupPath, 'utf8');
    const backupData = JSON.parse(rawData);
    
    console.log("\n🧹 1. Clearing existing data (this might take a moment)...");
    for (const table of deletionOrder) {
        // We delete all records. The best workaround in Supabase JS is to provide a filter that matches all.
        const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) {
            console.error(`❌ Error clearing table ${table}:`, error);
            process.exit(1);
        }
        console.log(`✅ Cleared table: ${table}`);
    }
    
    console.log("\n📥 2. Restoring data from backup...");
    for (const table of insertionOrder) {
        const rows = backupData[table];
        if (rows && rows.length > 0) {
            // Attempt insertion
            const { error } = await supabase.from(table).insert(rows);
            if (error) {
                console.error(`⚠️ Error trying full insert into ${table}:`, error.message);
                console.log(`🔧 Attempting chunked insert for ${table}...`);
                
                let successChunks = true;
                const chunkSize = 200;
                for (let i = 0; i < rows.length; i += chunkSize) {
                    const chunk = rows.slice(i, i + chunkSize);
                    const { error: chunkError } = await supabase.from(table).insert(chunk);
                    if (chunkError) {
                         console.error(`❌ Error inserting chunk ${table}[${i}-${i+chunkSize}]:`, chunkError);
                         successChunks = false;
                         break;
                    }
                }
                if (!successChunks) {
                    process.exit(1);
                } else {
                    console.log(`✅ Restored ${rows.length} rows into ${table} (chunked fallback)`);
                }
            } else {
                 console.log(`✅ Restored ${rows.length} rows into ${table}`);
            }
        } else {
            console.log(`⏩ No rows to restore for ${table}, skipping.`);
        }
    }
    
    console.log(`\n🎉 Restore completed successfully! Your database is now back to its previous state.`);
}

restoreData();
