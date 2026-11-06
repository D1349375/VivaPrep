import bpy,sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from build_interviewers_v2 import PEOPLE,SOURCE,pose_character,character_bounds
for person in PEOPLE:
 bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(person['id']+'.blend')))
 rig=bpy.data.objects['VivaPrep_'+person['id']+'_Rig']
 rig.animation_data.action=bpy.data.actions['Idle']; bpy.context.scene.frame_set(1); bpy.context.view_layer.update()
 animated={b.name:b.matrix.copy() for b in rig.pose.bones}
 before=character_bounds(list(rig.children))
 rig.animation_data.action=None; pose_character(rig,person)
 manual={b.name:b.matrix.copy() for b in rig.pose.bones}
 after=character_bounds(list(rig.children))
 diffs={n:max(abs(animated[n][i][j]-manual[n][i][j]) for i in range(4) for j in range(4)) for n in manual}
 print('PARITY',person['id'],'diffs',{n:v for n,v in diffs.items() if v>.001},'bounds before',list(map(list,before)),'after',list(map(list,after)),flush=True)
