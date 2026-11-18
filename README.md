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

**Head.** Gaze is stabilised against the body's pitch, roll and yaw, with slow gaze shifts. The mouth has lips covering the teeth (Cullen et al. 2023); they show when it opens.

## Controls

| | |
|---|---|
| Speed | 0–7.5 m/s. At zero the animal finishes its step and stands. |
| Camera | Seven views including a fixed tripod; drag to orbit, pinch/scroll to zoom. |
| View | Skin · muscle activation heat-map · soft-tissue strain. |
| Forces | Ground reaction force vectors, centre of mass and its trajectory. |
| ¼× time | Slow motion. |
| Advanced | Muscle definition, soft-tissue wobble, tail natural frequency, sun position, quality. |

Keys: `c` camera, `space` slow motion, `r` roar, `↑/↓` speed. URL parameters: `?speed=3&cam=side&view=1&forces=1&q=high|med|low`.

## What is approximate

- This is a reduced-order model: forces and centre-of-mass motion are physical, but the legs follow them kinematically. It is not a forward-dynamic musculoskeletal simulation, and the muscle excitations are quasi-static inverse dynamics that ignore segment inertia in stance.
- Soft tissue is a coarse lattice, not a finite-element solid. Wobble and muscle bulge are drawn at 1.5× by default so they read at a distance; set both to 1.0× in Advanced for the literal values.
- Skin colour and pattern are invented. Scale size is exaggerated relative to the few known skin impressions.
- Mass for force read-outs is 8.4 t; the mesh volume would give ~8.3–9.3 t depending on assumed density.
- The plants are a loose nod to the Hell Creek flora.

## Layout

```
index.html           UI shell
src/main.js          renderer, cameras, UI, main loop
src/gait.js          gait scaling, ground reaction forces, COM dynamics, leg IK
src/dynamics.js      spine, head, muscles, soft-tissue lattice
src/tail.js          elastic-beam tail
src/rex.js           mesh, skeleton, eyes, teeth
src/skinShader.js    integument + deformation shader
src/world.js         sky, ground, vegetation, footprints, dust
tools/anatomy.mjs    skeleton and muscle definitions
tools/build-rex.mjs  surface + weights builder  (npm run build)
tools/shot.mjs       headless screenshot harness used for verification
assets/              built meshes (high and low detail, gzip)
vendor/              three.js r170 (MIT)
```

## Sources

- Alexander RM (1976) Estimates of speeds of dinosaurs. *Nature* 261:129–130.
- Alexander RM, Jayes AS (1980) Fourier analysis of forces exerted in walking and running. *J Biomech* 13:383–390.
- Gatesy SM, Biewener AA (1991) Bipedal locomotion: effects of speed, size and limb posture in birds and humans. *J Zool* 224:127–147.
- Maus H-M et al. (2010) Upright human gait did not provide a major mechanical challenge for our ancestors. *Nat Commun* 1:70.
- Hutchinson JR et al. (2011) A computational analysis of limb and body dimensions in *Tyrannosaurus rex*. *PLoS ONE* 6:e26037.
- Sellers WI et al. (2017) Investigating the running abilities of *Tyrannosaurus rex* using stress-constrained multibody dynamic analysis. *PeerJ* 5:e3420.
- van Bijlert PA, van Soest AJK, Schulp AS (2021) Natural Frequency Method: estimating the preferred walking speed of *Tyrannosaurus rex* based on tail natural frequency. *R Soc Open Sci* 8:201441.
- Cullen TM et al. (2023) Theropod dinosaur facial reconstruction and the importance of soft tissues in paleobiology. *Science* 379:1348–1352.
