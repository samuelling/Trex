# Tyrannosaurus rex — locomotion and soft-tissue simulation

A real-time, physically grounded rendering of an adult *Tyrannosaurus rex* (FMNH PR 2081 "Sue" scale: 12.2 m long, ~3 m at the hip). The animal walks a circular path; every part of its motion comes from a model rather than a keyframed animation. Runs in any current browser with WebGL 2 — no build step, no network dependencies.

**Run it:** serve the folder (`python3 -m http.server 8080`) and open `http://localhost:8080`, or enable GitHub Pages for the repository (branch `main`, root).

## What is modelled

**Body.** The animal is built the way it was put together in life. `tools/anatomy.mjs` defines a 47-bone skeleton and 140 volumes laid over it, in 28 muscle groups — individual muscle bellies with real origins and insertions (caudofemoralis longus from tail to fourth trochanter, the triceps femoris group, flexor tibialis, gastrocnemius, epaxials…), the rib cage and gastral basket, and a skull defined by profile curves. `tools/build-rex.mjs` takes the smooth union of those volumes, extracts the surface, and records for every skin vertex which bones move it, which muscles lie under it, and which soft-tissue nodes it rides on. The enclosed volume is 9.8 m³.

**Gait.** Speed sets the Froude number, and the gait follows from dynamic similarity: stride length from Alexander's relation, duty factor from the avian trend, both limited by how far the leg can actually reach. Duty factor never drops below 0.5 — there is no aerial phase, following the bone-stress argument of Sellers et al. (2017).

**Forces and body motion.** Each leg's vertical ground reaction force follows the Alexander–Jayes two-term model. Its shape factor is set so mid-stance force matches inverted-pendulum vaulting at a walk, blending to a single-humped compliant "grounded run" at higher Froude numbers. Horizontal force comes from a virtual-pivot-point model (the force vector points at a spot above the centre of mass). The centre of mass trajectory is the integral of those forces; foot placement is whatever makes braking and propulsive impulse cancel. Trunk pitch is the torque response to the same forces.

**Legs.** Three-segment digitigrade limb solved by inverse kinematics: the toes stay planted and the metatarsus rolls over them, then the foot peels off toe-last; toes fold and spread again in swing. The pelvis drops when a leg would otherwise over-extend.

**Tail.** A tapered elastic beam cantilevered from the pelvis, with bending stiffness at each caudal joint scaled by the local cross-section and extra stiffness distally. It has real vibration modes; stiffness is calibrated at start-up so the first dorsoventral mode sits at 0.66 Hz, the tail natural frequency estimated by van Bijlert et al. (2021). Step rate crosses that frequency near 0.9 m/s — watch the heave grow there.

**Muscles.** The external moment of the ground reaction force about hip, knee, ankle and toe joints sets the excitation of the muscle group that has to resist it, passed through activation dynamics. Each muscle's length is tracked from origin to insertion; bellies thicken as they shorten (constant volume) and stiffen when active. The skin shader displaces and re-shades the surface accordingly.

**Soft tissue.** 111 wobbling masses distributed through the belly, thighs, tail base, neck and throat, each tethered to the skeleton by a damped spring and coupled to its neighbours. Nothing drives them except the motion of their anchors, so footfalls and limb accelerations ripple through the flesh. Active muscle is stiffer, so a relaxed swing-leg thigh wobbles more than a loaded one.

**Filled out, not shrink-wrapped.** The soft tissue follows the published arguments for a bulky animal: a tail base swollen by the caudofemoralis (Persons & Currie 2011), thighs and drumsticks sized to the fleshy models of Hutchinson et al. (2011), a deep neck (Snively & Russell 2007), and skull openings, hip bones and shoulder blades buried under muscle and skin rather than showing through. The mesh encloses 11.4 m³, about 9.5 t at a whole-body density of 0.83.

**Running, and what it would cost.** The speed slider runs to 7.5 m/s as a grounded run: duty factor is held at 0.5, so one foot is always down. A beam model estimates peak femur and tibia stress each stride from the ground force along the shaft, the muscle force needed to balance the joint moment, and the part of the bending moment that muscles do not cancel. *Allow aerial run* (Advanced) lifts the duty-factor limit and extends the slider to 12 m/s; peak ground force climbs from 1.7 to about 2.5 body weights and estimated bone stress from roughly 35 to 90 MPa, taking the safety factor against yield (200 MPa) from about 6 down toward 2 — the pattern behind Sellers et al.'s (2017) conclusion that the animal was limited to walking gaits.

**Turning.** The animal steers by integrating its heading; *Turn round* reverses its direction on the circuit. Yaw acceleration is capped near 1.2 rad/s² (yaw inertia of order 3×10⁴ kg m², a few tens of kN m from the hip muscles through a planted leg) and yaw rate near 0.5 rad/s, so a reversal is a pivot of several seconds at a shuffle, with the head leading. Tyrannosaurids were about twice as agile as other giant theropods of the same mass (Snively et al. 2019), but still slow in absolute terms.

**Strike and feed.** *Strike & feed* stops the animal, drops the trunk and neck in a fast ventral strike onto a carcass, tears with lateral head shakes, then lifts and feeds inertially — the head jerks back, the jaws release the piece and close over it further in — followed by a swallow. The sequence illustrates the behaviours Snively & Russell (2007) found the neck muscles capable of; the timings are illustrative, not fitted.

**Skeleton.** The *Skeleton* view strips the animal to its bones — skull with its openings, 10 cervical, 13 dorsal, 5 sacral and 40 caudal vertebrae with spines and chevrons, ribs and gastralia, pelvis, limbs and digits — carried by the same joints and the same simulation, with the flesh as a faint outline.

**Skin.** The hide is its own simulated layer rather than paint on the muscle. A 10,900-vertex sheet covers the body and is solved every frame with position-based dynamics: each point is tied to the fascia underneath by a spring whose stiffness depends on how loose the skin is there (tight over the skull, shins and limb folds; loose on the throat, belly and flanks), it can lift off but not sink in, its edges resist stretch but go slack in compression, and gravity acts on it. So the skin lags and slides over the moving muscle, the dewlap and belly hang and sway, and where the sheet is compressed — inside of a bending neck, behind the thigh — the shader raises wrinkles from the measured strain, while stretched skin smooths out.

**Surface detail.** `tools/build-rex.mjs` unwraps the body into a texture atlas and bakes 4K maps (2K on the light tier) from a procedural 3D skin field: fine pebbly scales (kept small, after the 1–2.5 mm scales of the known skin patches; Bell et al. 2017), wrinkle networks that follow the direction each joint folds, scutes on the feet, scars, mud, countershaded colour. Folds deeper than a few millimetres are pushed into the geometry itself; finer relief is a normal map, baked in the rest pose and rotated per pixel with the skin as it deforms. A tiling micro-detail layer keeps scales crisp in close-up.

**Head.** Gaze is stabilised against the body's pitch, roll and yaw, with slow gaze shifts. The mouth has lips covering the teeth (Cullen et al. 2023); they show when it opens.

## Controls

| | |
|---|---|
| Speed | 0–7.5 m/s. At zero the animal finishes its step and stands. |
| Camera | Seven views including a fixed tripod; drag to orbit, pinch/scroll to zoom. |
| View | Skin · muscle activation heat-map · skin strain (stretch and compression of the simulated hide) · skeleton. |
| Turn round | Pivot and walk the circuit the other way. |
| Strike & feed | Stop, strike at a carcass, tear, toss and swallow. |
| Forces | Ground reaction force vectors, centre of mass and its trajectory. |
| ¼× time | Slow motion. |
| Advanced | Muscle definition, soft-tissue wobble, allow aerial run, skin looseness, tail natural frequency, depth of field, sun position, quality. |

Keys: `c` camera, `space` slow motion, `r` roar, `t` turn round, `f` strike and feed, `↑/↓` speed. URL parameters: `?speed=3&cam=side&view=1&forces=1&q=high|med|low&dof=1&sun=19&az=20`.

Quality tiers: **high** loads the 386k-triangle mesh with 4K textures (about 20 MB) and is meant for a desktop GPU; **medium** and **low** use a 180k-triangle mesh with 2K textures (about 8 MB); low also drops depth of field and bloom. Phones start on low.

## What is approximate

- This is a reduced-order model: forces and centre-of-mass motion are physical, but the legs follow them kinematically. It is not a forward-dynamic musculoskeletal simulation, and the muscle excitations are quasi-static inverse dynamics that ignore segment inertia in stance.
- Soft tissue is a coarse lattice, not a finite-element solid. Wobble and muscle bulge are drawn at 1.5× by default so they read at a distance; set both to 1.0× in Advanced for the literal values.
- The skin sheet is coarse (about 7.5 cm between points) and is pinned where limbs meet the trunk, so fine sliding there is not captured. Wrinkles are shaded, not geometric.
- Skin colour and pattern are invented. Scale size is exaggerated relative to the few known skin impressions.
- Mass for force read-outs is 9.5 t (mesh volume 11.4 m³ at density 0.83); published estimates for this specimen run from about 8.4 to 9.5 t, with fleshier models higher.
- Bone stress is a beam estimate with fixed moment arms and a fixed share (0.3) of uncancelled bending; trust the trend with speed and duty factor, not the absolute number.
- Integument is scaly throughout, the majority reading of the skin patches; a sparse dorsal covering of filaments cannot be excluded and is not modelled.
- The skeleton is built from simple volumes: proportions and counts are right, individual bone shapes are schematic.
- The plants are a loose nod to the Hell Creek flora. The setting is a real-time scene with one sun, a shadow map and image-based sky light — not a path-traced render.

## Layout

```
index.html           UI shell
src/main.js          renderer, cameras, UI, main loop
src/gait.js          gait scaling, ground reaction forces, COM dynamics, leg IK
src/dynamics.js      spine, head, muscles, soft-tissue lattice
src/skin.js          simulated skin sheet (slide, sag, strain)
src/terrain.js       ground relief shared by the renderer and the gait
src/dof.js           depth-of-field pass
src/skeleton.js      loader for the skeleton view
src/tail.js          elastic-beam tail
src/rex.js           mesh, skeleton, eyes, teeth
src/skinShader.js    integument + deformation shader
src/world.js         sky and cloud, ground and standing water, vegetation, footprints, dust
tools/anatomy.mjs    skeleton and muscle definitions
tools/build-rex.mjs  surface, weights, skin sheet, atlas and texture builder  (npm run build; needs `sharp`)
tools/skinfield.mjs  procedural 3D skin relief and colour
tools/unwrap.mjs     texture-atlas unwrap and packing
tools/bake.mjs       texture baking
tools/shot.mjs       headless screenshot harness used for verification
tools/export.mjs     dumps one simulated instant (deformed animal + scene) for offline rendering
tools/render_cycles.py  path-traced stills of an export with Blender's Cycles (pip install bpy)
assets/              built meshes (gzip) and baked textures (WebP)
vendor/              three.js r170 (MIT)
```

## Offline path-traced stills

The real-time view uses one shadow-mapped sun and image-based sky light. For stills, the same instant can be path traced:

```
node tools/export.mjs out/pose 9 -0.3 1.3            # sim seconds, gaze yaw, speed
HEIGHT_OUT=out/height.png node --max-old-space-size=6500 tools/build-rex.mjs hi 4096   # also writes the fine-relief height map
python tools/render_cycles.py out/pose assets out/height.png out/rex --views side,rear,hero,legs --res 1600x900 --samples 72 --haze 0.003 --sun 15
```

The exporter evaluates the full deformation chain on the CPU (skinning, muscle bulge, soft-tissue lattice, simulated skin) so the offline mesh is exactly the animal the app draws. Cycles then supplies physical sun and sky, soft shadows, bounce light, subsurface scattering in the skin, refraction in the eyes and the standing water, haze, and a real lens aperture. Not included: motion blur (one instant is exported) and hair-fine geometric wrinkles.

## Sources

- Bell PR et al. (2017) Tyrannosauroid integument reveals conflicting patterns of gigantism and feather evolution. *Biol Lett* 13:20170092.
- Persons WS, Currie PJ (2011) The tail of *Tyrannosaurus*: reassessing the size and locomotive importance of the M. caudofemoralis in non-avian theropods. *Anat Rec* 294:119–131.
- Snively E, Russell AP (2007) Craniocervical feeding dynamics of *Tyrannosaurus rex*. *Paleobiology* 33:610–638.
- Snively E et al. (2019) Lower rotational inertia and larger leg muscles indicate more rapid turns in tyrannosaurids than in other large theropods. *PeerJ* 7:e6432.

- Alexander RM (1976) Estimates of speeds of dinosaurs. *Nature* 261:129–130.
- Alexander RM, Jayes AS (1980) Fourier analysis of forces exerted in walking and running. *J Biomech* 13:383–390.
- Gatesy SM, Biewener AA (1991) Bipedal locomotion: effects of speed, size and limb posture in birds and humans. *J Zool* 224:127–147.
- Maus H-M et al. (2010) Upright human gait did not provide a major mechanical challenge for our ancestors. *Nat Commun* 1:70.
- Hutchinson JR et al. (2011) A computational analysis of limb and body dimensions in *Tyrannosaurus rex*. *PLoS ONE* 6:e26037.
- Sellers WI et al. (2017) Investigating the running abilities of *Tyrannosaurus rex* using stress-constrained multibody dynamic analysis. *PeerJ* 5:e3420.
- van Bijlert PA, van Soest AJK, Schulp AS (2021) Natural Frequency Method: estimating the preferred walking speed of *Tyrannosaurus rex* based on tail natural frequency. *R Soc Open Sci* 8:201441.
- Cullen TM et al. (2023) Theropod dinosaur facial reconstruction and the importance of soft tissues in paleobiology. *Science* 379:1348–1352.
