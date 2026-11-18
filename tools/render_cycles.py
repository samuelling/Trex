# Path-traced stills of an exported instant (see tools/export.mjs), using Blender's Cycles through the bpy module.
#   python tools/render_cycles.py <exportDir> <assetsDir> <heightMap.png> <outPrefix> [--views hero,head] [--res 1920x1080] [--samples 160] [--exposure -5]
# Light transport is unbiased path tracing: one physical sun-and-sky model lights everything, shadows soften with distance from the
# occluder, light bounces between ground, water and animal, the skin scatters light below its surface, and the lens has a real aperture.
import bpy, bmesh, json, sys, os, math, time
import numpy as np
from mathutils import Vector, Matrix

a = sys.argv[1:]
EXP, ASSETS, HEIGHT, OUT = a[0], a[1], a[2], a[3]
opt = {'views': 'hero', 'res': '1280x720', 'samples': '96', 'exposure': 'auto', 'sss': '1', 'dof': '1', 'threads': '2', 'haze': '0', 'sun': '', 'elev': '', 'crop': '', 'ev': '0', 'look': 'base'}
for i in range(4, len(a) - 1, 2): opt[a[i].lstrip('-')] = a[i + 1]
S = json.load(open(os.path.join(EXP, 'scene.json')))
if opt['elev']: S['sunElev'] = float(opt['elev'])
if opt['sun']:   # sun bearing in degrees from the animal's heading, positive toward its right
    a_ = math.radians(float(opt['sun'])); e_ = math.radians(S['sunElev']); h_ = np.array(S['heading']) * math.cos(a_) + np.array(S['right']) * math.sin(a_); S['sunDir'] = [float(h_[0] * math.cos(e_)), float(math.sin(e_)), float(h_[2] * math.cos(e_))]
T0 = time.time()
def log(*x): print('[%6.1fs]' % (time.time() - T0), *x, flush=True)

DT = {'Float32Array': np.float32, 'Uint32Array': np.uint32, 'Uint8Array': np.uint8, 'Uint16Array': np.uint16}
def arr(name, cols=None):
    v = np.fromfile(os.path.join(EXP, name + '.bin'), dtype=DT[S['types'][name]])
    return v.reshape(-1, cols) if cols else v
def conv(p):  # three.js (x, y up, z) -> Blender (x, -z, z up)
    p = np.asarray(p, dtype=np.float64).reshape(-1, 3); return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)
C4 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def make_mesh(name, co, idx, uv=None, attrs=None, smooth=True):
    me = bpy.data.meshes.new(name); n, nt = len(co), len(idx) // 3
    me.vertices.add(n); me.vertices.foreach_set('co', np.asarray(co, np.float32).ravel())
    me.loops.add(nt * 3); me.loops.foreach_set('vertex_index', np.asarray(idx, np.int32))
    me.polygons.add(nt); me.polygons.foreach_set('loop_start', np.arange(0, nt * 3, 3, dtype=np.int32))
    try: me.polygons.foreach_set('loop_total', np.full(nt, 3, dtype=np.int32))
    except Exception: pass
    if uv is not None: me.uv_layers.new(name='UVMap').data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    for k, (typ, val) in (attrs or {}).items():
        at = me.attributes.new(k, typ, 'POINT'); at.data.foreach_set('vector' if typ == 'FLOAT_VECTOR' else ('color' if typ == 'FLOAT_COLOR' else 'value'), np.asarray(val, np.float32).ravel())
    me.update(calc_edges=True); me.validate()
    if smooth: me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
    return me
def add_obj(name, me, mat=None, M=None):
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    if mat: me.materials.append(mat) if not me.materials else None
    if M is not None: o.matrix_world = M
    return o

class NT:  # small node-graph builder
    def __init__(s, name):
        s.mat = bpy.data.materials.new(name); s.mat.use_nodes = True; s.t = s.mat.node_tree; s.t.nodes.clear()
        s.out = s.t.nodes.new('ShaderNodeOutputMaterial')
    def n(s, typ, **kw):
        nd = s.t.nodes.new(typ)
        for k, v in kw.items(): setattr(nd, k, v)
        return nd
    def set(s, inp, v):
        if isinstance(v, bpy.types.NodeSocket): s.t.links.new(v, inp)
        elif v is not None: inp.default_value = v
    def m(s, op, x, y=None, z=None, clamp=False):
        nd = s.n('ShaderNodeMath', operation=op, use_clamp=clamp); s.set(nd.inputs[0], x)
        if y is not None: s.set(nd.inputs[1], y)
        if z is not None: s.set(nd.inputs[2], z)
        return nd.outputs[0]
    def vm(s, op, x, y=None, scale=None):
        nd = s.n('ShaderNodeVectorMath', operation=op); s.set(nd.inputs[0], x)
        if y is not None: s.set(nd.inputs[1], y)
        if scale is not None: s.set(nd.inputs['Scale'], scale)
        return nd.outputs['Value'] if op in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else nd.outputs[0]
    def mix(s, f, x, y):  # colour mix
        nd = s.n('ShaderNodeMix', data_type='RGBA'); s.set(nd.inputs[0], f); s.set(nd.inputs[6], x if isinstance(x, bpy.types.NodeSocket) else (*x, 1)); s.set(nd.inputs[7], y if isinstance(y, bpy.types.NodeSocket) else (*y, 1)); return nd.outputs[2]
    def mul(s, x, y):
        nd = s.n('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); nd.inputs[0].default_value = 1; s.set(nd.inputs[6], x if isinstance(x, bpy.types.NodeSocket) else (*x, 1)); s.set(nd.inputs[7], y if isinstance(y, bpy.types.NodeSocket) else (*y, 1)); return nd.outputs[2]
    def ramp(s, x, lo, hi, a=0.0, b=1.0, smooth=True):
        nd = s.n('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR'); s.set(nd.inputs[0], x)
        for i, v in zip((1, 2, 3, 4), (lo, hi, a, b)): nd.inputs[i].default_value = v
        return nd.outputs[0]
    def noise(s, vec, scale, detail=4.0, rough=0.5, dist=0.0):
        nd = s.n('ShaderNodeTexNoise'); s.set(nd.inputs['Vector'], vec); nd.inputs['Scale'].default_value = scale; nd.inputs['Detail'].default_value = detail; nd.inputs['Roughness'].default_value = rough; nd.inputs['Distortion'].default_value = dist; return nd.outputs[0]
    def image(s, path, cs='Non-Color', **kw):
        img = bpy.data.images.load(path, check_existing=True); img.colorspace_settings.name = cs; nd = s.n('ShaderNodeTexImage', **kw); nd.image = img; return nd
    def principled(s, **kw):
        nd = s.n('ShaderNodeBsdfPrincipled')
        for k, v in kw.items(): s.set(nd.inputs[k], v)
        return nd
    def finish(s, shader): s.t.links.new(shader, s.out.inputs['Surface']); return s.mat

# ------------------------------------------------------------------ animal
def build_body():
    B = S['body']; pos = conv(arr('body_pos', 3)); rest = arr('body_rest', 3); uv = arr('body_uv', 2); idx = arr('body_index').astype(np.int64)
    strain = arr('body_strain'); misc = arr('body_misc', 4)
    # the atlas duplicated vertices along chart borders: weld them so shading normals are continuous, keep UVs per corner
    key = np.ascontiguousarray(rest).view([('', rest.dtype)] * 3).ravel(); _, first, inv = np.unique(key, return_index=True, return_inverse=True)
    luv = uv[idx]; luv = np.stack([luv[:, 0], 1 - luv[:, 1]], axis=1)
    me = make_mesh('rex', pos[first], inv[idx], luv, {'strain': ('FLOAT', strain[first]), 'rest': ('FLOAT_VECTOR', conv(rest[first])), 'loose': ('FLOAT', misc[first, 3] / 255.0)})
    log('body', len(first), 'welded vertices from', len(pos), ';', len(idx) // 3, 'triangles')
    g = NT('skin')
    uvn = g.n('ShaderNodeUVMap', uv_map='UVMap').outputs[0]
    alb = g.image(os.path.join(ASSETS, 'rex-hi-albedo.webp'), 'sRGB'); orm = g.image(os.path.join(ASSETS, 'rex-hi-orm.webp')); hgt = g.image(HEIGHT)
    for t in (alb, orm, hgt): g.set(t.inputs['Vector'], uvn)
    sep = g.n('ShaderNodeSeparateColor'); g.set(sep.inputs[0], orm.outputs['Color']); occ, rough0, fold = sep.outputs[0], sep.outputs[1], sep.outputs[2]
    st = g.n('ShaderNodeAttribute', attribute_name='strain').outputs[2]; rst = g.n('ShaderNodeAttribute', attribute_name='rest').outputs[1]
    comp = g.m('MULTIPLY', st, -9.0, clamp=True); stretch = g.m('MULTIPLY', st, 9.0, clamp=True)
    # micro-scales: one tiling tile, box-projected in the resting body's coordinates
    rx = g.n('ShaderNodeSeparateXYZ'); g.set(rx.inputs[0], rst); f = g.ramp(rx.outputs[0], 3.55, 3.9, 8.0, 5.0)
    det = g.image(os.path.join(ASSETS, 'skin-detail.webp'), projection='BOX', projection_blend=0.35, extension='REPEAT'); g.set(det.inputs['Vector'], g.vm('SCALE', rst, scale=f))
    dsep = g.n('ShaderNodeSeparateColor'); g.set(dsep.inputs[0], det.outputs['Color']); dh = dsep.outputs[2]
    skin = g.ramp(rough0, 0.2, 0.34)                                                  # wet and keratin surfaces carry no scales
    base = g.mul(alb.outputs['Color'], g.n('ShaderNodeCombineColor').outputs[0])
    shade = g.m('ADD', 1.0, g.m('MULTIPLY', skin, g.m('MULTIPLY_ADD', dh, 0.28, -0.196)))  # grooves between scales hold dirt
    cav = g.m('MULTIPLY_ADD', occ, 0.3, 0.7)
    k = g.m('MULTIPLY', shade, cav); kc = g.n('ShaderNodeCombineColor'); [g.set(kc.inputs[i], k) for i in range(3)]
    base = g.mul(alb.outputs['Color'], kc.outputs[0])
    rough = g.m('ADD', g.m('ADD', rough0, g.m('MULTIPLY', g.m('SUBTRACT', 0.5, dh), g.m('MULTIPLY', skin, 0.16))), g.m('MULTIPLY', comp, 0.1), clamp=True)
    # relief in metres: baked fine relief (taut skin flattens) + micro-scales + folds that deepen where the simulated skin is compressed
    h = g.m('MULTIPLY', g.m('MULTIPLY_ADD', hgt.outputs['Color'], 0.04, -0.02), g.m('MULTIPLY_ADD', stretch, -0.45, 1.0))
    h = g.m('ADD', h, g.m('MULTIPLY', g.m('MULTIPLY', dh, skin), 0.0007))
    h = g.m('ADD', h, g.m('MULTIPLY', g.m('MULTIPLY_ADD', fold, 0.03, -0.015), comp))
    bump = g.n('ShaderNodeBump'); bump.inputs['Strength'].default_value = 1.0; bump.inputs['Distance'].default_value = 1.0; g.set(bump.inputs['Height'], h)
    p = g.principled(**{'Base Color': base, 'Roughness': rough, 'IOR': 1.42, 'Normal': bump.outputs[0]})
    if opt['sss'] != '0':
        try:
            p.subsurface_method = 'RANDOM_WALK'; p.inputs['Subsurface Weight'].default_value = 1.0; p.inputs['Subsurface Radius'].default_value = (1.0, 0.42, 0.26); p.inputs['Subsurface Scale'].default_value = 0.006 * float(opt['sss'])
        except Exception as e: log('no subsurface:', e)
    try: p.inputs['Sheen Weight'].default_value = 0.08; p.inputs['Sheen Roughness'].default_value = 0.6
    except Exception: pass
    add_obj('rex', me, g.finish(p.outputs[0]))

    for k, R in enumerate(S['rigid']):
        co = conv(arr(R['pos'], 3)); ix = arr(R['index'])
        if R['kind'] == 'teeth':
            me2 = make_mesh('teeth%d' % k, co, ix, attrs={'col': ('FLOAT_VECTOR', arr(R['color'], 3))}); g2 = NT('tooth%d' % k); c = g2.n('ShaderNodeAttribute', attribute_name='col').outputs[1]
            p2 = g2.principled(**{'Base Color': c, 'Roughness': 0.28, 'IOR': 1.55})
            try: p2.inputs['Subsurface Weight'].default_value = 1.0; p2.inputs['Subsurface Radius'].default_value = (1, 0.8, 0.6); p2.inputs['Subsurface Scale'].default_value = 0.003; p2.inputs['Coat Weight'].default_value = 0.4; p2.inputs['Coat Roughness'].default_value = 0.2
            except Exception: pass
            add_obj('teeth%d' % k, me2, g2.finish(p2.outputs[0]))
        else:
            g2 = NT('gullet%d' % k); add_obj('gullet%d' % k, make_mesh('gullet%d' % k, co, ix), g2.finish(g2.principled(**{'Base Color': (0.05, 0.012, 0.012, 1), 'Roughness': 0.35}).outputs[0]))

    # eyes: globe with a painted iris under a clear refracting cornea
    g = NT('eye'); oc = g.n('ShaderNodeTexCoord').outputs['Object']; q = g.vm('NORMALIZE', oc); sx = g.n('ShaderNodeSeparateXYZ'); g.set(sx.inputs[0], q)
    rr = g.m('SQRT', g.m('ADD', g.m('POWER', sx.outputs[0], 2.0), g.m('POWER', sx.outputs[1], 2.0)))
    dirv = g.n('ShaderNodeCombineXYZ'); g.set(dirv.inputs[0], g.m('DIVIDE', sx.outputs[0], rr)); g.set(dirv.inputs[1], g.m('DIVIDE', sx.outputs[1], rr))
    fib = g.noise(dirv.outputs[0], 7.0, 5.0, 0.7)
    iris = g.mix(fib, (0.17, 0.085, 0.018), (0.05, 0.025, 0.008)); iris = g.mix(g.m('MULTIPLY', g.ramp(rr, 0.30, 0.42, 1.0, 0.0), 0.6), iris, (0.24, 0.15, 0.04))
    c = g.mix(g.ramp(rr, 0.27, 0.31), (0, 0, 0), iris); c = g.mix(g.ramp(rr, 0.56, 0.66), c, (0.03, 0.02, 0.015)); c = g.mix(g.ramp(sx.outputs[2], -0.02, 0.02), (0.03, 0.02, 0.015), c)
    eye_mat = g.finish(g.principled(**{'Base Color': c, 'Roughness': 0.35}).outputs[0])
    g = NT('cornea'); pc = g.principled(**{'Base Color': (1, 1, 1, 1), 'Roughness': 0.0, 'IOR': 1.376})
    try: pc.inputs['Transmission Weight'].default_value = 1.0
    except Exception: pass
    lp = g.n('ShaderNodeLightPath'); ms = g.n('ShaderNodeMixShader'); g.set(ms.inputs[0], lp.outputs['Is Shadow Ray']); g.set(ms.inputs[1], pc.outputs[0]); g.set(ms.inputs[2], g.n('ShaderNodeBsdfTransparent').outputs[0]); cornea_mat = g.finish(ms.outputs[0])
    for k, E in enumerate(S['eyes']):
        X, Y, Z, Cc = [Vector(conv(E[a_])[0]) for a_ in ('x', 'y', 'z', 'c')]
        for nm, r, mat in (('eye', E['r'], eye_mat), ('cornea', E['r'] * 1.035, cornea_mat)):
            bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=r); me3 = bpy.data.meshes.new('%s%d' % (nm, k)); bm.to_mesh(me3); bm.free(); me3.polygons.foreach_set('use_smooth', np.ones(len(me3.polygons), dtype=bool))
            M = Matrix((X.normalized(), Y.normalized(), Z.normalized())).transposed().to_4x4(); M.translation = Cc; add_obj('%s%d' % (nm, k), me3, mat, M)

# ------------------------------------------------------------------ world
def build_world():
    wy = S['waterY']
    # ground
    co = conv(arr('ground_pos', 3)); me = make_mesh('ground', co, arr('ground_index'))
    g = NT('ground'); P = g.n('ShaderNodeNewGeometry').outputs['Position']; sp = g.n('ShaderNodeSeparateXYZ'); g.set(sp.inputs[0], P)
    big, mid, fine, grit = g.noise(P, 0.11, 3), g.noise(P, 0.9, 5, 0.6), g.noise(P, 9.0, 6, 0.65), g.noise(P, 85.0, 3, 0.6)
    rad = g.m('SQRT', g.m('ADD', g.m('POWER', sp.outputs[0], 2.0), g.m('POWER', sp.outputs[1], 2.0)))
    trail = g.ramp(g.m('ADD', g.m('ABSOLUTE', g.m('SUBTRACT', rad, float(S['pathR']))), g.m('MULTIPLY_ADD', g.noise(P, 0.6, 2), 5.0, -2.5)), 0.3, 4.2, 1.0, 0.0)
    wet = g.ramp(g.m('ADD', sp.outputs[2], g.m('MULTIPLY_ADD', mid, 0.04, -0.02)), wy + 0.004, wy + 0.085, 1.0, 0.0)
    dry = g.m('SUBTRACT', 1.0, wet)
    soil = g.mix(g.ramp(mid, 0.3, 0.7), (0.105, 0.075, 0.05), (0.235, 0.185, 0.125)); soil = g.mix(g.m('MULTIPLY', trail, 0.5), soil, (0.30, 0.25, 0.185))
    soil = g.mix(g.m('MULTIPLY', g.ramp(g.noise(P, 14.0, 4), 0.5, 0.75), 0.45), soil, (0.075, 0.05, 0.03))                       # organic litter
    vor = g.n('ShaderNodeTexVoronoi', feature='F1'); g.set(vor.inputs['Vector'], P); vor.inputs['Scale'].default_value = 16.0
    pebmask = g.m('MULTIPLY', g.ramp(g.noise(P, 1.6, 3), 0.52, 0.68), g.ramp(vor.outputs['Distance'], 0.16, 0.30, 1.0, 0.0))
    crk = g.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); g.set(crk.inputs['Vector'], g.vm('ADD', P, g.vm('SCALE', g.n('ShaderNodeTexNoise').outputs['Color'], scale=0.0))); crk.inputs['Scale'].default_value = 3.2
    crack = g.m('MULTIPLY', g.m('MULTIPLY', g.ramp(crk.outputs['Distance'], 0.0, 0.03, 1.0, 0.0), g.ramp(g.noise(P, 0.5, 2), 0.45, 0.62)), g.m('MULTIPLY', dry, g.m('MULTIPLY_ADD', trail, 0.6, 0.25)))
    moss = g.m('MULTIPLY', g.m('MULTIPLY', g.ramp(g.m('ADD', big, g.m('MULTIPLY', mid, 0.25)), 0.60, 0.74), g.m('SUBTRACT', 1.0, trail)), dry)
    tone = g.m('MULTIPLY_ADD', fine, 0.7, 0.62); tc = g.n('ShaderNodeCombineColor'); [g.set(tc.inputs[i], tone) for i in range(3)]
    col = g.mul(soil, tc.outputs[0]); col = g.mix(g.m('MULTIPLY', moss, 0.85), col, g.mix(fine, (0.035, 0.055, 0.018), (0.085, 0.11, 0.035)))
    col = g.mix(g.m('MULTIPLY', pebmask, 0.85), col, g.mix(vor.outputs['Color'], (0.16, 0.15, 0.135), (0.33, 0.31, 0.28)))
    col = g.mix(g.m('MULTIPLY', crack, 0.5), col, (0.03, 0.022, 0.015)); col = g.mix(g.m('MULTIPLY', wet, 0.62), col, (0.02, 0.015, 0.01))
    rough = g.m('SUBTRACT', g.m('MULTIPLY_ADD', pebmask, -0.2, 0.92), g.m('MULTIPLY', wet, 0.7))
    h = g.m('ADD', g.m('ADD', g.m('MULTIPLY', fine, 0.022), g.m('MULTIPLY', grit, 0.004)), g.m('ADD', g.m('MULTIPLY', pebmask, 0.02), g.m('MULTIPLY', crack, -0.02)))
    h = g.m('ADD', h, g.m('MULTIPLY', g.m('MULTIPLY', moss, g.noise(P, 60.0, 2)), 0.02)); h = g.m('MULTIPLY', h, g.m('MULTIPLY_ADD', wet, -0.75, 1.0))
    bump = g.n('ShaderNodeBump'); bump.inputs['Distance'].default_value = 1.0; g.set(bump.inputs['Height'], h)
    add_obj('ground', me, g.finish(g.principled(**{'Base Color': col, 'Roughness': rough, 'Normal': bump.outputs[0]}).outputs[0]))
    # standing water: a level, refracting surface the ground dips below
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=96, radius=float(S['pathR']) + 30); mw = bpy.data.meshes.new('water'); bm.to_mesh(mw); bm.free()
    g = NT('water'); P = g.n('ShaderNodeNewGeometry').outputs['Position']; rb = g.n('ShaderNodeBump'); rb.inputs['Distance'].default_value = 1.0; g.set(rb.inputs['Height'], g.m('MULTIPLY', g.noise(P, 5.0, 2, 0.5, 0.4), 0.0025))
    pw = g.principled(**{'Base Color': (0.72, 0.62, 0.46, 1), 'Roughness': 0.015, 'IOR': 1.333, 'Normal': rb.outputs[0]})
    try: pw.inputs['Transmission Weight'].default_value = 1.0
    except Exception: pass
    lp = g.n('ShaderNodeLightPath'); ms = g.n('ShaderNodeMixShader'); g.set(ms.inputs[0], lp.outputs['Is Shadow Ray']); g.set(ms.inputs[1], pw.outputs[0]); tr = g.n('ShaderNodeBsdfTransparent'); tr.inputs[0].default_value = (0.8, 0.75, 0.65, 1); g.set(ms.inputs[2], tr.outputs[0])
    add_obj('water', mw, g.finish(ms.outputs[0]), Matrix.Translation((0, 0, wy)))

    # plants and stones as instances
    for I in S['instanced']:
        nm = I['name']; co = conv(arr(I['pos'], 3)); ix = arr(I['index']); uv = arr(I['uv'], 2)[ix] if 'uv' in I else None
        me = make_mesh(nm, co, ix, uv, smooth=True); g = NT(nm)
        if nm in ('fern', 'foliage'):
            tex = g.image(os.path.join(EXP, I['map']), 'sRGB'); oi = g.n('ShaderNodeObjectInfo'); col = g.mul(tex.outputs['Color'], oi.outputs['Color']) if nm == 'fern' else tex.outputs['Color']
            d = g.principled(**{'Base Color': col, 'Roughness': 0.5}); t = g.n('ShaderNodeBsdfTranslucent'); g.set(t.inputs[0], g.mul(col, (0.9, 1.0, 0.45)))
            ms = g.n('ShaderNodeMixShader'); ms.inputs[0].default_value = 0.4; g.set(ms.inputs[1], d.outputs[0]); g.set(ms.inputs[2], t.outputs[0])
            al = g.n('ShaderNodeMixShader'); g.set(al.inputs[0], g.ramp(tex.outputs['Alpha'], 0.35, 0.45, smooth=False)); g.set(al.inputs[1], g.n('ShaderNodeBsdfTransparent').outputs[0]); g.set(al.inputs[2], ms.outputs[0]); mat = g.finish(al.outputs[0])
        elif nm == 'trunk':
            P = g.n('ShaderNodeTexCoord').outputs['Object']; mp = g.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (6, 6, 0.5); g.set(mp.inputs['Vector'], P); nb = g.noise(mp.outputs[0], 2.0, 6, 0.7)
            bump = g.n('ShaderNodeBump'); bump.inputs['Distance'].default_value = 1.0; g.set(bump.inputs['Height'], g.m('MULTIPLY', nb, 0.05))
            mat = g.finish(g.principled(**{'Base Color': g.mix(g.ramp(nb, 0.3, 0.7), (0.035, 0.022, 0.014), (0.16, 0.105, 0.07)), 'Roughness': 0.9, 'Normal': bump.outputs[0]}).outputs[0])
        else:
            P = g.n('ShaderNodeNewGeometry').outputs['Position']; nb = g.noise(P, 3.0, 6, 0.65); bump = g.n('ShaderNodeBump'); bump.inputs['Distance'].default_value = 1.0; g.set(bump.inputs['Height'], g.m('MULTIPLY', g.noise(P, 14.0, 5, 0.7), 0.012))
            mat = g.finish(g.principled(**{'Base Color': g.mix(g.ramp(nb, 0.3, 0.7), (0.09, 0.085, 0.075), (0.3, 0.28, 0.25)), 'Roughness': 0.85, 'Normal': bump.outputs[0]}).outputs[0])
        me.materials.append(mat); Ms = arr(I['matrix'], 16); cols = arr(I['color'], 3) if 'color' in I else None; coll = bpy.data.collections.new(nm); scene.collection.children.link(coll)
        for k in range(I['count']):
            M3 = Matrix([Ms[k][0:4], Ms[k][4:8], Ms[k][8:12], Ms[k][12:16]]).transposed(); o = bpy.data.objects.new('%s%d' % (nm, k), me); o.matrix_world = C4 @ M3 @ C4.inverted(); coll.objects.link(o)
            if cols is not None: o.color = (*[float(x) for x in cols[k]], 1.0)
            if nm == 'foliage':
                for j, (ang, sc) in enumerate(((1.1, 0.93), (2.3, 1.06), (3.9, 0.86))): o2 = bpy.data.objects.new('%s%d_%d' % (nm, k, j), me); o2.matrix_world = o.matrix_world @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Diagonal((sc, sc, 1.0 - 0.03 * j, 1)); coll.objects.link(o2)
        log(nm, I['count'], 'instances')

def build_sky():
    w = bpy.data.worlds.new('sky'); scene.world = w; w.use_nodes = True; t = w.node_tree; t.nodes.clear()
    sky = t.nodes.new('ShaderNodeTexSky'); kinds = [e.identifier for e in sky.bl_rna.properties['sky_type'].enum_items]
    sky.sky_type = 'NISHITA' if 'NISHITA' in kinds else ('MULTIPLE_SCATTERING' if 'MULTIPLE_SCATTERING' in kinds else kinds[-1]); log('sky model', sky.sky_type, 'of', kinds)
    sky.sun_elevation = math.radians(S['sunElev'])
    for k, v in (('sun_disc', True), ('sun_size', math.radians(0.545)), ('sun_intensity', 1.0), ('altitude', 300.0), ('air_density', 1.0), ('dust_density', 2.2), ('aerosol_density', 2.2), ('ozone_density', 1.0)):
        try: setattr(sky, k, v)
        except Exception: pass
    bg = t.nodes.new('ShaderNodeBackground'); out = t.nodes.new('ShaderNodeOutputWorld'); t.links.new(sky.outputs[0], bg.inputs[0]); t.links.new(bg.outputs[0], out.inputs[0]); bg.inputs[1].default_value = 1.0
    if float(opt['haze']) > 0:   # a layer of thin haze near the ground: distance fades and the sun throws shafts between the trees
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); mh = bpy.data.meshes.new('haze'); bm.to_mesh(mh); bm.free()
        hm = bpy.data.materials.new('haze'); hm.use_nodes = True; ht = hm.node_tree; ht.nodes.clear(); ho = ht.nodes.new('ShaderNodeOutputMaterial'); vsc = ht.nodes.new('ShaderNodeVolumeScatter')
        vsc.inputs['Density'].default_value = float(opt['haze']); vsc.inputs['Anisotropy'].default_value = 0.6; vsc.inputs['Color'].default_value = (0.93, 0.96, 1.0, 1); ht.links.new(vsc.outputs[0], ho.inputs['Volume'])
        mh.materials.append(hm); add_obj('haze', mh, None, Matrix.Translation((0, 0, 17.0)) @ Matrix.Diagonal((900, 900, 36, 1)))
    return sky

def sun_azimuth_probe(sky):
    # find how the sky model's sun_rotation maps to compass direction: look around the horizon at the glow about the sun
    cam = bpy.data.objects.new('probe', bpy.data.cameras.new('probe')); scene.collection.objects.link(cam); scene.camera = cam; cam.data.lens = 50; cam.data.sensor_width = 36
    r = scene.render; r.resolution_x = r.resolution_y = 16; r.resolution_percentage = 100; scene.cycles.samples = 8; scene.cycles.use_denoising = False
    vs = scene.view_settings; vs.view_transform = 'Standard'; r.image_settings.file_format = 'OPEN_EXR'
    hide = [o for o in scene.objects if o.type == 'MESH']
    for o in hide: o.hide_render = True
    try: sky.sun_disc = False
    except Exception: pass
    el = math.radians(S['sunElev']); res = {}
    for rot in (0.0, math.pi / 2):
        sky.sun_rotation = rot; vals = []
        for az in range(0, 360, 15):
            d = Vector((math.cos(el) * math.cos(math.radians(az)), math.cos(el) * math.sin(math.radians(az)), math.sin(el))); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            r.filepath = '/tmp/probe.exr'; bpy.ops.render.render(write_still=True); img = bpy.data.images.load('/tmp/probe.exr'); px = np.array(img.pixels[:]).reshape(-1, 4)[:, :3]; vals.append(float(px.mean())); bpy.data.images.remove(img)
        vals = np.array(vals); k = int(vals.argmax()); w = np.array([vals[(k - 1) % 24], vals[k], vals[(k + 1) % 24]]) - vals.min(); res[rot] = (k * 15 + 15 * (w[2] - w[0]) / w.sum()) % 360
    sign = 1 if ((res[math.pi / 2] - res[0.0]) % 360) < 180 else -1
    sd = conv(S['sunDir'])[0]; want = math.degrees(math.atan2(sd[1], sd[0])); sky.sun_rotation = math.radians(((want - res[0.0]) * sign) % 360)
    try: sky.sun_disc = True
    except Exception: pass
    for o in hide: o.hide_render = False
    bpy.data.objects.remove(cam); log('sun azimuth: rotation 0 ->', round(res[0.0], 1), 'deg, sign', sign, '; set', round(math.degrees(sky.sun_rotation), 1), 'for azimuth', round(want, 1))

# ------------------------------------------------------------------ cameras: [forward, up, right] metres relative to the animal
VIEWS = {
    'hero':  dict(tgt=(1.6, 2.5, 0.0), cam=(13.5, 1.25, 8.5), lens=50, f=2.8),
    'head':  dict(tgt=(4.35, 3.25, 0.0), cam=(8.6, 2.7, 3.4), lens=85, f=4.0),
    'flank': dict(tgt=(0.3, 1.9, 0.0), cam=(3.4, 1.15, 7.2), lens=40, f=4.0),
    'low':   dict(tgt=(2.6, 2.9, 0.0), cam=(10.5, 0.35, 3.2), lens=28, f=4.0),
    'side':  dict(tgt=(-0.4, 2.3, 0.0), cam=(0.8, 1.7, 17.0), lens=50, f=2.8),
    'profile': dict(tgt=(4.5, 3.2, 0.0), cam=(5.3, 2.9, 5.2), lens=85, f=4.0),
    'rear':  dict(tgt=(0.2, 2.4, 0.0), cam=(-9.5, 1.5, 7.5), lens=45, f=2.8),
    'legs':  dict(tgt=(0.4, 1.3, 0.0), cam=(2.6, 0.7, 5.6), lens=45, f=4.0),
}
def place(v):
    O, Hd, Rt = [np.array(S[k]) for k in ('origin', 'heading', 'right')]
    w = lambda q: Vector(conv(O + Hd * q[0] + Rt * q[2] + np.array([0, q[1] - O[1], 0]))[0])
    return w(v['tgt']), w(v['cam'])

def main():
    r = scene.render; r.engine = 'CYCLES'; cy = scene.cycles; cy.device = 'CPU'; r.threads_mode = 'FIXED'; r.threads = int(opt['threads'])
    build_body(); build_world(); sky = build_sky(); log('scene built')
    cy.max_bounces = 8; cy.diffuse_bounces = 3; cy.glossy_bounces = 4; cy.transmission_bounces = 8; cy.transparent_max_bounces = 24; cy.volume_bounces = 0
    cy.sample_clamp_indirect = 8.0; cy.caustics_reflective = False; cy.caustics_refractive = False
    sun_azimuth_probe(sky)
    W, H = [int(x) for x in opt['res'].split('x')]; r.resolution_x = W; r.resolution_y = H; r.resolution_percentage = 100
    cy.samples = int(opt['samples']); cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.015; cy.use_denoising = True
    try: cy.denoiser = 'OPENIMAGEDENOISE'; cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    except Exception as e: log('denoiser:', e)
    try: r.use_persistent_data = True
    except Exception: pass
    vs = scene.view_settings
    try: vs.view_transform = 'AgX'
    except Exception: pass
    for look in (('AgX - Medium High Contrast', 'Medium High Contrast') if opt['look'] == 'high' else ('AgX - Medium Contrast', 'Medium Contrast') if opt['look'] == 'med' else ('AgX - Base Contrast', 'Base Contrast', 'None')):
        try: vs.look = look; break
        except Exception: pass
    try: r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGB'; r.image_settings.color_depth = '8'
    except Exception as e: log('image settings:', e)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam; cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24; cam.data.clip_start = 0.1; cam.data.clip_end = 3000
    for name in opt['views'].split(','):
        v = VIEWS[name]; tgt, pos = place(v); cam.location = pos; cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = v['lens']
        cam.data.dof.use_dof = opt['dof'] != '0'; cam.data.dof.focus_distance = (tgt - pos).length; cam.data.dof.aperture_fstop = v['f'] / max(0.05, float(opt['dof'])) if opt['dof'] != '0' else 8
        if opt['exposure'] == 'auto':   # meter the frame the way a camera would: a quick low-sample render, then expose for a mid-grey average
            r.resolution_percentage = 20; s0 = cy.samples; cy.samples = 12; vs.exposure = -4.0; r.filepath = '/tmp/meter.png'; bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load('/tmp/meter.png'); px = np.array(img.pixels[:]).reshape(-1, 4)[:, :3]; lum = float(np.mean(np.power(np.clip(px, 1e-4, 1), 2.2) @ np.array([0.2126, 0.7152, 0.0722]))); bpy.data.images.remove(img)
            vs.exposure = -4.0 + math.log2(0.16 / max(lum, 1e-4)) * 0.85 + float(opt['ev']); r.resolution_percentage = 100; cy.samples = s0; log(name, 'metered luminance', round(lum, 3), '-> exposure', round(vs.exposure, 2))
        else: vs.exposure = float(opt['exposure'])
        if opt['crop']: c_ = [float(x) for x in opt['crop'].split(',')]; r.use_border = True; r.use_crop_to_border = True; r.border_min_x, r.border_min_y, r.border_max_x, r.border_max_y = c_
        r.filepath = '%s-%s.png' % (OUT, name); t = time.time(); bpy.ops.render.render(write_still=True); log('rendered', name, 'in', round(time.time() - t), 's ->', r.filepath)
main()
