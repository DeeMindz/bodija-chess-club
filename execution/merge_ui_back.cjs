/**
 * Merge the 4 UI module files back into main.js, removing them from modules/.
 * The pure-logic modules (store, ratings, utils, playerstats) stay as-is.
 * Also strips the now-redundant import/window-bind lines for the UI modules from main.js.
 */
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '../src/lib/main.js');
let main = fs.readFileSync(mainPath, 'utf8');

const uiModules = ['ui-leaderboard', 'ui-players', 'ui-games', 'ui-tournaments'];

// Names from the extraction scripts – these were bound via window.xxx = namespace.xxx
const uiNamespaceMap = {
    'ui-leaderboard': 'ui_leaderboard',
    'ui-players':     'ui_players',
    'ui-games':       'ui_games',
    'ui-tournaments': 'ui_tournaments',
};

for (const mod of uiModules) {
    const ns  = uiNamespaceMap[mod];
    const modPath = path.join(__dirname, `../src/lib/modules/${mod}.js`);
    if (!fs.existsSync(modPath)) { console.warn(`Module not found: ${mod}.js`); continue; }

    let modCode = fs.readFileSync(modPath, 'utf8');

    // Strip the module header (import + comment)
    modCode = modCode
        .replace(/^import \{ store \} from '\.\/store\.js';\n/, '')
        .replace(/^\/\/ Assume global window tools exist for legacy crossover mapping\.\n/, '')
        .trim();

    // Strip export keywords so the functions become plain function declarations in main.js scope
    modCode = modCode.replace(/^export (function|\/\/[^\n]*\n\nfunction|\/\/[^\n]*\nfunction)/gm, (m) => {
        return m.replace(/^export /, '');
    });
    // Also handle "export // comment\nfunction"
    modCode = modCode.replace(/export (\/\/[^\n]+\n)(function )/g, '$1$2');

    // Remove the import line for this module from main.js
    main = main.replace(new RegExp(`import \\* as ${ns} from '\\.//modules/${mod}\\.js';\\n`), '');
    main = main.replace(new RegExp(`import \\* as ${ns} from '\\.\\/modules\\/${mod}\\.js';\\n`), '');

    // Remove window.xxx = ns.xxx; lines for this module's functions
    // (they all appear in a block just before "window.calculateElo")
    const windowBindRegex = new RegExp(`window\\.\\w+ = ${ns}\\.\\w+;\n`, 'g');
    main = main.replace(windowBindRegex, '');

    // Append inlined code at the end of main.js (before the closing)
    console.log(`Appending ${mod}.js (${modCode.split('\n').length} lines)`);
    main = main + '\n\n// ==================== ' + mod.toUpperCase() + ' (inlined) ====================\n' + modCode + '\n';

    // Delete the module file
    fs.unlinkSync(modPath);
    console.log(`Deleted ${mod}.js`);
}

fs.writeFileSync(mainPath, main);
console.log('Done. UI modules merged back into main.js.');
