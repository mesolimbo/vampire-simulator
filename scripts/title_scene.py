# The title screen backdrop: the game's own models in a moonlit miniature scene. The vampire walks up a path to a
# home with lit windows; the crypt and its graves stand behind. The left part of the frame stays calm and dark for
# the logo and buttons, which the page lays over it.
#   blender -b --python title_scene.py -- <repo> <out.png> [samples] [width]
import bpy, sys, math, random
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
REPO, OUT = args[0], args[1]
SAMPLES = int(args[2]) if len(args) > 2 else 64
WIDTH = int(args[3]) if len(args) > 3 else 1920
M, T = REPO + '/docs/assets/models/', REPO + '/docs/assets/textures/'
random.seed(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def load(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=M + name + '.glb')
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(name.split('/')[-1], None)
    sc.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    return root, new


def bounds(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [o.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def place(name, at, height=None, scale=None, rot=0.0):
    """Load a model, size it (by height in metres, or a plain scale), and stand it on the ground at `at`."""
    root, objs = load(name)
    bpy.context.view_layer.update()
    mn, mx = bounds(objs)
    k = height / (mx.z - mn.z) if height else (scale or 1)
    root.scale = (k, k, k)
    root.rotation_euler = (0, 0, rot)
    bpy.context.view_layer.update()
    mn, mx = bounds(objs)
    c = (mn + mx) / 2
    root.location = (at[0] - c.x, at[1] - c.y, -mn.z + (at[2] if len(at) > 2 else land(at[0], at[1])))
    bpy.context.view_layer.update()
    return root, objs


def image(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def base_texture_node(mat):
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    link = next((l for l in nt.links if l.to_node == bsdf and l.to_socket.name == 'Base Color'), None)
    return nt, bsdf, link.from_node if link else None


def matte(objs):
    """The generated models are marked metallic; nothing in the scene is metal."""
    for o in objs:
        if o.type == 'MESH':
            for m in o.data.materials:
                if m and m.use_nodes:
                    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                    if b:
                        for l in list(m.node_tree.links):
                            if l.to_node == b and l.to_socket.name == 'Metallic':
                                m.node_tree.links.remove(l)
                        b.inputs['Metallic'].default_value = 0
                        b.inputs['Roughness'].default_value = max(0.85, b.inputs['Roughness'].default_value)


def lit_home(objs, glow=(1.0, 0.72, 0.38), strength=5.0):
    """A clean home at night: the yellow-lit texture set, with its windows glowing through the window mask."""
    for o in objs:
        if o.type != 'MESH':
            continue
        for m in o.data.materials:
            nt, bsdf, tex = base_texture_node(m)
            if tex is not None and tex.type == 'TEX_IMAGE':
                tex.image = image(T + 'house/house_clean_yellow.png')
                mask = nt.nodes.new('ShaderNodeTexImage'); mask.image = image(T + 'house/house_window_mask.png', True)
                uv = next((l.from_socket for l in nt.links if l.to_node == tex and l.to_socket.name == 'Vector'), None)
                if uv:
                    nt.links.new(uv, mask.inputs['Vector'])
                mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = strength
                nt.links.new(mask.outputs['Color'], mul.inputs[0])
                bsdf.inputs['Emission Color'].default_value = (*glow, 1)
                nt.links.new(mul.outputs[0], bsdf.inputs['Emission Strength'])


# ---------- ground: grass with the repeat broken up, and a dirt path ----------

def grass_material():
    m = bpy.data.materials.new('grass'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 1
    tc = nt.nodes.new('ShaderNodeTexCoord')
    def tex(scale, rot):
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale); mp.inputs['Rotation'].default_value = (0, 0, rot)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = image(T + 'ground/grass_basecolor.jpg')
        nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
        return t
    a, c = tex(1 / 2.6, 0), tex(1 / 3.4, 0.9)
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 0.08
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeMapRange'); ramp.inputs['From Min'].default_value = 0.4; ramp.inputs['From Max'].default_value = 0.6
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(ramp.outputs['Result'], mix.inputs['Factor']); nt.links.new(a.outputs['Color'], mix.inputs['A']); nt.links.new(c.outputs['Color'], mix.inputs['B'])
    # broad light and dark patches, as in the game
    patch = nt.nodes.new('ShaderNodeTexNoise'); patch.inputs['Scale'].default_value = 0.035
    nt.links.new(tc.outputs['Object'], patch.inputs['Vector'])
    shade = nt.nodes.new('ShaderNodeMapRange'); shade.inputs['To Min'].default_value = 0.72; shade.inputs['To Max'].default_value = 1.12
    nt.links.new(patch.outputs['Fac'], shade.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
    nt.links.new(mix.outputs['Result'], mul.inputs['A'])
    comb = nt.nodes.new('ShaderNodeCombineColor')
    for ch in 'Red', 'Green', 'Blue':
        nt.links.new(shade.outputs['Result'], comb.inputs[ch])
    nt.links.new(comb.outputs['Color'], mul.inputs['B'])
    nt.links.new(mul.outputs['Result'], b.inputs['Base Color'])
    nrm = nt.nodes.new('ShaderNodeTexImage'); nrm.image = image(T + 'ground/grass_normal.jpg', True)
    mp = next(n for n in nt.nodes if n.type == 'MAPPING')
    nt.links.new(mp.outputs['Vector'], nrm.inputs['Vector'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 0.6
    nt.links.new(nrm.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


bpy.ops.mesh.primitive_plane_add(size=260, location=(0, 60, 0))
ground = bpy.context.active_object
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.subdivide(number_cuts=60); bpy.ops.object.mode_set(mode='OBJECT')
def land(x, y):   # level where the scene is set, rolling and rising further off
    d = math.hypot(x - 1.0, (y - 10.0) * 0.7)
    k = min(1.0, max(0.0, (d - 22.0) / 14.0)); k = k * k * (3 - 2 * k)
    return k * (0.6 * math.sin(x * 0.05 + 1) * math.cos(y * 0.04) + max(0, (y - 30)) * 0.06)
for v in ground.data.vertices:
    v.co.z = land(v.co.x, v.co.y + 60)
ground.data.materials.append(grass_material())
for p in ground.data.polygons:
    p.use_smooth = True

# The path: a curving strip from the bottom of the frame to the doorstep, earth fading out at its edges.
# The home faces down the path: the path's last stretch runs straight out from its door.
HOME_AT, HOME_ROT = (6.0, 7.0), math.radians(-48)
front = Vector((math.sin(HOME_ROT), -math.cos(HOME_ROT), 0))   # the model's front faces -Y before turning
door_pt = Vector((*HOME_AT, 0)) + front * 2.46
path_pts = [(-16.0, -1.5), (-9.0, -1.0), (-3.8, 0.0), tuple((door_pt + front * 4.5)[:2]), tuple((door_pt - front * 0.35)[:2])]
def path_curve(t):
    n = len(path_pts) - 1; i = min(int(t * n), n - 1); u = t * n - i
    p0 = path_pts[max(i - 1, 0)]; p1 = path_pts[i]; p2 = path_pts[i + 1]; p3 = path_pts[min(i + 2, n)]
    f = lambda a, b, c, d: 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3)
    return Vector((f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), 0))
verts, faces, uvs = [], [], []
N = 80
for i in range(N + 1):
    t = i / N; p = path_curve(t); q = path_curve(min(1, t + 0.01)) - path_curve(max(0, t - 0.01)); q.normalize()
    side = Vector((-q.y, q.x, 0)); w = 1.25 - 0.4 * t
    for s in (-1, 1):
        v = p + side * w * s
        verts.append((v.x, v.y, 0.03)); uvs.append(((s + 1) / 2, t * 8))
for i in range(N):
    a = i * 2; faces.append((a, a + 2, a + 3, a + 1))
me = bpy.data.meshes.new('path'); me.from_pydata(verts, [], faces)
uvl = me.uv_layers.new()
for poly in me.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = uvs[me.loops[li].vertex_index]
path = bpy.data.objects.new('path', me); sc.collection.objects.link(path)
for v in path.data.vertices:   # follow the ground
    v.co.z = land(v.co.x, v.co.y) + 0.03
pm = bpy.data.materials.new('path'); pm.use_nodes = True
nt = pm.node_tree; b = nt.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 1
tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / 3, 1 / 3, 1)
nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
t = nt.nodes.new('ShaderNodeTexImage'); t.image = image(T + 'ground/road_basecolor.jpg'); nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['UV'], sep.inputs['Vector'])
edge = nt.nodes.new('ShaderNodeMath'); edge.operation = 'PINGPONG'; edge.inputs[1].default_value = 0.5
nt.links.new(sep.outputs['X'], edge.inputs[0])
noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 3; nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
addn = nt.nodes.new('ShaderNodeMath'); addn.operation = 'MULTIPLY_ADD'; addn.inputs[1].default_value = 0.25
nt.links.new(noise.outputs['Fac'], addn.inputs[0]); nt.links.new(edge.outputs[0], addn.inputs[2])
fade = nt.nodes.new('ShaderNodeMapRange'); fade.inputs['From Min'].default_value = 0.2; fade.inputs['From Max'].default_value = 0.42
nt.links.new(addn.outputs[0], fade.inputs['Value']); nt.links.new(fade.outputs['Result'], b.inputs['Alpha'])
path.data.materials.append(pm)

# ---------- the town ----------

home, home_objs = place('house', HOME_AT, height=6.3, rot=HOME_ROT)
matte(home_objs); lit_home(home_objs)
# its door, hung as in the game (closed)
door, door_objs = load('house_door'); matte(door_objs)
door.parent = home; door.scale = (0.33, 0.33, 0.33)
# in the house model's own units (Blender axes): the hinge sits at (-0.1, -0.352, -0.25), the door 0.1 to its right
door.location = (0.0, -0.352, -0.25)
bpy.context.view_layer.update()

back_homes = []
for at, rot in [((-14.0, 30.0), 0.4), ((18.5, 32.0), -0.4), ((-26.0, 48.0), 0.2), ((30.0, 55.0), -0.2)]:
    r, o = place('house', at, height=6.3, rot=rot); matte(o); lit_home(o, strength=4.0); back_homes.append(r)

crypt, crypt_objs = place('crypt', (-1.5, 26.0), height=6.5, rot=math.radians(-8)); matte(crypt_objs)
for i, (x, y) in enumerate([(-7.5, 22.5), (4.0, 23.0), (-5.0, 30.5), (3.5, 31.0), (-9.5, 27.5), (7.5, 27.0)]):
    o = place(['tombstone_a', 'tombstone_b', 'tombstone_c'][i % 3], (x, y), height=random.uniform(1.4, 1.9), rot=random.uniform(-0.3, 0.3))[1]
    matte(o)

for name, at, h in [('tree_b', (-11.0, 9.0), 8.5), ('tree_a', (-17.0, 4.0), 7.0), ('tree_b', (13.5, 16.0), 9.0), ('tree_a', (19.0, 8.0), 7.5),
                    ('tree_b', (-24.0, 20.0), 9.5), ('tree_a', (9.0, 38.0), 7.5), ('tree_b', (-8.0, 40.0), 9.0), ('tree_b', (26.0, 22.0), 10.0),
                    ('tree_a', (-30.0, 10.0), 8.0), ('tree_b', (30.0, 42.0), 9.0)]:
    matte(place(name, at, height=h, rot=random.uniform(0, 6.28))[1])

FLOWER_TINTS = [(1, 1, 1), (1, 0.7, 0.81), (0.79, 0.7, 1), (1, 0.94, 0.63)]
def flower_bush(at, h=1.25):
    _, o = place('flower_bush', at, height=h, rot=random.uniform(0, 6.28)); matte(o)
    tint = random.choice(FLOWER_TINTS)
    for ob in o:
        if ob.type == 'MESH':
            for i, m in enumerate(ob.data.materials):
                if m.name.startswith('flower'):
                    m2 = m.copy(); ob.data.materials[i] = m2
                    vc = next(n for n in m2.node_tree.nodes if n.type in ('VERTEX_COLOR', 'ATTRIBUTE'))
                    b = next(n for n in m2.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
                    mix = m2.node_tree.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
                    mix.inputs['B'].default_value = (*tint, 1)
                    m2.node_tree.links.new(vc.outputs['Color'], mix.inputs['A']); m2.node_tree.links.new(mix.outputs['Result'], b.inputs['Base Color'])
for at in [(1.6, 5.6), (10.0, 4.6), (-1.8, 4.6), (-2.6, -2.5), (3.4, -4.5), (-4.8, 3.5), (8.2, 0.5), (-3.8, -8.0), (11.5, 8.5), (2.0, -9.5), (-7.0, 13.0), (6.5, 14.5), (14.0, 2.0)]:
    flower_bush(at, random.uniform(1.0, 1.4))
for at in [(-6.0, -3.2), (6.5, -2.0)]:   # the odd plain bush near the path
    matte(place('bush', at, height=1.2, rot=random.uniform(0, 6.28))[1])

# ---------- the vampire, mid-stride on the path ----------

vamp, vamp_objs = load('characters/player')
# the file carries a helper sphere that the game never shows
for o in [o for o in vamp_objs if o.name.startswith('Icosphere')]:
    vamp_objs.remove(o); bpy.data.objects.remove(o)
arm = next(o for o in vamp_objs if o.type == 'ARMATURE')
walk = bpy.data.actions.get('Walk')
arm.animation_data_create(); arm.animation_data.action = walk
if hasattr(arm.animation_data, 'action_slot') and walk.slots:
    arm.animation_data.action_slot = walk.slots[0]
lo, hi = walk.frame_range
sc.frame_set(int(lo + (hi - lo) * 0.12))
bpy.context.view_layer.update()
mn, mx = bounds(vamp_objs)
k = 2.3 / (mx.z - mn.z)
vamp.scale = (k, k, k)
p = path_curve(0.72); q = path_curve(0.76) - path_curve(0.68)
vamp.rotation_euler = (0, 0, math.atan2(q.y, q.x) + 0.05)   # the model faces +X here: turn it up the path, a little towards us
bpy.context.view_layer.update()
mn, mx = bounds(vamp_objs)
c = (mn + mx) / 2
vamp.location = (vamp.location.x + p.x - c.x, vamp.location.y + p.y - c.y, vamp.location.z - mn.z + land(p.x, p.y) + 0.03)
matte(vamp_objs)
bpy.context.view_layer.update()

# ---------- sky, moon and light ----------

w = bpy.data.worlds.new('night'); sc.world = w; w.use_nodes = True
nt = w.node_tree; bg = nt.nodes['Background']
tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
half = nt.nodes.new('ShaderNodeMath'); half.operation = 'MULTIPLY_ADD'; half.inputs[1].default_value = 0.5; half.inputs[2].default_value = 0.5
nt.links.new(sep.outputs['Z'], half.inputs[0])
ramp = nt.nodes.new('ShaderNodeValToRGB'); nt.links.new(half.outputs[0], ramp.inputs['Fac'])
ramp.color_ramp.elements[0].position = 0.5; ramp.color_ramp.elements[0].color = (0.07, 0.1, 0.24, 1)
ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (0.006, 0.01, 0.035, 1)
nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 4.0

moon_l = bpy.data.lights.new('moon', 'SUN'); moon_l.energy = 3.4; moon_l.color = (0.62, 0.72, 1.0); moon_l.angle = math.radians(2)
moon = bpy.data.objects.new('moon', moon_l); sc.collection.objects.link(moon); moon.rotation_euler = (math.radians(52), math.radians(-18), math.radians(200))
fill_l = bpy.data.lights.new('fill', 'SUN'); fill_l.energy = 0.35; fill_l.color = (0.45, 0.5, 0.9)
fill = bpy.data.objects.new('fill', fill_l); sc.collection.objects.link(fill); fill.rotation_euler = (math.radians(60), 0, math.radians(20))

bpy.ops.mesh.primitive_uv_sphere_add(radius=7, location=(70, 240, 75))
disc = bpy.context.active_object
mm = bpy.data.materials.new('moon'); mm.use_nodes = True
em = mm.node_tree.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (1.0, 0.97, 0.88, 1); em.inputs['Strength'].default_value = 6
mm.node_tree.links.new(em.outputs[0], mm.node_tree.nodes['Material Output'].inputs['Surface'])
disc.data.materials.append(mm); disc.visible_shadow = False

def warm(at, energy, radius=0.3, color=(1.0, 0.58, 0.24)):
    l = bpy.data.lights.new('warm', 'POINT'); l.energy = energy; l.color = color; l.shadow_soft_size = radius
    o = bpy.data.objects.new('warm', l); sc.collection.objects.link(o); o.location = at
# the home's windows and doorstep throw warm light onto the path
front = home.matrix_world @ Vector((0, -0.62, -0.05))
warm(front + Vector((0, 0, 0.6)), 1400, 0.8)
for x in (-0.3, 0.3):
    warm(home.matrix_world @ Vector((x, -0.6, 0.0)), 260, 0.4)
for h in back_homes:
    warm(h.matrix_world @ Vector((0, -0.7, 0.0)), 300, 0.6)

# ---------- camera: a miniature photographed close up ----------

cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 38
cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (-2.4, -12.4, 3.9)
target = Vector((0.9, 7.0, 2.9))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_d.dof.use_dof = True
cam_d.dof.focus_distance = (Vector((p.x, p.y, 1.0)) - cam.location).length
cam_d.dof.aperture_fstop = 1.2

# the moon hangs in the upper right of the frame, far off
bpy.context.view_layer.update()
disc.location = cam.matrix_world @ (Vector((0.22, 0.19, -1.0)) * 260)
# a line of woods along the horizon, so the land never ends in a hard edge
for i in range(34):
    x = -150 + i * 9.0 + random.uniform(-3, 3); y = random.uniform(105, 135)
    matte(place(random.choice(['tree_a', 'tree_b']), (x, y, land(x, y)), height=random.uniform(12, 17), rot=random.uniform(0, 6.28))[1])
# a soft cool light from our side, so the figures are not mere silhouettes against the moon
kl = bpy.data.lights.new('key', 'AREA'); kl.energy = 1100; kl.size = 6; kl.color = (0.55, 0.65, 1.0)
key = bpy.data.objects.new('key', kl); sc.collection.objects.link(key)
key.location = cam.location + Vector((-9, 4, 5)); key.rotation_euler = (Vector((2.0, 4.0, 1.0)) - key.location).to_track_quat('-Z', 'Y').to_euler()
# a thin night haze, so distance fades into blue
vol = nt.nodes.new('ShaderNodeVolumePrincipled'); vol.inputs['Density'].default_value = 0.0012; vol.inputs['Color'].default_value = (0.35, 0.45, 0.85, 1)
nt.links.new(vol.outputs[0], nt.nodes['World Output'].inputs['Volume'])
# ---------- render ----------

sc.render.engine = 'CYCLES'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
        try:
            prefs.compute_device_type = kind; prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices: d.use = True
                sc.cycles.device = 'GPU'; print('DEVICE', kind); break
        except TypeError:
            pass
except Exception as e:
    print('DEVICE cpu', e)
sc.render.resolution_x = WIDTH; sc.render.resolution_y = WIDTH * 9 // 16
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - High Contrast'
sc.view_settings.exposure = 1.15
sc.render.filepath = OUT
sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print('RENDERED', OUT)
