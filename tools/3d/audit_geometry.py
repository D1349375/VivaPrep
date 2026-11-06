import bpy,json
from pathlib import Path
from mathutils import Vector
root=Path(__file__).parent
results=[]
for role in ['technical','portfolio','logic']:
 bpy.ops.wm.open_mainfile(filepath=str(root/'source'/(role+'.blend')))
 rig=bpy.data.objects['VivaPrep_'+role+'_Rig']
 rig.animation_data.action=bpy.data.actions['Idle']; bpy.context.scene.frame_set(1)
 bpy.context.view_layer.update(); deps=bpy.context.evaluated_depsgraph_get()
 bounds={}
 for obj in rig.children:
  if obj.type!='MESH':continue
  evaluated=obj.evaluated_get(deps)
  points=[evaluated.matrix_world@v.co for v in evaluated.data.vertices]
  bounds[obj.name]=[min(p.z for p in points),max(p.z for p in points)]
  if obj.name.endswith('_Suit'):
   butt=[p.z for p in points if abs(p.x)<.16 and -.035<p.y<.18 and p.z<.62]
   bounds['buttMin']=min(butt) if butt else None
 results.append({'id':role,'bounds':bounds})
print('GEOMETRY_AUDIT',json.dumps(results),flush=True)
(root/'preview/v2/initial-audit.json').write_text(json.dumps(results,indent=2))
