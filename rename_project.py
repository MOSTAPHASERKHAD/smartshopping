import os

files_to_update = [
    'index.html',
    'admin.html',
    'sw.js',
    'manifest.json',
    'robots.txt',
    'sitemap.xml',
    'MARKETING_STRATEGY.md',
    'README.md',
    'google-apps-script/Code.gs'
]

for file_path in files_to_update:
    if not os.path.exists(file_path):
        continue
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace the specific URL subdomains/paths but preserve case if possible.
    # We will do case-insensitive replace for smartkiosk -> smartshopping
    # Actually, let's do precise replacements to avoid breaking variables if they shouldn't be broken.
    # But since it's the project name, we can just replace 'smartkiosk' with 'smartshopping' and 'SmartKiosk' with 'SmartShopping'
    
    content = content.replace('smartkiosk', 'smartshopping')
    content = content.replace('SmartKiosk', 'SmartShopping')
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
