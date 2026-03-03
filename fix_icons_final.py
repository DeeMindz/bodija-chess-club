
import sys

# Read with utf-8 to handle emojis correctly
with open('lib/main.js', 'r', encoding='utf-8') as f:
    content = f.read()

# The user is seeing ðŸ † which is the UTF-8 bytes of 🏆 interpreted as Windows-1252
# We will replace the literal string "ðŸ †" with the actual emoji 🏆
# We also need to handle cases where it might be "ðŸ\x8f\x86" or similar

replacements = {
    'ðŸ †': '🏆',
    'ðŸ\x8f\x86': '🏆',
    'ðŸ“…': '📅',
    'ðŸŽ¯': '🎯',
    'â ±ï¸ ': '🕒',
    'ðŸ‘¥': '👥',
    'Â±': '±'
}

for old, new in replacements.items():
    content = content.replace(old, new)

# Also check for any other variations of the trophy emoji bytes
# 🏆 in UTF-8 is 0xF0 0x9F 0x8F 0x86
# Interpreted as Windows-1252: ðŸ\x8f\x86

with open('lib/main.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Successfully replaced garbled icons in lib/main.js")
