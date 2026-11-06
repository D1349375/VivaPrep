"""Final pilot QA corrections, preserving the editable rig and packed materials."""
import bpy,bmesh,sys,json,numpy as np
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from build_interviewers_v2 import set_material
HERE=Path(__file__).parent;OUT=HERE/'review/zhou'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'zhou-review.blend'))
bpy.context.preferences.filepaths.save_version=0
if hasattr(bpy.context.preferences.filepaths,'file_preview_type'):bpy.context.preferences.filepaths.file_preview_type='NONE'
def ear(co):
    return abs(co.x)>.074 and ((co.y+.021)/.029)**2+((co.z-.736)/.033)**2<1.18
for name in ['Zhou_Hair_Crown','Zhou_Hair_IndividualFibers']:
    obj=bpy.data.objects[name];bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if ear(v.co)],context='VERTS')
    bm.to_mesh(obj.data);bm.free();obj.data.update()
head=bpy.data.objects['Zhou_FittedHead_Editable']
normals=np.empty(len(head.data.vertices)*3,dtype=np.float32);head.data.vertices.foreach_get('normal',normals);normals=normals.reshape(-1,3)
coords=np.empty(len(head.data.vertices)*3,dtype=np.float32);head.data.vertices.foreach_get('co',coords);coords=coords.reshape(-1,3)
indices=np.empty(len(head.data.loops),dtype=np.int32);head.data.loops.foreach_get('vertex_index',indices)
values=np.clip((-normals[indices,1]-.12)/.60,0,1);values=values*values*(3-2*values)
positions=coords[indices];values*=np.where(positions[:,2]<.752,np.clip((.060-np.abs(positions[:,0]))/.014,0,1),1)
colors=np.ones((len(indices),4),dtype=np.float32);colors[:,:3]=values[:,None]
head.data.color_attributes['ReferenceConfidence'].data.foreach_set('color',colors.ravel())
for o in list(bpy.data.objects):
    if o.type=='CAMERA' and o.name.startswith('REVIEW_') and '.' in o.name:bpy.data.objects.remove(o,do_unlink=True)
scene=bpy.context.scene;scene.camera=bpy.data.objects['REVIEW_ThreeQuarter']
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_percentage=100
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'zhou-review.blend'))
report=json.loads((OUT/'model-inspection.json').read_text(encoding='utf8'))
rig=bpy.data.objects['VivaPrep_logic_Rig']
report['meshes']=[dict(name=o.name,vertices=len(o.data.vertices),polygons=len(o.data.polygons)) for o in rig.children if o.type=='MESH']
report['headNeckWeights']='Smooth head / neck_01 blend; shared skeleton with body'
(OUT/'model-inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
for view,name in [('front','Front'),('threequarter','ThreeQuarter'),('side','Side'),('back','Back')]:
    scene.camera=bpy.data.objects['REVIEW_'+name]
    scene.render.filepath=str(OUT/f'zhou-{view}.png');bpy.ops.render.render(write_still=True)
    if view=='front':
        old=head.data.materials[0];head.data.materials[0]=set_material(bpy.data.materials.new('QA_FinalClay'),(.34,.31,.28),.8)
        scene.render.filepath=str(OUT/'zhou-clay.png');bpy.ops.render.render(write_still=True);head.data.materials[0]=old
camera=bpy.data.objects['QA_Camera'];scene.camera=camera;camera.data.ortho_scale=2.02
target=Vector((0,-.06,.72))
for view,delta in [('seated-front',(0,-6,0)),('seated-side',(6,0,0))]:
    camera.location=target+Vector(delta);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/f'zhou-{view}.png');bpy.ops.render.render(write_still=True)
print('FINAL_QA_RENDER_COMPLETE',flush=True)
