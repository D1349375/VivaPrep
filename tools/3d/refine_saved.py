import bpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from build_interviewers_v2 import PEOPLE,SOURCE,animate_character,export
bpy.context.preferences.filepaths.save_version=0
if hasattr(bpy.context.preferences.filepaths,'file_preview_type'):bpy.context.preferences.filepaths.file_preview_type='NONE'
for person in PEOPLE:
 bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(person['id']+'.blend')))
 rig=bpy.data.objects['VivaPrep_'+person['id']+'_Rig']
 for m in bpy.data.materials:
  if m.name.startswith(person['id']) and m.use_nodes:
   for n in m.node_tree.nodes:
    if n.type=='BSDF_PRINCIPLED': n.inputs['Sheen Weight'].default_value=0
 rig.animation_data_clear()
 for a in list(bpy.data.actions):bpy.data.actions.remove(a)
 animate_character(rig,person)
 export(rig,[rig]+list(rig.children),person)
 bpy.ops.file.pack_all(); bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(person['id']+'.blend')))
 print('REFINED',person['id'],flush=True)
