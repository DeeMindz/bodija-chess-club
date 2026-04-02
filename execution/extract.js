const fs = require('fs');

const code = fs.readFileSync('lib/main.js', 'utf8');

function extractFunction(name) {
    const regex = new RegExp(`function ${name}\\s*\\([\\s\\S]*?\\)(\\s|\\n)*{`, 'g');
    const match = regex.exec(code);
    if (!match) return `NOT FOUND: ${name}\n`;

    let braceCount = 1;
    let endIdx = match.index + match[0].length;

    while (braceCount > 0 && endIdx < code.length) {
        if (code[endIdx] === '{') braceCount++;
        else if (code[endIdx] === '}') braceCount--;
        endIdx++;
    }

    return `--- ${name} ---\n${code.substring(match.index, endIdx)}\n\n`;
}

let result = '';
result += extractFunction('renderLeaderboard');
result += extractFunction('updatePodium');
result += extractFunction('submitGame');
result += extractFunction('recalculateFromRound');
result += extractFunction('calculateElo');

fs.writeFileSync('execution/extracted.txt', result);
console.log('Extraction complete');
