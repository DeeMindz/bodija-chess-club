const fs = require('fs');
const path = require('path');

const fileBuffer = fs.readFileSync(path.join(__dirname, '../src/lib/main.js'), 'utf-8');
console.log('main.js loaded, length:', fileBuffer.length);
