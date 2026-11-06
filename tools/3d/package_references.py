"""Arrange unchanged Blender renders into scale-consistent review sheets."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import zipfile
root=Path(__file__).resolve().parent
folder=root/'preview/v2'
font=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',28)
for role,label in [('technical','林教授'),('portfolio','陳教授'),('logic','周教授')]:
    for kind,views in [('三視圖',[('standing-front','正面'),('standing-side','側面'),('standing-back','背面')]),('坐姿',[('seated-front','正面坐姿'),('seated-side','側面坐姿')])]:
        images=[Image.open(folder/f'{role}-{suffix}.png').convert('RGB') for suffix,_ in views]
        sheet=Image.new('RGB',(720*len(images),1040),'#eeeae4'); d=ImageDraw.Draw(sheet)
        for i,(im,(_,name)) in enumerate(zip(images,views)):
            sheet.paste(im,(i*720,80)); d.text((i*720+24,22),f'{label} · {name}',font=font,fill='#26352f')
        sheet.save(folder/f'{role}-{kind}.jpg',quality=94)
output=root/'VivaPrep-v2-structural-delivery.zip'
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
    for role in ['technical','portfolio','logic']:
        archive.write(root/'source'/f'{role}.blend',f'blender/{role}.blend')
        archive.write(root.parents[1]/'public/assets/avatars'/f'{role}.glb',f'glb/{role}.glb')
        for path in folder.glob(f'{role}-*'):
            if 'probe' not in path.name: archive.write(path,'references/'+path.name)
    for name in ['DELIVERY.md','REALISM-RESEARCH.md']: archive.write(root/name,name)
    for name in ['geometry-report.json','glb-validation.json']: archive.write(folder/name,'validation/'+name)
print(output,output.stat().st_size)
