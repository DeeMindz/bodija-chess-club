import re

js_path = 'c:/Users/DeeMindz/Documents/BCC/lib/main.js'

with open(js_path, 'r', encoding='utf-8') as f:
    content = f.read()

funcs = re.findall(r'function\s+([a-zA-Z0-9_]+)\s*\(', content)
exports = []
for f in funcs:
    exports.append(f"window.{f} = {f};")

if exports:
    with open(js_path, 'a', encoding='utf-8') as f:
        f.write("\n\n// Make functions available globally for HTML onclick attributes\n")
        f.write("\n".join(exports))
    print(f"Appended {len(exports)} global exports.")
else:
    print("No functions found.")
