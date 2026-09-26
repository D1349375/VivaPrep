"""Build the three replaceable VivaPrep interviewer assets with Blender + MPFB.

Required environment variables when MPFB is not already loaded in Blender:
  MPFB_ADDON_PATH   Path to the MPFB add-on directory (the directory named ``mpfb``).
  MPFB_ASSET_ROOT   Extracted CC0 MakeHuman system assets and suits01 asset packs.

The generated GLBs are self-contained and are written to public/assets/avatars.
The source blend is packed so its texture maps travel with it.
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path
import sys

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = ROOT / "public" / "assets" / "avatars"
SOURCE_DIR = Path(__file__).resolve().parent / "source"
PREVIEW_DIR = Path(__file__).resolve().parent / "preview"
ASSET_DIR.mkdir(parents=True, exist_ok=True)
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


PEOPLE = [
    {
        "id": "technical",
        "label": "Technical Interviewer",
        "gender": 0.0,
        "age": 0.62,
        "height": 0.53,
        "weight": 0.46,
        "skin": "middleage_asian_male",
        "hair": "short04/short04.mhclo",
        "hair_tint": (0.34, 0.28, 0.22, 1.0),
        "suit": "toigo_male_suit_tie_and_jacket/toigo_male_suit_tie_and_jacket.mhclo",
        "suit_tint": (0.62, 0.70, 0.82, 1.0),
        "glasses": (0.12, 0.15, 0.18, 1.0),
        "speaker_side": "r",
    },
    {
        "id": "portfolio",
        "label": "Portfolio Interviewer",
        "gender": 1.0,
        "age": 0.60,
        "height": 0.48,
        "weight": 0.50,
        "skin": "middleage_asian_female",
        "hair": "bob02/bob02.mhclo",
        "hair_tint": (0.30, 0.24, 0.21, 1.0),
        "suit": "toigo_female_double-breasted_suit/toigo_female_double-breasted_suit.mhclo",
        "suit_tint": (0.86, 0.77, 0.66, 1.0),
        "glasses": None,
        "speaker_side": "l",
    },
    {
        "id": "logic",
        "label": "Logic Interviewer",
        "gender": 0.0,
        "age": 0.80,
        "height": 0.50,
        "weight": 0.49,
        "skin": "old_asian_male",
        "hair": "short02/short02.mhclo",
        "hair_tint": (0.78, 0.80, 0.82, 1.0),
        "suit": "toigo_male_double-breasted_suit/toigo_male_double-breasted_suit.mhclo",
        "suit_tint": (0.65, 0.70, 0.76, 1.0),
        "glasses": (0.27, 0.26, 0.23, 1.0),
        "speaker_side": "r",
    },
]


ANIMATED_BONES = (
    "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head",
    "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
    "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
    "index_01_l", "index_02_l", "index_03_l",
    "index_01_r", "index_02_r", "index_03_r",
)

# MPFB's game-engine rig ships in an open, standing calibration pose. These
# joint offsets give the interviewers a relaxed seated baseline with forearms
# angled toward the desk; each exported clip is authored relative to this pose.
SEATED_REST_POSE = {
    "upperarm_l": (0.85, 0.0, 0.0),
    "upperarm_r": (0.85, 0.0, 0.0),
    "lowerarm_l": (0.55, 0.0, 0.0),
    "lowerarm_r": (0.55, 0.0, 0.0),
}


def load_mpfb():
    """Load the installed MPFB module and point its asset service at the local pack."""
    asset_root = Path(os.environ.get("MPFB_ASSET_ROOT", "")).expanduser()
    if not asset_root.is_dir():
        raise RuntimeError("Set MPFB_ASSET_ROOT to the extracted local MakeHuman asset packs.")

    module = next(
        (importlib.import_module(name) for name in tuple(sys.modules)
         if name == "mpfb" or name.endswith(".mpfb")
         if getattr(importlib.import_module(name), "MPFB_CONTEXTUAL_INFORMATION", None) is not None),
        None,
    )
    if module is None:
        addon_path = Path(os.environ.get("MPFB_ADDON_PATH", "")).expanduser()
        if not (addon_path / "__init__.py").is_file():
            raise RuntimeError("Set MPFB_ADDON_PATH to the MPFB add-on folder, or enable MPFB in Blender first.")
        sys.path.insert(0, str(addon_path.parent))
        module = importlib.import_module("mpfb")
        user_data = Path(os.environ.get("MPFB_USER_DATA", str(Path.home() / ".mpfb-vivaprep"))).expanduser()
        preferences = {
            "mpfb_user_data": str(user_data),
            "mpfb_second_root": str(asset_root),
            "mh_auto_user_data": False,
            "mh_user_data": "",
        }
        module.get_preference = lambda name: preferences.get(name)
        bpy.utils.extension_path_user = lambda package, *args, **kwargs: str(user_data / package.split(".")[-1])
        module.register()
    return module


def assign_tint(material, tint, factor=0.72, roughness=None):
    """Build a glTF-friendly, textured Principled material for one MPFB asset."""
    if not material:
        return
    old_nodes = material.node_tree.nodes
    image_node = next(
        (node for node in old_nodes if node.type == "TEX_IMAGE" and node.image and "diffuse" in node.name.lower()),
        next((node for node in old_nodes if node.type == "TEX_IMAGE" and node.image), None),
    )
    diffuse_image = image_node.image if image_node else None
    old_nodes.clear()
    shader = old_nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = tint
    if roughness is not None:
        shader.inputs["Roughness"].default_value = roughness
    if shader.inputs.get("Sheen Weight"):
        shader.inputs["Sheen Weight"].default_value = 0.12
    if shader.inputs.get("Subsurface Weight") and material.name.lower().endswith(".body"):
        shader.inputs["Subsurface Weight"].default_value = 0.055
    if diffuse_image:
        texture = old_nodes.new("ShaderNodeTexImage")
        texture.image = diffuse_image
        texture.interpolation = "Linear"
        # Keep the exported graph to glTF's directly supported texture input.
        # Baking a color multiply here can make browser GLTFLoader fall back to
        # the procedural stand-in on some graphics stacks.
        material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        if diffuse_image.channels == 4:
            material.node_tree.links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
            if hasattr(material, "surface_render_method"):
                material.surface_render_method = "DITHERED"
    output = old_nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    material.diffuse_color = tint


def tint_named_materials(objects, match, tint, factor, roughness):
    touched = set()
    for obj in objects:
        for slot in obj.material_slots:
            material = slot.material
            # MPFB prefixes every material with the human name (which contains
            # the word "body"); match only the asset suffix after the final dot.
            asset_name = material.name.lower().rsplit(".", 1)[-1] if material else ""
            image_names = " ".join(
                node.image.name.lower() for node in material.node_tree.nodes
                if node.type == "TEX_IMAGE" and node.image
            ) if material and material.use_nodes else ""
            if material and (match in asset_name or match in image_names) and material.name not in touched:
                assign_tint(material, tint, factor, roughness)
                touched.add(material.name)


def normalize_texture_paths(asset_root):
    """Resolve MPFB's ``//asset-data`` references before packing/exporting textures."""
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            image = getattr(node, "image", None)
            if image is None or image.source != "FILE":
                continue
            original = image.filepath.replace("\\", "/")
            marker = "asset-data/"
            relative = original.split(marker, 1)[1] if marker in original else None
            candidate = asset_root / relative if relative else asset_root / image.name
            if not candidate.is_file():
                matches = list(asset_root.rglob(image.name))
                candidate = matches[0] if matches else candidate
            if candidate.is_file() and Path(bpy.path.abspath(image.filepath)) != candidate:
                image.filepath = str(candidate.resolve())
                image.reload()


def add_glasses(rig, tint, person_id):
    """Create lightweight frames as separate skinned geometry on the head bone."""
    frame_material = bpy.data.materials.new(f"{person_id} glasses | brushed titanium")
    frame_material.diffuse_color = tint
    frame_material.use_nodes = True
    shader = frame_material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = tint
    shader.inputs["Metallic"].default_value = 0.68
    shader.inputs["Roughness"].default_value = 0.28

    parts = []
    for x in (-0.029, 0.029):
        bpy.ops.mesh.primitive_torus_add(
            major_segments=32, minor_segments=10,
            major_radius=0.027, minor_radius=0.0025,
            location=(x, -0.151, 1.414), rotation=(1.5708, 0.0, 0.0),
        )
        lens = bpy.context.object
        lens.name = f"{person_id} glasses lens rim {len(parts) + 1}"
        lens.scale = (1.08, 0.80, 1.0)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        parts.append(lens)

    def add_temple(name, points, bevel):
        curve = bpy.data.curves.new(name, "CURVE")
        curve.dimensions = "3D"
        curve.resolution_u = 2
        curve.bevel_depth = bevel
        curve.bevel_resolution = 3
        spline = curve.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for point, xyz in zip(spline.points, points):
            point.co = (*xyz, 1.0)
        obj = bpy.data.objects.new(name, curve)
        bpy.context.collection.objects.link(obj)
        parts.append(obj)

    add_temple(f"{person_id} glasses bridge", [(-0.003, -0.153, 1.414), (0.0, -0.162, 1.414), (0.003, -0.153, 1.414)], 0.0025)
    for side in (-1, 1):
        add_temple(
            f"{person_id} glasses temple {side}",
            [(side * 0.055, -0.147, 1.414), (side * 0.067, -0.11, 1.414), (side * 0.068, -0.045, 1.402)],
            0.0018,
        )

    bpy.context.view_layer.objects.active = parts[0]
    for part in parts:
        part.data.materials.append(frame_material)
        if part.type != "MESH":
            # Convert curve splines to a mesh so the armature modifier deforms the glasses.
            bpy.context.view_layer.objects.active = part
            part.select_set(True)
            bpy.ops.object.convert(target="MESH")
            part = bpy.context.object
            part.select_set(False)
        part.parent = rig
        part.matrix_parent_inverse = rig.matrix_world.inverted()
        group = part.vertex_groups.new(name="head")
        group.add(list(range(len(part.data.vertices))), 1.0, "REPLACE")
        armature_modifier = part.modifiers.new("Follow interviewer head", "ARMATURE")
        armature_modifier.object = rig


def hide_lower_body_under_interview_table(objects):
    """Keep legs out of the interview-camera view while the hips sit at chair height.

    The room owns the chair and table as separate scene objects. The desktop and apron
    occlude the lower body; this mask removes only the lower central leg area so the
    unposed standing rest mesh cannot read as a full-height person standing behind it.
    Arm vertices outside the torso width remain intact for desk gestures.
    """
    for obj in objects:
        if obj.type != "MESH":
            continue
        lower = [
            vertex.index for vertex in obj.data.vertices
            if vertex.co.z < 0.30 and abs(vertex.co.x) < 0.24
        ]
        if not lower:
            continue
        group = obj.vertex_groups.new(name="VivaPrep seated silhouette")
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        group.remove(lower)
        modifier = obj.modifiers.new("Hide lower legs behind table", "MASK")
        modifier.vertex_group = group.name


def animation_poses(person):
    side = person["speaker_side"]
    sign = 1.0 if side == "l" else -1.0
    other = "r" if side == "l" else "l"
    poses = {
        "Idle": [
            (1, {}), (18, {"spine_02": (0.025, 0.0, 0.0), "head": (0.025, 0.0, 0.0)}),
            (36, {"spine_02": (0.010, 0.0, 0.0)}), (54, {}),
        ],
        "Listening": [
            (1, {}), (10, {"head": (0.11, 0.0, 0.0)}),
            (17, {"head": (0.14, 0.025, 0.035)}), (26, {"head": (-0.035, 0.0, 0.0)}), (38, {}),
        ],
        "ReadingNotes": [
            (1, {}), (10, {"head": (0.19, 0.0, 0.0), f"upperarm_{other}": (0.24 * -sign, 0.0, 0.0), f"lowerarm_{other}": (0.42 * -sign, 0.0, 0.0)}),
            (18, {"head": (0.22, 0.0, 0.0), f"upperarm_{other}": (0.30 * -sign, 0.0, 0.0), f"lowerarm_{other}": (0.56 * -sign, 0.0, 0.0), f"hand_{other}": (0.08, 0.0, 0.0)}),
            (26, {"head": (0.18, 0.0, 0.0), f"upperarm_{other}": (0.22 * -sign, 0.0, 0.0), f"lowerarm_{other}": (0.40 * -sign, 0.0, 0.0)}), (38, {}),
        ],
        "SpeakingGesture": [
            (1, {}), (9, {"spine_02": (0.035, 0.0, 0.0), "head": (0.035, 0.0, 0.0), f"upperarm_{side}": (0.40 * sign, 0.0, 0.0), f"lowerarm_{side}": (0.48 * sign, 0.0, 0.0)}),
            (17, {"spine_02": (0.045, 0.0, 0.0), "head": (0.10, 0.0, 0.0), f"upperarm_{side}": (0.64 * sign, 0.0, 0.0), f"lowerarm_{side}": (0.78 * sign, 0.0, 0.0), f"hand_{side}": (0.20 * sign, 0.0, 0.0)}),
            (25, {"head": (0.035, 0.0, 0.0), f"upperarm_{side}": (0.44 * sign, 0.0, 0.0), f"lowerarm_{side}": (0.54 * sign, 0.0, 0.0)}), (36, {}),
        ],
        "FollowUp": [
            (1, {}), (8, {"spine_02": (0.08, 0.0, 0.0), "spine_03": (0.055, 0.0, 0.0), "head": (0.08, 0.0, 0.0), f"upperarm_{side}": (0.58 * sign, 0.0, 0.0), f"lowerarm_{side}": (0.66 * sign, 0.0, 0.0)}),
            (18, {"spine_02": (0.10, 0.0, 0.0), "head": (0.13, 0.0, 0.0), f"upperarm_{side}": (0.78 * sign, 0.0, 0.0), f"lowerarm_{side}": (0.90 * sign, 0.0, 0.0), f"index_01_{side}": (0.35, 0.0, 0.0), f"index_02_{side}": (0.18, 0.0, 0.0)}),
            (26, {"spine_02": (0.075, 0.0, 0.0), "head": (0.06, 0.0, 0.0), f"upperarm_{side}": (0.57 * sign, 0.0, 0.0), f"lowerarm_{side}": (0.70 * sign, 0.0, 0.0)}), (38, {}),
        ],
        "Thinking": [
            (1, {}), (12, {"head": (0.08, 0.09, 0.06), f"upperarm_{other}": (0.42 * -sign, 0.0, 0.0), f"lowerarm_{other}": (0.66 * -sign, 0.0, 0.0)}),
            (24, {"head": (0.06, 0.08, 0.05), f"upperarm_{other}": (0.54 * -sign, 0.0, 0.0), f"lowerarm_{other}": (0.80 * -sign, 0.0, 0.0), f"hand_{other}": (0.10, 0.0, 0.0)}),
            (36, {"head": (0.02, 0.03, 0.02), f"upperarm_{other}": (0.30 * -sign, 0.0, 0.0), f"lowerarm_{other}": (0.45 * -sign, 0.0, 0.0)}), (48, {}),
        ],
    }
    return poses


def create_animations(rig, person):
    animation_data = rig.animation_data_create()
    created = []
    for name, poses in animation_poses(person).items():
        action = bpy.data.actions.new(f"{person['id']}_{name}")
        animation_data.action = action
        action_bones = sorted({bone_name for _, pose in poses for bone_name in pose} | set(SEATED_REST_POSE))
        for frame, pose in poses:
            for bone_name in action_bones:
                bone = rig.pose.bones.get(bone_name)
                if bone is None:
                    continue
                bone.rotation_mode = "XYZ"
                base = SEATED_REST_POSE.get(bone_name, (0.0, 0.0, 0.0))
                offset = pose.get(bone_name, (0.0, 0.0, 0.0))
                bone.rotation_euler = tuple(a + b for a, b in zip(base, offset))
                bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
        created.append((name, action))

    animation_data.action = None
    for name, action in created:
        track = animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, action)
        strip.action_frame_start = action.frame_range[0]
        strip.action_frame_end = action.frame_range[1]
        strip.name = name
        strip.blend_type = "REPLACE"

    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = SEATED_REST_POSE.get(bone.name, (0.0, 0.0, 0.0))


def add_character(person, asset_root):
    from mpfb.services import HumanService

    macro = {
        "gender": person["gender"], "age": person["age"], "muscle": 0.46,
        "weight": person["weight"], "proportions": 0.52, "height": person["height"],
        "cupsize": 0.5, "firmness": 0.5,
        "race": {"asian": 1.0, "caucasian": 0.0, "african": 0.0},
    }
    human = HumanService.create_human(
        mask_helpers=True, detailed_helpers=False, extra_vertex_groups=True,
        feet_on_ground=True, scale=0.1, macro_detail_dict=macro,
    )
    human.name = f"VivaPrep {person['label']} body"
    skin_path = asset_root / "skins" / person["skin"] / f"{person['skin']}.mhmat"
    HumanService.set_character_skin(str(skin_path), human, skin_type="MAKESKIN", material_instances=False)
    rig = HumanService.add_builtin_rig(human, "game_engine", import_weights=True)
    rig.name = f"{person['id']} interviewer rig"

    assets = [
        ("eyes", "high-poly/high-poly.mhclo"),
        ("eyebrows", "eyebrow001/eyebrow001.mhclo"),
        ("eyelashes", "eyelashes01/eyelashes01.mhclo"),
        ("teeth", "teeth_base/teeth_base.mhclo"),
        ("hair", person["hair"]),
    ]
    for asset_type, relative_path in assets:
        HumanService.add_mhclo_asset(
            str(asset_root / asset_type / relative_path), human,
            asset_type=asset_type, subdiv_levels=0, material_type="MAKESKIN",
        )
    suit_object = HumanService.add_mhclo_asset(
        str(asset_root / "clothes" / person["suit"]), human,
        asset_type="Clothes", subdiv_levels=0, material_type="MAKESKIN",
    )

    hide_lower_body_under_interview_table([human, suit_object])
    character_objects = [obj for obj in bpy.context.scene.objects if obj == rig or obj.parent == rig]
    tint_named_materials(character_objects, person["hair"].split("/", 1)[0], person["hair_tint"], 0.86, 0.34)
    tint_named_materials(character_objects, "suit", person["suit_tint"], 0.58, 0.58)
    tint_named_materials(character_objects, "casualsuit", person["suit_tint"], 0.58, 0.58)
    tint_named_materials(character_objects, "body", (1.0, 0.97, 0.93, 1.0), 0.20, 0.64)
    for obj in character_objects:
        if obj.type == "MESH":
            for polygon in obj.data.polygons:
                polygon.use_smooth = True

    if person["glasses"]:
        add_glasses(rig, person["glasses"], person["id"])

    normalize_texture_paths(asset_root)
    create_animations(rig, person)
    return rig


def deselect_all():
    bpy.ops.object.select_all(action="DESELECT")


def export_character(rig, person_id):
    character_objects = [obj for obj in bpy.context.scene.objects if obj == rig or obj.parent == rig]
    deselect_all()
    for obj in character_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = ASSET_DIR / f"{person_id}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="NLA_TRACKS", export_nla_strips=True,
        export_skins=True, export_materials="EXPORT", export_apply=True, export_yup=True,
        export_cameras=False, export_lights=False,
    )
    return path


def create_preview_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1680
    scene.render.resolution_y = 840
    scene.render.resolution_percentage = 58
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.filepath = str(PREVIEW_DIR / "interviewers-lineup.png")
    scene.view_settings.view_transform = "AgX"
    scene.world.color = (0.21, 0.20, 0.19)

    floor_material = bpy.data.materials.new("VivaPrep studio warm grey")
    floor_material.diffuse_color = (0.34, 0.32, 0.30, 1.0)
    floor_material.use_nodes = True
    floor_material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.34, 0.32, 0.30, 1.0)
    floor_material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.84
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0.0, 0.0, -0.01))
    floor = bpy.context.object
    floor.name = "render-only studio floor"
    floor.data.materials.append(floor_material)

    def box(name, location, dimensions, color):
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.object
        obj.name = f"render-only {name}"
        obj.dimensions = dimensions
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        material = bpy.data.materials.new(f"render-only {name} material")
        material.diffuse_color = (*color, 1.0)
        material.use_nodes = True
        material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1.0)
        material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
        obj.data.materials.append(material)
        return obj

    for index, x in enumerate((-1.42, 0.0, 1.42)):
        box(f"panel chair back {index}", (x, 0.92, 1.92), (0.96, 0.19, 1.52), (0.13, 0.16, 0.19))
        box(f"panel chair seat {index}", (x, 0.57, 1.24), (0.94, 0.90, 0.19), (0.13, 0.16, 0.19))
    box("meeting table", (0.0, -0.45, 1.40), (5.5, 2.05, 0.18), (0.37, 0.23, 0.15))
    box("table apron", (0.0, -1.29, 1.10), (5.35, 0.16, 0.43), (0.30, 0.19, 0.13))

    def aim(obj, target):
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("VivaPrep lineup preview camera")
    camera = bpy.data.objects.new("VivaPrep lineup preview camera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 4.8
    camera.location = (0.0, -6.8, 2.46)
    aim(camera, (0.0, 0.0, 2.05))
    scene.camera = camera

    for name, location, energy, size, color in (
        ("key", (-4.0, -4.0, 5.3), 680, 4.2, (1.0, 0.84, 0.73)),
        ("fill", (4.5, -2.0, 3.6), 470, 3.8, (0.74, 0.84, 1.0)),
        ("rim", (0.0, 2.7, 4.5), 720, 3.0, (1.0, 0.80, 0.63)),
    ):
        light_data = bpy.data.lights.new(f"VivaPrep preview {name}", "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = color
        light = bpy.data.objects.new(f"VivaPrep preview {name}", light_data)
        scene.collection.objects.link(light)
        light.location = location
        aim(light, (0.0, 0.0, 1.85))


def main():
    if not bpy.app.background:
        print("Generating VivaPrep interviewer models. This may take a few minutes.")
    mpfb = load_mpfb()
    asset_root = Path(os.environ["MPFB_ASSET_ROOT"]).expanduser().resolve()
    if not (asset_root / "skins").is_dir() or not (asset_root / "clothes").is_dir():
        raise RuntimeError("MPFB_ASSET_ROOT must contain the extracted skins/ and clothes/ directories.")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    rigs = []
    for person, x in zip(PEOPLE, (-1.42, 0.0, 1.42)):
        rig = add_character(person, asset_root)
        path = export_character(rig, person["id"])
        # Runtime placement uses the same seat anchor. The model is lifted as a
        # whole in this authoring preview so its pelvis meets the separate chair.
        rig.scale = (1.1, 1.1, 1.1)
        rig.location = (x, 0.0, 1.18)
        rigs.append(rig)
        print(f"Exported {person['label']}: {path}")

    create_preview_scene()
    bpy.ops.file.pack_all()
    source_path = SOURCE_DIR / "VivaPrep-interviewers.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    bpy.context.scene.render.filepath = str(PREVIEW_DIR / "interviewers-lineup.png")
    if os.environ.get("VIVAPREP_SKIP_PREVIEW_RENDER") != "1":
        bpy.ops.render.render(write_still=True)
    else:
        print("Skipped optional preview render (VIVAPREP_SKIP_PREVIEW_RENDER=1).")
    print("Saved editable Blender source:", source_path)


if __name__ == "__main__":
    main()
