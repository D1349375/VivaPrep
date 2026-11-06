"""Render orthographic references from the delivered editable Blender models."""
import bpy, os, sys, json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from build_interviewers_v2 import PEOPLE, CLIPS, SOURCE, PREVIEW, render, pose_character, character_bounds

reports=[]
for person in PEOPLE:
    if os.environ.get('VIVAPREP_CHARACTER') and person['id']!=os.environ['VIVAPREP_CHARACTER']: continue
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(person['id']+'.blend')))
    rig=bpy.data.objects['VivaPrep_'+person['id']+'_Rig']
    camera=bpy.context.scene.camera
    furniture=[o for o in bpy.context.scene.objects if o.name.startswith(('QA_Chair','QA_Desk'))]
    quick=os.environ.get('VIVAPREP_QUICK_PREVIEW')=='1'
    actions_only=os.environ.get('VIVAPREP_ACTIONS_ONLY')=='1'
    if not quick and not actions_only:
        for side in ('front','side','back'): render(rig,person,camera,furniture,'standing-'+side,side,True)
    if not actions_only:
        for side in ('front','side'): render(rig,person,camera,furniture,'seated-'+side,side)
    if not quick:
        render(rig,person,camera,furniture,'portrait','threequarter',False,'SpeakingGesture',.5)
        bpy.context.scene.render.resolution_percentage=65
        for clip in CLIPS:
            render(rig,person,camera,furniture,'action-'+clip,'threequarter',False,clip,.5)
    rig.animation_data.action=None
    pose_character(rig,person)
    objects=[o for o in rig.children if o.type=='MESH']
    low,high=character_bounds(objects)
    reports.append({'id':person['id'],'rig':rig.name,'bones':len(rig.data.bones),
        'seatedBoundsMeters':[list(low),list(high)],'standingHeightMeters':person['height'],
        'seatHeightMeters':.46,'tableHeightMeters':.75,
        'pelvisAnchorMeters':list(rig.matrix_world@rig.pose.bones['pelvis'].head),
        'handAnchorsMeters':{s:list(rig.matrix_world@rig.pose.bones['hand_'+s].head) for s in ('l','r')},
        'clips':CLIPS})
    print('RENDER_COMPLETE',person['id'],flush=True)
(PREVIEW/'geometry-report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf8')
