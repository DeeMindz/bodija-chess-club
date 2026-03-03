import re

html_path = 'c:/Users/DeeMindz/Documents/BCC/index.html'
js_path = 'c:/Users/DeeMindz/Documents/BCC/lib/main.js'

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the script block
script_pattern = re.compile(r'<script>(.*?)</script>', re.DOTALL)
match = script_pattern.search(content)

if match:
    js_code = match.group(1).strip()
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write(js_code)
    
    # Replace block in HTML
    new_html = content[:match.start()] + '<script type="module" src="./lib/main.js"></script>' + content[match.end():]
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(new_html)
    print("Extraction successful.")
else:
    print("Could not find <script> tags.")
