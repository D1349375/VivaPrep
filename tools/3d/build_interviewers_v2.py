"""Rebuild anatomically aligned, independently rigged VivaPrep interviewers.

Blender metres, +Z up, -Y forward. No furniture is selected for character export.
The MPFB rest skeleton MUST be fitted before any translation of the base mesh.
"""
from __future__ import annotations
import bpy, importlib, json, math, os, sys
from pathlib import Path
import numpy as np
from mathutils import Vector, Matrix, Quaternion

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / 'public/assets/avatars'
SOURCE = HERE / 'source'
PREVIEW = HERE / 'preview/v2'
for directory in (OUT, SOURCE, PREVIEW): directory.mkdir(parents=True, exist_ok=True)
CLIPS = ['Idle','Listening','ReadingNotes','SpeakingGesture','FollowUp','Thinking']
PEOPLE = [
 dict(id='technical', label='Professor Lin', chinese='林教授', gender=1., age=.63, weight=.51, height=1.72,
      skin='middleage_asian_male', hair='short04', hair_tint=(.26,.27,.29), suit='toigo_male_suit_3', glasses=True),
 dict(id='portfolio', label='Professor Chen', chinese='陳教授', gender=0., age=.58, weight=.49, height=1.67,
      skin='middleage_asian_female', hair='bob01', hair_tint=(.19,.16,.14), suit='toigo_female_suit_2', glasses=False),
 dict(id='logic', label='Professor Zhou', chinese='周教授', gender=1., age=.57, weight=.55, height=1.73,
      skin='middleage_asian_male', hair='short02', hair_tint=(.38,.39,.41), suit='toigo_male_suit_tie_and_jacket', glasses=False),
]

def load_mpfb():
    addon = Path(os.environ['MPFB_ADDON_PATH'])
    sys.path.insert(0,str(addon.parent))
    module=importlib.import_module('mpfb')
    user=Path(os.environ['MPFB_USER_DATA'])
    prefs={'mpfb_user_data':str(user),'mpfb_second_root':os.environ['MPFB_ASSET_ROOT'], 'mh_auto_user_data':False,'mh_user_data':''}
    module.get_preference=lambda name:prefs.get(name)
    bpy.utils.extension_path_user=lambda package,*args,**kwargs:str(user/package.split('.')[-1])
    module.register()

def select_only(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]

def set_material(material, color, roughness=.65):
    material.use_nodes=True
    shader=material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Roughness'].default_value=roughness
    return material

def tinted_image(source, name, treatment, person):
    # Bake the material colour operation into an embedded texture. This preserves
    # glTF's directly supported texture -> Principled base-colour graph.
    result=source.copy(); result.name=name
    pixels=np.empty(len(result.pixels),dtype=np.float32); result.pixels.foreach_get(pixels)
    pixels=pixels.reshape(-1,4); rgb=pixels[:,:3]
    if treatment=='hair':
        lum=rgb@np.array([.2126,.7152,.0722])
        rgb[:]=np.clip(lum[:,None]*np.array(person['hair_tint'])[None,:]*1.7,0,1)
    elif treatment=='suit' and person['id']=='portfolio':
        # The CC0 source has magenta wool and an ivory shirt. Recolour only wool.
        wool=(rgb[:,0] > rgb[:,1]*1.2) & (rgb[:,2] > rgb[:,1]*1.12)
        lum=rgb@np.array([.2126,.7152,.0722])
        rgb[wool]=np.clip(lum[wool,None]*np.array([1.25,1.08,.91]),0,1)
    elif treatment=='suit' and person['id']=='logic':
        dark=rgb.max(axis=1)<.66
        lum=rgb@np.array([.2126,.7152,.0722])
        rgb[dark]=np.clip(lum[dark,None]*np.array([.63,.70,.82]),0,1)
    elif treatment=='suit' and person['id']=='technical':
        red=(rgb[:,0]>rgb[:,1]*1.5)&(rgb[:,0]>rgb[:,2]*1.4)
        lum=rgb@np.array([.2126,.7152,.0722])
        rgb[red]=lum[red,None]*np.array([.65,.76,.92])
    result.pixels.foreach_set(pixels.ravel()); result.update(); result.pack()
    return result

def material_for(obj, kind, person, asset_root):
    for slot in obj.material_slots:
        old=slot.material
        if not old: continue
        old=old.copy(); slot.material=old; old.name=f"{person['id']}_{kind}"
        images=[n.image for n in old.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
        def resolved(image):
            if image.packed_file: return image
            matches=list(asset_root.rglob(Path(image.filepath.replace('\\','/')).name))
            if matches:
                image.filepath=str(matches[0]); image.reload()
            return image
        for image in images:
            resolved(image)
            limit={'eyes':512,'teeth':512,'eyebrows':512,'eyelashes':512,'hair':1024,'shoes':1024}.get(kind,2048)
            largest=max(image.size)
            if largest>limit:
                image.scale(round(image.size[0]*limit/largest),round(image.size[1]*limit/largest))
                image.pack()
        diffuse=next((i for i in images if not any(s in i.name.lower() for s in ('norm','bump','spec','_ao'))),None)
        normal=next((i for i in images if 'norm' in i.name.lower()),None)
        if diffuse and kind in ('hair','suit'): diffuse=tinted_image(diffuse,f"{person['id']}_{kind}_basecolor",kind,person)
        nodes=old.node_tree.nodes; nodes.clear()
        shader=nodes.new('ShaderNodeBsdfPrincipled')
        shader.inputs['Base Color'].default_value=(.2,.2,.2,1)
        shader.inputs['Roughness'].default_value={'skin':.62,'suit':.83,'hair':.68,'eyes':.24,'shoes':.42}.get(kind,.7)
        shader.inputs['IOR'].default_value=1.45
        # A constant sheen weight is not represented consistently by exporters;
        # use a matte dielectric wool material in both Blender and glTF.
        if kind=='suit': shader.inputs['Sheen Weight'].default_value=0
        if kind=='skin': shader.inputs['Subsurface Weight'].default_value=.045
        if diffuse:
            texture=nodes.new('ShaderNodeTexImage'); texture.image=diffuse
            old.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
            if kind in ('hair','eyebrows','eyelashes'):
                old.node_tree.links.new(texture.outputs['Alpha'],shader.inputs['Alpha'])
                old.surface_render_method='DITHERED'
                old.use_transparency_overlap=False
        if normal:
            normal.colorspace_settings.name='Non-Color'
            texture=nodes.new('ShaderNodeTexImage'); texture.image=normal
            norm=nodes.new('ShaderNodeNormalMap'); norm.inputs['Strength'].default_value=.35
            old.node_tree.links.new(texture.outputs['Color'],norm.inputs['Color'])
            old.node_tree.links.new(norm.outputs['Normal'],shader.inputs['Normal'])
        output=nodes.new('ShaderNodeOutputMaterial'); old.node_tree.links.new(shader.outputs['BSDF'],output.inputs['Surface'])

def character_bounds(objects):
    deps=bpy.context.evaluated_depsgraph_get()
    points=[]
    for obj in objects:
        if obj.type!='MESH': continue
        evaluated=obj.evaluated_get(deps)
        points.extend(evaluated.matrix_world@Vector(c) for c in evaluated.bound_box)
    return Vector(tuple(min(p[i] for p in points) for i in range(3))),Vector(tuple(max(p[i] for p in points) for i in range(3)))

def build_character(person):
    from mpfb.services import HumanService
    assets=Path(os.environ['MPFB_ASSET_ROOT'])
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions): bpy.data.actions.remove(action)
    # Joint helper groups are required to fit the skeleton to this phenotype.
    # They are removed by the body mask after fitting, never exported as skin.
    human=HumanService.create_human(mask_helpers=True,detailed_helpers=True,extra_vertex_groups=True,
        feet_on_ground=False,scale=.1,macro_detail_dict={'gender':person['gender'],'age':person['age'],
        'weight':person['weight'],'height':.51,'muscle':.47,'proportions':.50,'cupsize':.45,'firmness':.45,
        'race':{'asian':1.,'caucasian':0.,'african':0.}})
    human.name=f"{person['id']}_Body"
    HumanService.set_character_skin(str(assets/'skins'/person['skin']/(person['skin']+'.mhmat')),human,skin_type='MAKESKIN',material_instances=False)
    rig=HumanService.add_builtin_rig(human,'game_engine',import_weights=True)
    rig.name=f"VivaPrep_{person['id']}_Rig"; rig.data.name=rig.name+'_Skeleton'
    mesh_kinds=[(human,'skin')]
    for category,item,kind in [('eyes','high-poly','eyes'),('eyebrows','eyebrow001','eyebrows'),
        ('eyelashes','eyelashes01','eyelashes'),('teeth','teeth_base','teeth'),
        ('hair',person['hair'],'hair'),('clothes',person['suit'],'suit'),('clothes','shoes03','shoes')]:
        obj=HumanService.add_mhclo_asset(str(assets/category/item/(item+'.mhclo')),human,
            asset_type='Clothes' if category=='clothes' else category,subdiv_levels=0,material_type='MAKESKIN')
        obj.name=f"{person['id']}_{kind.title()}"
        mesh_kinds.append((obj,kind))
    for obj,kind in mesh_kinds:
        material_for(obj,kind,person,assets)
        for polygon in obj.data.polygons: polygon.use_smooth=True
        # Apply the phenotype to topology before subdivision; keep skeletal
        # deformation editable and active in the source and exported GLB.
        if obj.data.shape_keys:
            select_only([obj]); bpy.ops.object.shape_key_remove(all=True,apply_mix=True)
        # Real body occlusion masks from the garment are valid; no legs are cut.
        select_only([obj])
        for mod in list(obj.modifiers):
            if mod.type=='MASK': bpy.ops.object.modifier_apply(modifier=mod.name)
        if kind in ('skin','suit','shoes'):
            sub=obj.modifiers.new('Surface refinement','SUBSURF'); sub.levels=1; sub.render_levels=1
            # Refine bind topology before the armature for glTF parity.
            bpy.ops.object.modifier_move_up(modifier=sub.name)
            bpy.ops.object.modifier_apply(modifier=sub.name)
    objects=[rig]+[obj for obj,_ in mesh_kinds]
    bpy.context.view_layer.update()
    low,high=character_bounds(objects)
    scale=person['height']/(high.z-low.z)
    # Scale bind coordinates directly. Applying a parent object scale while its
    # children are selected can leave compensating parent inverses on clothes.
    # Every mesh and every joint must receive the identical metric transform.
    metric=Matrix.Scale(scale,4)
    for obj,kind in mesh_kinds:
        transform=metric@obj.matrix_world
        obj.parent=None
        obj.data.transform(transform)
        obj.matrix_world=Matrix.Identity(4)
    rig.data.transform(metric@rig.matrix_world)
    rig.matrix_world=Matrix.Identity(4)
    for obj,kind in mesh_kinds:
        obj.parent=rig; obj.matrix_parent_inverse=Matrix.Identity(4)
    bpy.context.view_layer.update()
    shoe_low,_=character_bounds([obj for obj,kind in mesh_kinds if kind=='shoes'])
    rig['ankleHeightMeters']=rig.data.bones['foot_l'].head_local.z-shoe_low.z
    if person['glasses']:
        objects.extend(add_glasses(rig,mesh_kinds[1][0],person))
    if person['id']=='portfolio': objects.extend(add_pen(rig))
    for bone in rig.pose.bones: bone.rotation_mode='QUATERNION'
    rig['role']=person['id']; rig['characterName']=person['chinese']; rig['assetVersion']=2
    rig['standingHeightMeters']=person['height']; rig['forward']='-Y (Blender), +Z (glTF)'
    rig['seatHeightMeters']=.46
    return rig,objects

def add_pen(rig):
    side='r'; hand=rig.data.bones['hand_r']
    index=rig.data.bones['index_01_r']; pinky=rig.data.bones['pinky_01_r']
    forward=(hand.tail_local-hand.head_local).normalized()
    palm=(index.head_local-pinky.head_local).cross(forward).normalized()
    direction=(forward*.50+palm*.86).normalized()
    grip=(index.tail_local+rig.data.bones['thumb_02_r'].tail_local)*.5
    center=grip-direction*.024
    materials=[set_material(bpy.data.materials.new('portfolio_PenBarrel'),(.045,.055,.06),.32),
               set_material(bpy.data.materials.new('portfolio_PenTip'),(.24,.27,.29),.26)]
    parts=[]
    for name,position,length,radius,material in [('Barrel',center,.09,.0025,materials[0]),('Tip',center+direction*.049,.010,.0013,materials[1])]:
        bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=radius,depth=length,location=position)
        obj=bpy.context.object; obj.name='portfolio_Pen'+name
        obj.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
        select_only([obj]); bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        obj.data.materials.append(material); obj.parent=rig; obj.matrix_parent_inverse=Matrix.Identity(4)
        g=obj.vertex_groups.new(name='hand_r'); g.add(list(range(len(obj.data.vertices))),1.,'REPLACE')
        mod=obj.modifiers.new('Pen held in right hand','ARMATURE'); mod.object=rig
        for face in obj.data.polygons: face.use_smooth=True
        parts.append(obj)
    return parts

def add_glasses(rig,eyes,person):
    # Use actual eye mesh bounds, never fixed coordinates from another body.
    bpy.context.view_layer.update()
    lo,hi=character_bounds([eyes]); z=(lo.z+hi.z)*.5; y=lo.y-.010
    material=set_material(bpy.data.materials.new('technical_BrushedGraphite'),(.075,.085,.095),.30)
    material.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.65
    parts=[]
    def curve(name,points,radius,cyclic=False):
        data=bpy.data.curves.new(name,'CURVE'); data.dimensions='3D'; data.bevel_depth=radius; data.bevel_resolution=3
        s=data.splines.new('POLY'); s.points.add(len(points)-1)
        for p,xyz in zip(s.points,points): p.co=(*xyz,1)
        s.use_cyclic_u=cyclic
        obj=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj)
        select_only([obj]); bpy.ops.object.convert(target='MESH'); obj=bpy.context.object
        obj.data.materials.append(material); obj.parent=rig
        group=obj.vertex_groups.new(name='head'); group.add(list(range(len(obj.data.vertices))),1.,'REPLACE')
        mod=obj.modifiers.new('Head skin','ARMATURE'); mod.object=rig
        for f in obj.data.polygons: f.use_smooth=True
        parts.append(obj)
    for side in (-1,1):
        curve(f'technical_Rim_{side}',[(side*.033+.027*math.copysign(abs(math.cos(t))**.55,math.cos(t)),y,z+.018*math.copysign(abs(math.sin(t))**.6,math.sin(t))) for t in np.linspace(0,math.tau,64,endpoint=False)],.0017,True)
        curve(f'technical_Temple_{side}',[(side*.060,y,z+.003),(side*.073,y+.05,z+.003),(side*.076,y+.10,z-.012)],.0016)
    curve('technical_Bridge',[(-.006,y,z+.003),(0,y-.004,z+.007),(.006,y,z+.003)],.0015)
    return parts

def update(): bpy.context.view_layer.update()

def point_bone(rig,name,direction):
    bone=rig.pose.bones[name]
    q=(bone.tail-bone.head).normalized().rotation_difference(Vector(direction).normalized())
    bone.matrix=Matrix.Translation(bone.head)@q.to_matrix().to_4x4()@Matrix.Translation(-bone.head)@bone.matrix
    update()

def rotate_world(rig,name,axis,angle):
    b=rig.pose.bones[name]
    b.matrix=Matrix.Translation(b.head)@Quaternion(Vector(axis),angle).to_matrix().to_4x4()@Matrix.Translation(-b.head)@b.matrix
    update()

def solve_arm(rig,side,target,elbow):
    upper=rig.pose.bones['upperarm_'+side]; lower=rig.pose.bones['lowerarm_'+side]
    shoulder=upper.head.copy(); target=Vector(target)-rig.location
    direction=target-shoulder; distance=direction.length
    a=upper.length; b=lower.length
    distance=min(distance,a+b-.006); axis=direction.normalized()
    center=(a*a-b*b+distance*distance)/(2*distance)
    bend=Vector(elbow)-rig.location-shoulder
    bend=(bend-axis*bend.dot(axis)).normalized()
    joint=shoulder+axis*center+bend*math.sqrt(max(0,a*a-center*center))
    point_bone(rig,upper.name,joint-shoulder)
    point_bone(rig,lower.name,target-lower.head)

def orient_hand(rig,side,forward,palm_normal):
    name='hand_'+side
    point_bone(rig,name,forward)
    hand=rig.pose.bones[name]
    # Across the knuckles crossed with finger direction gives palm normal.
    index=rig.pose.bones['index_01_'+side].head
    pinky=rig.pose.bones['pinky_01_'+side].head
    axis=Vector(forward).normalized()
    normal=(index-pinky).cross(axis).normalized()*(-1 if side=='l' else 1)
    wanted=Vector(palm_normal); wanted=(wanted-axis*wanted.dot(axis)).normalized()
    normal=(normal-axis*normal.dot(axis)).normalized()
    angle=math.atan2(axis.dot(normal.cross(wanted)),normal.dot(wanted))
    rotate_world(rig,name,axis,angle)

def curl_fingers(rig,side,amount,index_factor=1.):
    for finger in ('index','middle','ring','pinky'):
        for segment in (1,2,3):
            name=f'{finger}_{segment:02}_{side}'
            b=rig.pose.bones[name]
            b.rotation_quaternion=b.rotation_quaternion@Quaternion((1,0,0),amount*(index_factor if finger=='index' else 1))
    update()

def pose_character(rig,person,clip='Idle',phase=0.,standing=False):
    for bone in rig.pose.bones: bone.matrix_basis=Matrix.Identity(4)
    rig.location=(0,0,0); update()
    if standing:
        # Relaxed A-pose, original fitted human joint proportions.
        low,_=character_bounds([o for o in rig.children if o.type=='MESH'])
        rig.location.z=-low.z; update(); return
    pelvis=rig.pose.bones['pelvis']
    rig.location.z=.555-pelvis.head.z
    update()
    for side,sign in [('l',1),('r',-1)]:
        thigh=rig.pose.bones['thigh_'+side]
        calf=rig.pose.bones['calf_'+side]
        shin=Vector((sign*.012,.08,-1)).normalized()
        ankle_z=rig.get('ankleHeightMeters',.095)
        knee_z=ankle_z-calf.length*shin.z
        dz=(knee_z-(thigh.head.z+rig.location.z))/thigh.length
        if abs(dz)>.45: raise ValueError('Seat height incompatible with natural seated legs')
        point_bone(rig,'thigh_'+side,(sign*.04,-math.sqrt(1-dz*dz-.04**2),dz))
        point_bone(rig,'calf_'+side,(sign*.012,.08,-1))
        # Preserve the anatomical foot direction from the fitted standing rig.
        rest=rig.data.bones['foot_'+side]
        point_bone(rig,rest.name,rest.tail_local-rest.head_local)
    pulse=math.sin(math.pi*phase)**2
    wave=math.sin(math.tau*phase)
    lean={'Idle':.006*wave,'Listening':.014,'ReadingNotes':.08*pulse,
          'SpeakingGesture':.055*pulse,'FollowUp':.22*pulse,'Thinking':-.018*pulse}[clip]
    rotate_world(rig,'spine_01',(1,0,0),lean*.50)
    rotate_world(rig,'spine_02',(1,0,0),lean*.30)
    rotate_world(rig,'spine_03',(1,0,0),lean*.20)
    head_pitch=.006*wave
    head_turn=0.; head_tilt=0.
    if clip=='Listening': head_pitch=.14*math.sin(math.pi*phase*3)**2*pulse; head_tilt=.045*wave
    if clip=='ReadingNotes': head_pitch=.38*pulse; head_turn=.07*wave*pulse
    if clip=='SpeakingGesture': head_pitch=.035*wave; head_turn=-.055*pulse
    if clip=='FollowUp': head_pitch=-.055*pulse; head_turn=.025*wave
    if clip=='Thinking': head_turn=.23*pulse; head_tilt=.10*pulse; head_pitch=.045*pulse
    rotate_world(rig,'neck_01',(1,0,0),head_pitch*.35)
    rotate_world(rig,'head',(1,0,0),head_pitch*.65)
    rotate_world(rig,'head',(0,0,1),head_turn)
    rotate_world(rig,'head',(0,1,0),head_tilt)
    for side,sign in [('l',1),('r',-1)]:
        target=Vector((sign*.20,-.30,.775))
        palm=(0,0,-1); forward=(sign*-.16,-1,-.06)
        active=side=='r'
        if clip=='ReadingNotes':
            target.y-=.08*pulse; target.x+= (.028*math.sin(phase*math.tau*5) if active else .035*wave)*pulse
            target.z+=.016*pulse
            if person['id']!='portfolio' and not active: target.z+=.045*pulse*max(0,wave)
        if clip in ('SpeakingGesture','FollowUp') and active:
            target.z+=(.19 if clip=='SpeakingGesture' else .15)*pulse
            target.y-=(.10 if clip=='SpeakingGesture' else .16)*pulse
            target.x-=.055*pulse
            forward=Vector((sign*-.16*(1-pulse),-1,.35*pulse-.06*(1-pulse)))
            # Rotate a normal around the wrist axis. Linear interpolation of
            # opposing palm normals passes through zero and flips the wrist.
            palm=Quaternion(forward.normalized(),-sign*math.radians(110)*pulse)@Vector((0,0,-1))
        if clip=='SpeakingGesture' and person['id']=='portfolio' and not active:
            target.z+=.075*pulse; target.x+=.025*pulse
        if clip=='Thinking' and side=='l':
            target.x-=.09*pulse; target.z+=.17*pulse; target.y+=.08*pulse
            forward=Vector((sign*-.16*(1-pulse),-1+.3*pulse,.66*pulse-.06))
            palm=Quaternion(forward.normalized(),-sign*math.radians(95)*pulse)@Vector((0,0,-1))
        solve_arm(rig,side,target,(sign*.34,-.04,.69))
        orient_hand(rig,side,forward,palm)
        curl=.07
        if clip=='ReadingNotes' and active and person['id']=='portfolio': curl=.36*pulse+.07
        if clip=='FollowUp' and person['id']=='technical' and active: curl=.42*pulse+.07
        curl_fingers(rig,side,curl,index_factor=.1 if clip=='FollowUp' and active else 1.)
    update()

def animate_character(rig,person):
    rig.animation_data_create()
    deformations=[m for obj in rig.children for m in obj.modifiers if m.type=='ARMATURE']
    for mod in deformations: mod.show_viewport=False
    duration={'Idle':120,'Listening':96,'ReadingNotes':144,'SpeakingGesture':120,'FollowUp':108,'Thinking':144}
    for clip in CLIPS:
        action=bpy.data.actions.new(clip); action.use_fake_user=True
        rig.animation_data.action=action
        last=duration[clip]
        previous={}
        for frame in range(1,last+2,4):
            phase=(frame-1)/last
            bpy.context.scene.frame_set(frame)
            pose_character(rig,person,clip,phase)
            for b in rig.pose.bones:
                q=b.rotation_quaternion.copy()
                if b.name in previous and previous[b.name].dot(q)<0:
                    q.negate();b.rotation_quaternion=q
                previous[b.name]=q
                b.keyframe_insert('rotation_quaternion',frame=frame,group=b.name)
                b.keyframe_insert('location',frame=frame,group=b.name)
        action['description']=clip+' / seated / no root motion'
    rig.animation_data.action=bpy.data.actions['Idle']
    bpy.context.scene.frame_set(1); pose_character(rig,person)
    for mod in deformations: mod.show_viewport=True
    update()
    bpy.context.scene.frame_end=121

def box(name,location,scale,color):
    bpy.ops.mesh.primitive_cube_add(size=1,location=location)
    o=bpy.context.object; o.name=name; o.dimensions=scale
    select_only([o]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(set_material(bpy.data.materials.new(name+'_material'),color,.8))
    bevel=o.modifiers.new('Soft edges','BEVEL'); bevel.width=.012; bevel.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

def studio():
    scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE'
    scene.render.resolution_x=720; scene.render.resolution_y=960; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGB'
    scene.render.film_transparent=False
    scene.world.use_nodes=True; scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.32,.35,.40,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
    scene.view_settings.view_transform='AgX'
    floor=box('QA_Floor',(0,0,-.026),(200,200,.04),(.54,.55,.55))
    chair=[box('QA_Chair_Seat',(0,.01,.425),(.49,.46,.07),(.12,.15,.17)),box('QA_Chair_Back',(0,.245,.77),(.49,.06,.64),(.12,.15,.17))]
    for x in (-.19,.19):
        for y in (-.16,.18): chair.append(box('QA_Chair_Leg',(x,y,.20),(.025,.025,.40),(.09,.10,.11)))
    # Only a narrow side guide, leaving the whole body visible in orthographic QA.
    desk=[box('QA_Desk_Height_Guide',(.42,-.43,.735),(.06,.40,.03),(.38,.26,.18)),
          box('QA_Desk_Guide_Leg',(.42,-.58,.36),(.028,.028,.72),(.28,.20,.15))]
    def aim(o,target): o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    for name,pos,energy,size,color in [('Key',(-3,-4,4),380,3,(1,.91,.83)),('Fill',(3,-2,2.8),240,3,(.85,.92,1)),('Rim',(1,3,3.8),430,2.4,(1,.94,.86))]:
        light=bpy.data.lights.new('QA_'+name,'AREA'); light.energy=energy; light.shape='DISK'; light.size=size; light.color=color
        obj=bpy.data.objects.new(light.name,light); scene.collection.objects.link(obj); obj.location=pos; aim(obj,(0,0,.8))
    camera=bpy.data.objects.new('QA_Camera',bpy.data.cameras.new('QA_Camera')); scene.collection.objects.link(camera)
    camera.data.type='ORTHO'; camera.data.ortho_scale=2.02; scene.camera=camera
    return camera,chair+desk

def render(rig,person,camera,furniture,name,side='front',standing=False,clip='Idle',phase=0):
    rig.animation_data.action=None
    pose_character(rig,person,clip,phase,standing)
    for o in furniture: o.hide_render=standing
    target=Vector((0,-.06,.90 if standing else .72))
    camera.data.ortho_scale=2.02
    camera.location=target+Vector({'front':(0,-6,0),'side':(6,0,0),'back':(0,6,0),'threequarter':(4,-6,.5)}[side])
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.scene.render.filepath=str(PREVIEW/f"{person['id']}-{name}.png")
    bpy.ops.render.render(write_still=True)

def export(rig,objects,person):
    rig.animation_data.action=bpy.data.actions['Idle']; bpy.context.scene.frame_set(1)
    pose_character(rig,person)
    select_only(objects)
    temporary=OUT/(person['id']+'.building.glb')
    bpy.ops.export_scene.gltf(filepath=str(temporary),export_format='GLB',use_selection=True,
        export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,
        export_skins=True,export_materials='EXPORT',export_apply=True,export_yup=True,
        export_cameras=False,export_lights=False,export_extras=True)
    temporary.replace(OUT/(person['id']+'.glb'))

def main():
    load_mpfb()
    bpy.context.preferences.filepaths.save_version=0
    bpy.context.scene.unit_settings.system='METRIC'; bpy.context.scene.unit_settings.scale_length=1
    bpy.context.scene.render.fps=30
    only=os.environ.get('VIVAPREP_CHARACTER')
    for person in PEOPLE:
        if only and person['id']!=only: continue
        rig,objects=build_character(person)
        pose_character(rig,person)
        print('BUILD',person['id'],'JOINTS',[(n,tuple(round(v,3) for v in rig.matrix_world@rig.pose.bones[n].head)) for n in ('pelvis','head','thigh_l','calf_l','foot_l','hand_l')],flush=True)
        if os.environ.get('VIVAPREP_PROBE')!='1': animate_character(rig,person)
        else: rig.animation_data_create()
        camera,furniture=studio()
        if os.environ.get('VIVAPREP_PROBE')=='1':
            bpy.context.scene.render.resolution_percentage=65
            render(rig,person,camera,furniture,'probe-front')
            render(rig,person,camera,furniture,'probe-side','side')
            pose_character(rig,person)
            bpy.ops.file.pack_all(); bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(person['id']+'-probe.blend')))
            continue
        export(rig,objects,person)
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(person['id']+'.blend')))
        if os.environ.get('VIVAPREP_SKIP_PREVIEW_RENDER')!='1':
            for side in ('front','side','back'): render(rig,person,camera,furniture,'standing-'+side,side,True)
            for side in ('front','side'): render(rig,person,camera,furniture,'seated-'+side,side)
            render(rig,person,camera,furniture,'portrait','threequarter',False,'SpeakingGesture',.5)
        print('COMPLETE',person['id'],flush=True)

if __name__=='__main__': main()
