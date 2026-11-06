"""One editable, photo-fitted Zhou prototype; no changes to the other professors."""
import bpy, bmesh, math, random, sys, json
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix
sys.path.insert(0,str(Path(__file__).parent))
from build_interviewers_v2 import pose_character, PEOPLE, select_only, set_material

HERE=Path(__file__).parent
OUT=HERE/'review/zhou'; OUT.mkdir(parents=True,exist_ok=True)
P=next(p for p in PEOPLE if p['id']=='logic')
bpy.ops.wm.open_mainfile(filepath=str(HERE/'source/logic.blend'))
bpy.context.preferences.filepaths.save_version=0
if hasattr(bpy.context.preferences.filepaths,'file_preview_type'):
    bpy.context.preferences.filepaths.file_preview_type='NONE'
rig=bpy.data.objects['VivaPrep_logic_Rig']
rig.animation_data.action=None
pose_character(rig,P,standing=True)
for name in ['logic_Hair','logic_Eyes','logic_Eyebrows','logic_Eyelashes','logic_Teeth']:
    bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
body=bpy.data.objects['logic_Body']
bm=bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z>.590],context='VERTS')
bm.to_mesh(body.data);bm.free();body.data.update()

with bpy.data.libraries.load(str(HERE/'source/zhou-facebuilder-fit.blend'),link=False) as (src,dst):
    dst.objects=['Zhou_FittedHead']
head=dst.objects[0]; bpy.context.collection.objects.link(head)
head.name='Zhou_FittedHead_Editable'
SCALE=.095; OFFSET=Vector((0,-.034,.721))
for v in head.data.vertices: v.co=v.co*SCALE+OFFSET
bm=bmesh.new();bm.from_mesh(head.data)
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<.566],context='VERTS')
for v in bm.verts:
    if v.co.z<.620:
        t=min(1,(.620-v.co.z)/.054)
        v.co.x*=1-.30*t
        v.co.y=-.025+(v.co.y+.025)*(1-.18*t)
bm.to_mesh(head.data);bm.free();head.data.update()
head['source']='Fitted with KeenTools FaceBuilder to interviewer-logic.png; unseen sides estimated'
head['materialStage']='Reference-projected color, not final de-lit PBR albedo'

def skinned(obj):
    obj.parent=rig;obj.matrix_parent_inverse=Matrix.Identity(4)
    group=obj.vertex_groups.new(name='head')
    group.add(list(range(len(obj.data.vertices))),1.,'REPLACE')
    mod=obj.modifiers.new('Head motion','ARMATURE');mod.object=rig
    for poly in obj.data.polygons:poly.use_smooth=True

# A fitted three-dimensional head replaces the generic head, not a portrait plane.
mat=head.data.materials[0];mat.name='Zhou_Skin_ReferenceColour_WithMicroSurface'
nodes=mat.node_tree.nodes;links=mat.node_tree.links
shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
for link in list(shader.inputs['Emission Color'].links):links.remove(link)
shader.inputs['Emission Strength'].default_value=0
shader.inputs['Roughness'].default_value=.57
shader.inputs['IOR'].default_value=1.4
shader.inputs['Subsurface Weight'].default_value=.07
shader.inputs['Subsurface Scale'].default_value=.0015
shader.inputs['Subsurface Radius'].default_value=(1.,.42,.22)
texcoord=nodes.new('ShaderNodeTexCoord')
pores=nodes.new('ShaderNodeTexNoise');pores.inputs['Scale'].default_value=620;pores.inputs['Detail'].default_value=2
links.new(texcoord.outputs['Generated'],pores.inputs['Vector'])
bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.22;bump.inputs['Distance'].default_value=.00011
links.new(pores.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],shader.inputs['Normal'])
photo=next(n for n in nodes if n.type=='TEX_IMAGE')
separate=nodes.new('ShaderNodeSeparateXYZ');links.new(texcoord.outputs['Object'],separate.inputs[0])
fade=nodes.new('ShaderNodeMapRange');fade.inputs['From Min'].default_value=.632;fade.inputs['From Max'].default_value=.681
links.new(separate.outputs['Z'],fade.inputs['Value'])
mix=nodes.new('ShaderNodeMixRGB');mix.inputs[1].default_value=(.52,.32,.225,1)
links.new(photo.outputs['Color'],mix.inputs[2]);links.new(mix.outputs[0],shader.inputs['Base Color'])
select_only([head]); sub=head.modifiers.new('Surface refinement','SUBSURF');sub.levels=1
bpy.ops.object.modifier_apply(modifier=sub.name)
confidence=head.data.color_attributes.new(name='ReferenceConfidence',type='FLOAT_COLOR',domain='CORNER')
normals=np.empty(len(head.data.vertices)*3,dtype=np.float32);head.data.vertices.foreach_get('normal',normals);normals=normals.reshape(-1,3)
indices=np.empty(len(head.data.loops),dtype=np.int32);head.data.loops.foreach_get('vertex_index',indices)
values=np.clip((-normals[indices,1]-.12)/.60,0,1);values=values*values*(3-2*values)
coords=np.empty(len(head.data.vertices)*3,dtype=np.float32);head.data.vertices.foreach_get('co',coords);coords=coords.reshape(-1,3)[indices]
edge=np.where(coords[:,2]<.752,np.clip((.078-np.abs(coords[:,0]))/.022,0,1),1)
values*=edge
colors=np.ones((len(indices),4),dtype=np.float32);colors[:,:3]=values[:,None]
confidence.data.foreach_set('color',colors.ravel())
attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='ReferenceConfidence'
mult=nodes.new('ShaderNodeMath');mult.operation='MULTIPLY';links.new(fade.outputs[0],mult.inputs[0]);links.new(attr.outputs['Color'],mult.inputs[1])
alpha=nodes.new('ShaderNodeMath');alpha.operation='MULTIPLY';links.new(mult.outputs[0],alpha.inputs[0]);links.new(photo.outputs['Alpha'],alpha.inputs[1]);links.new(alpha.outputs[0],mix.inputs[0])
skinned(head)
print('HEAD_PREPARED',flush=True)

# Neutral gray-blue tie, pale shirt and restrained navy wool on the existing garment.
suit=bpy.data.objects['logic_Suit']
for material in suit.data.materials:
    bsdf=material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value=.83
    for n in material.node_tree.nodes:
        if n.type=='TEX_IMAGE' and n.image:
            import numpy as np
            image=n.image.copy();image.name='Zhou_NavyWool_PaleShirt_Texture'
            px=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(px);px=px.reshape(-1,4)
            rgb=px[:,:3];mx=rgb.max(1);mn=rgb.min(1);lum=rgb@np.array([.2126,.7152,.0722])
            coloured=(mx-mn>.12)&(mx>.2)
            rgb[coloured]=lum[coloured,None]*np.array([.40,.51,.70])
            white=(mn>.65);rgb[white]*=np.array([.87,.92,1.])
            image.pixels.foreach_set(px.ravel());image.update();image.pack();n.image=image

# Separate geometry hair: a short swept crown, dense guided fibers and gray strands.
rng=random.Random(2631)
hairmats=[]
for name,col in [('Charcoal',(.047,.043,.040)),('Ash',(.108,.101,.093)),('Silver',(.245,.231,.210)),('SoftGray',(.166,.154,.14))]:
    m=set_material(bpy.data.materials.new('Zhou_Hair_'+name),col,.48)
    bsdf=m.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Anisotropic'].default_value=.3
    hairmats.append(m)

def point(theta,phi,offset=0):
    # Slight left sweep, asymmetric crown and a compact back of the head.
    center=Vector((0,-.024,.759))
    normal=Vector((math.sin(theta)*math.cos(phi),math.sin(theta)*math.sin(phi),math.cos(theta)))
    hit=scalp_bvh.ray_cast(center+normal*.3,-normal,.5)[0]
    if hit is None: hit=center+Vector((normal.x*.088,normal.y*.102,normal.z*.095))
    lift=.002+.006*max(0,normal.z)**3
    return hit+normal*(offset+lift)

def boundary(phi):
    front=max(0,-math.sin(phi))
    # High open forehead; tapered sides and a longer rear neckline.
    return 1.88-.57*front**3+.10*math.cos(phi)*front

from mathutils.bvhtree import BVHTree
scalp_bvh=BVHTree.FromPolygons([v.co for v in head.data.vertices],[list(p.vertices) for p in head.data.polygons],all_triangles=False)
print('SCALP_BVH_READY',flush=True)
import numpy as np
pixels=np.array(photo.image.pixels[:],dtype=np.float32).reshape(photo.image.size[1],photo.image.size[0],4)
uv=head.data.uv_layers.active.data
hair_faces=set()
for poly in head.data.polygons:
    center=poly.center
    coord=sum((uv[i].uv for i in poly.loop_indices),Vector((0,0)))/len(poly.loop_indices)
    r,g,b,a=pixels[min(pixels.shape[0]-1,max(0,int(coord.y*pixels.shape[0]))),min(pixels.shape[1]-1,max(0,int(coord.x*pixels.shape[1])))]
    eligible=center.z>.777 or (abs(center.x)>.074 and center.z>.719) or (center.y>.0 and center.z>.724)
    back_and_sides=center.y>-.049 and center.z>.724
    crown=center.z>.822
    if back_and_sides or crown or (eligible and (g>r*.77 and b>r*.66 and r<.65)):hair_faces.add(poly.index)
mesh=head.data.copy();mesh.name='Zhou_HairCrownMesh'
print('HAIR_MASK_READY',len(hair_faces),flush=True)
bm=bmesh.new();bm.from_mesh(mesh);bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.index not in hair_faces],context='FACES')
for v in bm.verts:v.co+=v.normal*.0025
bm.to_mesh(mesh);bm.free();mesh.update()
cap=bpy.data.objects.new('Zhou_Hair_Crown',mesh);bpy.context.collection.objects.link(cap);skinned(cap)
hair_colour=set_material(bpy.data.materials.new('Zhou_Hair_ReferenceGuidedColour'),(.048,.044,.039),.63)
hn=hair_colour.node_tree.nodes;hl=hair_colour.node_tree.links;hbsdf=hn.get('Principled BSDF')
ht=hn.new('ShaderNodeTexImage');ht.image=photo.image
ha=hn.new('ShaderNodeVertexColor');ha.layer_name='ReferenceConfidence'
hm=hn.new('ShaderNodeMixRGB');hm.inputs[1].default_value=(.048,.044,.039,1)
hl.new(ha.outputs['Color'],hm.inputs[0]);hl.new(ht.outputs['Color'],hm.inputs[2]);hl.new(hm.outputs[0],hbsdf.inputs['Base Color'])
cap.data.materials.clear();cap.data.materials.append(hair_colour)

fiber=bpy.data.curves.new('Zhou_CombedFibers','CURVE');fiber.dimensions='3D';fiber.resolution_u=2
fiber.bevel_depth=.00024;fiber.bevel_resolution=1;fiber.resolution_u=2
for m in hairmats:fiber.materials.append(m)
for i in range(1200):
    phi=rng.uniform(0,math.tau);end=boundary(phi)*rng.uniform(.65,1.01)
    start=rng.uniform(.04,.55)
    # Twist the top as it sweeps from the part toward the side.
    twist=1.0 if math.cos(phi)<.25 else -.30
    points=[]
    for j in range(16):
        t=j/15; theta=start+(end-start)*t
        angle=phi+twist*(1-t)**1.3
        lift=.0016+.0014*math.sin(t*math.pi)+.00065*math.sin(t*math.tau*2+i*.25)
        q=point(theta,angle,lift+rng.uniform(-.0003,.0003))
        hit=scalp_bvh.find_nearest(q)
        if hit[2] in hair_faces:points.append((q,(.55+.45*math.sin(math.pi*t))*(1-.65*t**5)))
        elif points:break
    if len(points)<3:continue
    spline=fiber.splines.new('POLY');spline.points.add(len(points)-1)
    spline.material_index=rng.choices([0,1,2,3],[.66,.25,.01,.08])[0]
    for p,(q,radius) in zip(spline.points,points):p.co=(*q,1);p.radius=radius
hair=bpy.data.objects.new('Zhou_Hair_IndividualFibers',fiber);bpy.context.collection.objects.link(hair)
print('FIBERS_READY',len(fiber.splines),flush=True)
select_only([hair]);bpy.ops.object.convert(target='MESH');hair=bpy.context.object;skinned(hair)

# All deliverable geometry follows the existing editable humanoid rig.
rig['assetVersion']='Zhou likeness prototype 1'
rig['reviewStatus']='Not approved: one-image head fit, inferred rear, transitional body and animations'
pose_character(rig,P)
rig.animation_data.action=bpy.data.actions['Idle'];bpy.context.scene.frame_set(1)

scene=bpy.context.scene;scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.engine='BLENDER_EEVEE'
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.film_transparent=False;scene.view_settings.view_transform='AgX'
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.20,.22,.25,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.25
camera=scene.camera;camera.data.type='ORTHO'
target=Vector((0,-.045,1.22))
camera.data.ortho_scale=.59
camera.location=target+Vector((0,-4,.025));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
for area in bpy.context.screen.areas:
 if area.type=='VIEW_3D':
    area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
text=bpy.data.texts.new('先讀我_README')
text.write('周教授單人外觀樣板 v1\n真正的立體網格與獨立幾何髮絲，材質已封裝。\n先驗收五官、年齡感與側面；背面是依單張參考推定。\n皮膚仍使用原圖投影顏色，含原圖光影；微表面是程序細節，不是掃描毛孔。\n身體、服裝和六動作仍是過渡版；尚未做真人表演動捕與完整皮膚 PBR。\n尚未通過使用者驗收，不套用至其他兩位教授。\n')
select_only([head]);bpy.ops.file.pack_all()
print('SAVING_REVIEW',flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'zhou-review.blend'))
print('SAVED_REVIEW',flush=True)
for view,delta in [('front',(0,-4,0)),('threequarter',(2.4,-4,0)),('side',(4,0,0)),('back',(0,4,0))]:
    camera.location=target+Vector(delta);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/f'zhou-{view}.png');bpy.ops.render.render(write_still=True)
    print('RENDERED',view,flush=True)
    if view=='front':
        clay=set_material(bpy.data.materials.new('QA_Clay'),(.34,.31,.28),.8)
        old=head.data.materials[0];head.data.materials[0]=clay
        scene.render.filepath=str(OUT/'zhou-clay.png');bpy.ops.render.render(write_still=True)
        head.data.materials[0]=old
camera.data.ortho_scale=2.02;target=Vector((0,-.06,.72))
for view,delta in [('seated-front',(0,-6,0)),('seated-side',(6,0,0))]:
    camera.location=target+Vector(delta);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/f'zhou-{view}.png');bpy.ops.render.render(write_still=True)
print('ZHOU_REVIEW_COMPLETE',flush=True)
