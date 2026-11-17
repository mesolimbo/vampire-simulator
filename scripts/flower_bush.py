# Scatter small five-petal blossoms over the top of the bush model and export it as flower_bush.glb.
# The blossoms use their own "flower" material (white petals, yellow centres via vertex colour), so the game can
# tint the petals per bush.
import bpy, bmesh, sys, math, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

src, out = sys.argv[-2], sys.argv[-1]
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bush = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
dg = bpy.context.evaluated_depsgraph_get()
bm0 = bmesh.new(); bm0.from_object(bush, dg); bm0.transform(bush.matrix_world)
tree = BVHTree.FromBMesh(bm0)
mn = Vector((min(v.co.x for v in bm0.verts), min(v.co.y for v in bm0.verts), min(v.co.z for v in bm0.verts)))
mx = Vector((max(v.co.x for v in bm0.verts), max(v.co.y for v in bm0.verts), max(v.co.z for v in bm0.verts)))
size = (mx - mn)

bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
PETAL, CENTRE = (1, 1, 1, 1), (1.0, 0.78, 0.18, 1)

def blossom(at, normal, r):
    # Rotation taking +Z to the surface normal, with a random spin.
    rot = normal.to_track_quat('Z', 'Y').to_matrix().to_4x4() @ Matrix.Rotation(random.random() * 6.283, 4, 'Z')
    def put(verts_local):
        vs = [bm.verts.new(at + (rot @ Vector(v))) for v in verts_local]
        return vs
    for i in range(5):
        a = i * 2 * math.pi / 5
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        # a rounded petal, cupped upwards towards its tip
        outline = [(0.15, 0.0, 0.004), (0.4, 0.3, 0.012), (0.75, 0.36, 0.022), (0.97, 0.18, 0.03), (1.0, 0.0, 0.032), (0.97, -0.18, 0.03), (0.75, -0.36, 0.022), (0.4, -0.3, 0.012)]
        pts = [d * r * u + side * r * w + Vector((0, 0, h * r * 12)) for u, w, h in outline]
        f = bm.faces.new(put([tuple(p) for p in pts]))
        for l in f.loops: l[col] = PETAL
    ring = [(math.cos(i * math.pi / 4) * r * 0.3, math.sin(i * math.pi / 4) * r * 0.3, r * 0.42) for i in range(8)]
    f = bm.faces.new(put(ring))
    for l in f.loops: l[col] = CENTRE

placed, tries = [], 0
while len(placed) < 46 and tries < 4000:
    tries += 1
    x = mn.x + random.random() * size.x; y = mn.y + random.random() * size.y
    hit = tree.ray_cast(Vector((x, y, mx.z + 1)), Vector((0, 0, -1)))
    if hit[0] is None or hit[1].z < 0.25: continue
    p = hit[0]
    if p.z < mn.z + size.z * 0.35: continue   # only the upper part of the bush
    if any((p - q).length < size.x * 0.085 for q in placed): continue
    placed.append(p)
    blossom(p + hit[1] * 0.004, hit[1], size.x * random.uniform(0.045, 0.062))

me = bpy.data.meshes.new('flowers'); bm.to_mesh(me); bm.free()
fl = bpy.data.objects.new('flowers', me); bpy.context.collection.objects.link(fl)
mat = bpy.data.materials.new('flower'); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.8
me.materials.append(mat)
for p in me.polygons: p.use_smooth = False
fl.parent = None
print('BLOSSOMS', len(placed))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_vertex_color='ACTIVE')
