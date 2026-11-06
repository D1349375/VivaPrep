import bpy, sys, os, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import build_interviewers as old
old.load_mpfb()
from mpfb.services import HumanService
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
human=HumanService.create_human(mask_helpers=True,detailed_helpers=False,extra_vertex_groups=True,feet_on_ground=True,scale=.1,macro_detail_dict={'gender':1.,'age':.62,'muscle':.48,'weight':.50,'proportions':.5,'height':.52,'cupsize':.5,'firmness':.5,'race':{'asian':1.,'caucasian':0.,'african':0.}})
rig=HumanService.add_builtin_rig(human,'game_engine',import_weights=True)
bpy.context.view_layer.update()
print('HUMAN',tuple(human.location),tuple(human.dimensions),'RIG',tuple(rig.location),tuple(rig.scale))
for b in rig.data.bones:
 print('BONE',b.name,'head',tuple(round(v,4) for v in b.head_local),'tail',tuple(round(v,4) for v in b.tail_local),'parent',b.parent.name if b.parent else None)
print('MODIFIERS',[(m.name,m.type) for m in human.modifiers])
print('MESH', min(v.co.z for v in human.data.vertices),max(v.co.z for v in human.data.vertices))
bpy.ops.wm.save_as_mainfile(filepath=str(Path(__file__).parent/'source/probe.blend'))
