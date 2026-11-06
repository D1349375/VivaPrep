import bpy,json
from pathlib import Path
root=Path(__file__).parent
bpy.ops.wm.open_mainfile(filepath=str(root/'source/logic.blend'))
rig=bpy.data.objects['VivaPrep_logic_Rig']
for name in ['head','neck_01','spine_03']:
 b=rig.data.bones[name];print('BONE',name,list(b.head_local),list(b.tail_local))
for o in rig.children:
 if o.type=='MESH':print('MESH',o.name,len(o.data.vertices),[(min(v.co[i] for v in o.data.vertices),max(v.co[i] for v in o.data.vertices)) for i in range(3)])
bpy.ops.wm.open_mainfile(filepath=str(root/'source/zhou-facebuilder-fit.blend'))
o=bpy.data.objects['Zhou_FittedHead'];print('FACE',list(o.location),list(o.rotation_euler),list(o.scale),len(o.data.uv_layers))
print('FACE_POLYS',len(o.data.polygons),'IMAGES',[(im.name,list(im.size)) for im in bpy.data.images])
verts=[tuple(v.co) for v in o.data.vertices]; faces=[list(p.vertices) for p in o.data.polygons]
(root/'preview/v2/face-geometry.json').write_text(json.dumps({'v':verts,'f':faces}))
