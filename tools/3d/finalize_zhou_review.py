"""Pack reference, corrected actions and useful inspection cameras in the pilot."""
import bpy,json
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).parent;OUT=HERE/'review/zhou'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'zhou-review.blend'))
bpy.context.preferences.filepaths.save_version=0
if hasattr(bpy.context.preferences.filepaths,'file_preview_type'):bpy.context.preferences.filepaths.file_preview_type='NONE'
rig=bpy.data.objects['VivaPrep_logic_Rig'];rig.animation_data_clear()
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
with bpy.data.libraries.load(str(HERE/'source/logic.blend'),link=False) as (src,dst):
    dst.actions=src.actions
rig.animation_data_create();rig.animation_data.action=bpy.data.actions['Idle']
for a in bpy.data.actions:a.use_fake_user=True
bpy.context.scene.frame_set(1)
reference=bpy.data.images.load(str(HERE.parents[1]/'public/assets/interviewer-logic.png'),check_existing=True)
reference.name='REFERENCE_Zhou_OriginalConcept';reference.pack()
scene=bpy.context.scene
target=Vector((0,-.045,1.22))
for name,delta in [('Front',(0,-4,0)),('ThreeQuarter',(2.4,-4,0)),('Side',(4,0,0)),('Back',(0,4,0))]:
    data=bpy.data.cameras.new('REVIEW_'+name);data.type='ORTHO';data.ortho_scale=.59
    cam=bpy.data.objects.new(data.name,data);scene.collection.objects.link(cam)
    cam.location=target+Vector(delta);cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
scene.camera=bpy.data.objects['REVIEW_ThreeQuarter']
head=bpy.data.objects['Zhou_FittedHead_Editable']
# Blend the neck into the head so nodding does not move the whole neck rigidly.
head_group=head.vertex_groups.get('head')
neck_group=head.vertex_groups.get('neck_01') or head.vertex_groups.new(name='neck_01')
buckets={}
for v in head.data.vertices:
    value=max(0,min(1,(v.co.z-.601)/.077));value=value*value*(3-2*value)
    if v.co.z>.640 and v.co.y<-.095:value=1
    key=round(value*30)/30;buckets.setdefault(key,[]).append(v.index)
for weight,ids in buckets.items():
    head_group.add(ids,weight,'REPLACE');neck_group.add(ids,1-weight,'REPLACE')
bpy.ops.object.select_all(action='DESELECT');head.select_set(True);bpy.context.view_layer.objects.active=head
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
scene.render.engine='BLENDER_EEVEE'
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'zhou-review.blend'))
report={'rig':rig.name,'bones':len(rig.data.bones),'actions':[a.name for a in bpy.data.actions],
    'meshes':[{ 'name':o.name,'vertices':len(o.data.vertices),'polygons':len(o.data.polygons)} for o in rig.children if o.type=='MESH'],
    'packedImages':[im.name for im in bpy.data.images if im.packed_file],
    'reviewStatus':'Not approved. One-image likeness pilot, transitional clothing and animation.'}
(OUT/'model-inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print('ZHOU_FINALIZED',json.dumps(report,ensure_ascii=False),flush=True)
