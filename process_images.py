import os
from PIL import Image, ImageDraw, ImageFont

SRC = r"D:\Mmg\imag de produit\enzo"
DST = r"D:\pro\ccc\smartkiosk\assets\img"

os.makedirs(DST, exist_ok=True)

FONT_BOLD = r"C:\Windows\Fonts\tahomabd.ttf"
FONT_REG  = r"C:\Windows\Fonts\tahoma.ttf"

images = [
    ("17.webp", "طقم ENZO 3 في 1 الاحترافي", "مكواة فرد + فرشاة حرارية + مكواة تجعيد"),
    ("18.png", "مكونات الطقم كاملة", "3 أجهزة احترافية للعناية بالشعر"),
    ("19.png", "فرشاة تصفيف حرارية", "تقنية الأيونات السالبة - نعومة ولمعان"),
    ("20.png", "مكواة فرد الشعر", "صفائح عائمة 3D لحماية الشعر من التلف"),
    ("21.png", "مشط تصفيف حراري", "هيشان صفر - تصفيف سريع وآمن"),
]

def add_text_overlay(img, title, subtitle):
    draw = ImageDraw.Draw(img)
    w, h = img.size
    overlay_h = int(h * 0.32)
    for i in range(overlay_h):
        alpha = int(180 * (i / overlay_h))
        y = h - overlay_h + i
        for x in range(w):
            px = img.getpixel((x, y))
            if len(px) == 4:
                r, g, b, a = px
                nr = int(r * (255 - alpha) / 255)
                ng = int(g * (255 - alpha) / 255)
                nb = int(b * (255 - alpha) / 255)
                draw.point((x, y), (nr, ng, nb, 255))
            else:
                draw.point((x, y), (0, 0, 0, alpha))

    title_size = max(20, int(w * 0.055))
    try:
        ft = ImageFont.truetype(FONT_BOLD, title_size)
    except:
        ft = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), title, font=ft)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (w - tw) // 2
    ty = h - overlay_h + 20
    draw.text((tx+1, ty+1), title, font=ft, fill=(0, 0, 0, 200))
    draw.text((tx, ty), title, font=ft, fill=(255, 255, 255, 255))

    sub_size = max(14, int(w * 0.035))
    try:
        fs = ImageFont.truetype(FONT_REG, sub_size)
    except:
        fs = ImageFont.load_default()
    bbox2 = draw.textbbox((0, 0), subtitle, font=fs)
    sw = bbox2[2] - bbox2[0]
    sh = bbox2[3] - bbox2[1]
    sx = (w - sw) // 2
    sy = ty + th + 8
    draw.text((sx+1, sy+1), subtitle, font=fs, fill=(0, 0, 0, 200))
    draw.text((sx, sy), subtitle, font=fs, fill=(255, 255, 255, 230))

    return img

for fname, title, subtitle in images:
    src_path = os.path.join(SRC, fname)
    if not os.path.exists(src_path):
        print(f"Missing: {src_path}")
        continue
    img = Image.open(src_path).convert("RGBA")
    img = add_text_overlay(img, title, subtitle)
    out_name = f"enzo_{fname.split('.')[0]}.png"
    out_path = os.path.join(DST, out_name)
    img.save(out_path, "PNG")
    print(f"Saved: {out_path} ({img.size[0]}x{img.size[1]})")

for sq in ["1.jpg", "3.jpg"]:
    src_path = os.path.join(SRC, sq)
    if os.path.exists(src_path):
        img = Image.open(src_path)
        out_name = f"enzo_{sq.replace('.','_')}.png"
        out_path = os.path.join(DST, out_name)
        img.save(out_path, "PNG")
        print(f"Saved: {out_path} ({img.size[0]}x{img.size[1]})")

print("Done")
