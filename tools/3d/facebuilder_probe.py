import bpy, sys, os, json
from pathlib import Path
folder=Path(os.environ['TEMP'])/'VivaPrep-KeenTools'
sys.path.insert(0,str(folder))
import keentools
from keentools.blender_independent_packages import pykeentools_loader as loader
if not loader.is_installed(): loader.install_core_from_file(str(folder/'keentools-core-2026.3.1-windows.zip'))
keentools.register()
from keentools.addon_config import fb_settings
from keentools.facebuilder.head import MESH_OT_FBAddHead
from keentools.facebuilder.fbloader import FBLoader
from keentools.utils.attrs import add_to_fb_collection
from keentools.facebuilder.pick_operator import _init_fb_detected_faces
from keentools.utils.detect_faces import get_detected_faces
from keentools.utils.focal_length import configure_focal_mode_and_fixes
from keentools.utils.coords import update_head_mesh_non_neutral

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
s=fb_settings(); obj=MESH_OT_FBAddHead.new_head(); add_to_fb_collection(obj)
h=s.heads.add(); h.headobj=obj; h.reset_sensor_size(); s.current_headnum=0
FBLoader.set_keentools_attributes(obj)
root=Path(__file__).resolve().parents[2]
c=FBLoader.add_new_camera_with_image(0,str(root/'public/assets/interviewer-logic.png'))
print('CAMERA',c,flush=True)
fb=FBLoader.get_builder()
print('BUILDER_METHODS',[n for n in dir(fb) if not n.startswith('_')],flush=True)
_init_fb_detected_faces(fb,0,0)
faces=get_detected_faces(); print('DETECTED',len(faces),flush=True)
kid=h.get_camera(0).get_keyframe()
configure_focal_mode_and_fixes(fb,h)
ok=fb.detect_face_pose(kid,faces[0]); print('FIT',ok,flush=True)
if ok:
    fb.remove_pins(kid); fb.add_preset_pins_and_solve(kid)
    update_head_mesh_non_neutral(fb,h)
    FBLoader.update_all_camera_positions(0)
    FBLoader.update_all_camera_focals(0)
    FBLoader.update_camera_pins_count(0,0)
    FBLoader.save_fb_serial_and_image_pathes(0)
    from keentools.utils.materials import bake_tex, show_texture_in_mat, assign_material_to_object
    s.tex_width=2048; s.tex_height=2048
    print('BAKE',bake_tex(0,'Zhou_ReferenceProjection'),flush=True)
    mat=show_texture_in_mat('Zhou_ReferenceProjection','Zhou_ProjectionPreview')
    assign_material_to_object(obj,mat)
    obj.name='Zhou_FittedHead'
    print('BOUNDS',[(min(v.co[i] for v in obj.data.vertices),max(v.co[i] for v in obj.data.vertices)) for i in range(3)],flush=True)
    print('CAM',list(c.camobj.location),list(c.camobj.rotation_euler),'SCALE',fb.current_scale(), 'EMOTIONS',fb.use_emotions(),flush=True)
    bpy.context.scene.camera=c.camobj
    scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE'
    scene.render.resolution_x=1024; scene.render.resolution_y=864; scene.render.resolution_percentage=100
    scene.world.use_nodes=True; scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
    scene.render.film_transparent=True
    # Neutral self-lit reference projection is used only for geometric alignment review.
    shader=mat.node_tree.nodes.get('Principled BSDF')
    tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE')
    shader.inputs['Emission Strength'].default_value=1
    mat.node_tree.links.new(tex.outputs['Color'],shader.inputs['Emission Color'])
    scene.view_settings.view_transform='Standard'
    scene.render.filepath=str(root/'tools/3d/preview/v2/zhou-face-fit.png')
    bpy.ops.render.render(write_still=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(root/'tools/3d/source/zhou-facebuilder-fit.blend'))
    print('FITTED',len(obj.data.vertices),flush=True)
