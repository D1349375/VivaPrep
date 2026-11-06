"""Package the reviewed pilot and unchanged render previews for Blender review."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import zipfile
HERE=Path(__file__).parent;OUT=HERE/'review/zhou'
font=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',27)
small=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',21)
sheet=Image.new('RGB',(2160,1664),'#edeae4');draw=ImageDraw.Draw(sheet)
draw.text((26,22),'周教授 · 單人外觀樣板 v1｜參考相貌驗收，尚非最終寫實材質',font=font,fill='#25312d')
panels=[(HERE.parents[1]/'public/assets/interviewer-logic.png','原概念圖（含傾頭表情）'),
    (OUT/'zhou-front.png','實際 3D · 中立正面'),(OUT/'zhou-threequarter.png','實際 3D · 三分之四'),
    (OUT/'zhou-clay.png','實際 3D · 灰模'),(OUT/'zhou-side.png','實際 3D · 側面（推定）'),(OUT/'zhou-back.png','實際 3D · 背面（推定）')]
for i,(path,label) in enumerate(panels):
    x=(i%3)*720;y=80+(i//3)*790
    draw.text((x+22,y+14),label,font=font,fill='#25312d')
    im=Image.open(path).convert('RGBA');im.thumbnail((720,720),Image.Resampling.LANCZOS)
    tile=Image.new('RGBA',(720,720),'#43494d');tile.alpha_composite(im,((720-im.width)//2,(720-im.height)//2))
    sheet.paste(tile.convert('RGB'),(x,y+64))
sheet.save(OUT/'zhou-review-contact-sheet.jpg',quality=94)
with zipfile.ZipFile(HERE/'VivaPrep-Zhou-review-v1.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for path in OUT.iterdir():
        if path.is_file() and path.suffix in ('.blend','.png','.jpg','.md','.json'):archive.write(path,path.name)
    archive.write(HERE/'source/zhou-facebuilder-fit.blend','facebuilder/zhou-facebuilder-fit.blend')
    archive.write(HERE/'REALISM-RESEARCH.md','REALISM-RESEARCH.md')
print('ZHOU_PACKAGE_READY',flush=True)
