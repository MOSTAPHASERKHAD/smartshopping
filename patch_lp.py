with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix thumb lazy loading in JS string
old = """html+='<div class="lp-thumb'+(i===0?' active':'')+'" onclick="lpCarouselGo('+i+')"><img src="'+src+'" alt=""></div>';"""
new = """html+='<div class="lp-thumb'+(i===0?' active':'')+'" onclick="lpCarouselGo('+i+')"><img src="'+src+'" alt="" loading="lazy"></div>';"""

if old in content:
    content = content.replace(old, new)
    print("Thumb lazy OK")
else:
    print("Thumb not found (may already be updated)")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
