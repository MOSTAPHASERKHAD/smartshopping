"""Check inline event handlers for syntax errors."""
import re, subprocess, os

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# find all onX="something"
handlers = re.findall(r'on[a-z]+="([^"]+)"', content, re.IGNORECASE)
print(f"Found {len(handlers)} event handlers.")

errs = 0
for code in handlers:
    # use python's node execution to check syntax of the handler string
    # event handlers are parsed as function bodies essentially: function(event) { code }
    check_code = f"try {{ new Function({repr(code)}); }} catch(e) {{ console.log('ERR: ' + e.message); process.exit(1); }}"
    with open('_t.js', 'w', encoding='utf-8') as f:
        f.write(check_code)
    
    r = subprocess.run(['node', '_t.js'], capture_output=True, cwd=os.getcwd())
    if r.returncode != 0:
        print(f"Syntax error in handler: {code}")
        print("  " + r.stdout.decode('utf-8','replace').strip())
        errs += 1

print(f"Total errors in handlers: {errs}")
try: os.remove('_t.js')
except: pass
