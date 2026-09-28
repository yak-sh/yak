// The soft look. Every voxel in the vale is drawn by this one material: three's
// Lambert, taught three things in its shader.
//
//   Rounded edges. A face knows which of its edges are convex and where
//   across it a pixel lies (mesh.ts `edge`). Near a convex edge the normal
//   leans outward and the colour brightens a touch, so a hard cube reads as a
//   soft one without a single extra triangle.
//
//   Voxels on merged faces. A pixel is tinted by the voxel cell it falls in,
//   so a large flat quad of ground still shows its voxels.
//
//   Metal. A face made of metal (mesh.ts `METAL`) shows less of its own
//   colour lit and more of what it mirrors: the sky above its horizon and the
//   ground below it, as the scene's hemisphere light colours them, whiter
//   toward a grazing edge; and each light that reaches it, the sun and the
//   fire, is a tight bright highlight on it that slides as it turns. Both
//   take the metal's own colour, so a tinted metal shines its tint, and both
//   follow the day's light as world.ts moves it. A few sums a pixel, and none
//   for anything matte.
//
//   A flash. A creature or a player glows for a moment when struck.
//
//   A line of sight. The ground and what stands on it thin away where, as the
//   camera sees them, they cover the hero or nearby attackers, and right
//   around the camera (`see`). The clearance is round but ends above the
//   ground, so a tree in the way shows the fight without hollowing the land.
//   It is a stipple, pixels left out in an even pattern, so nothing needs
//   sorting. The roof and upper floors of a building the hero is in or behind
//   thin away the same way, over a height within its box (`cut`).
//
//   No seams. A vertex is placed in the world before it is seen from the
//   camera, never through the two at once, so where two chunks meet, the same
//   point in each lands on the same pixel: a chunk stands at whole metres and
//   its corners at whole voxels, which float32 adds exactly.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Packed } from './mesh.ts'

/** How many boxes a see-through material fades at once. */
export let CUTS = 3
/** The nearest attackers whose silhouettes the woods also leave clear. */
export let FOES = 3

/** A geometry over what a mesher wrote, packed (mesh.ts `pack`): the arrays
 * become the geometry's own, uncopied. */
export let geometry = (p: Packed): THREE.BufferGeometry => {
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 4))
  g.setAttribute('color', new THREE.BufferAttribute(p.col, 4, true))
  g.setAttribute('edge', new THREE.BufferAttribute(p.edge, 4))
  g.setAttribute('bw', new THREE.BufferAttribute(p.bw, 3))
  g.setIndex(new THREE.BufferAttribute(p.idx, 1))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

let VERTEX_PARS = /* glsl */ `
attribute vec4 edge;
attribute vec3 bw;
// The colours come as sRGB bytes (mesh.ts), and light blends in linear.
vec3 unsrgb(vec3 c) {
  return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c));
}

varying vec2 vFace;
varying vec4 vRim;
varying vec2 vBw;
varying vec3 vTu;
varying vec3 vTv;
varying vec3 vCell;
varying vec3 vAt;
varying float vMaterial;
varying float vWarmth;
`

let VERTEX = /* glsl */ `
vec4 worldAt = vec4(transformed, 1.);
#ifdef USE_INSTANCING
  worldAt = instanceMatrix * worldAt;
#endif
vAt = (modelMatrix * worldAt).xyz;
vFace = edge.xy;
vMaterial = edge.w;
vWarmth = floor(edge.z / 16.) / 15.;
vRim = mod(floor(edge.z / vec4(1., 2., 4., 8.)), 2.);
vBw = bw.xy;
// The face's own axes, from its normal as it was meshed, turned as the mesh
// is turned: by its instance, or by the bone that carries it.
vec3 an = abs(normal);
vec3 tu = an.x > .5 ? vec3(0., 0., 1.) : vec3(1., 0., 0.);
vec3 tv = an.y > .5 ? vec3(0., 0., 1.) : vec3(0., 1., 0.);
#ifdef USE_INSTANCING
  tu = mat3(instanceMatrix) * tu;
  tv = mat3(instanceMatrix) * tv;
#endif
#ifdef USE_SKINNING
  tu = (skinMatrix * vec4(tu, 0.)).xyz;
  tv = (skinMatrix * vec4(tv, 0.)).xyz;
#endif
vTu = normalize(normalMatrix * tu);
vTv = normalize(normalMatrix * tv);
vCell = (position - normal * (bw.z * .5)) / bw.z;
`

// three's project_vertex, but for the world before the view.
let PROJECT = /* glsl */ `
vec4 mvPosition = vec4(transformed, 1.);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = viewMatrix * (modelMatrix * mvPosition);
gl_Position = projectionMatrix * mvPosition;
`

let FRAGMENT_PARS = /* glsl */ `
uniform vec3 flash;
uniform float flashing;
uniform float speckle;
uniform float night;
varying vec2 vFace;
varying vec4 vRim;
varying vec2 vBw;
varying vec3 vTu;
varying vec3 vTv;
varying vec3 vCell;
varying vec3 vAt;
varying float vMaterial;
varying float vWarmth;
uniform vec3 seeFrom;
uniform vec3 seeFeet;
uniform float seeTall;
uniform vec4 seeFoes[FOES];
uniform vec4 cutLo[CUTS];
uniform vec3 cutHi[CUTS];
float edge(float flag, float d, float w) {
  return flag * (1. - smoothstep(0., w, d));
}
float b2(vec2 p) {
  float x = mod(p.x, 2.), y = mod(p.y, 2.);
  return 2. * abs(x - y) + y;
}
// A 4 by 4 ordered dither: how far through the pattern this pixel is, from
// 1/32 to 31/32. A pixel's coordinates are its middle, so they are floored
// first, or some pixels would be past 1 and never left out.
float bayer(vec2 p) {
  p = floor(p);
  return (4. * b2(p) + b2(floor(p / 2.)) + .5) / 16.;
}
`

// A pixel's ray meets a disc at the subject's distance from the camera.
// Keep the lower edge above the ground and the last metre before the subject
// whole, so only the intervening woods thin away.
let SIGHT = /* glsl */ `
#ifdef SEE
  vec3 sl = seeFeet + vec3(0., seeTall * .5, 0.) - seeFrom;
  float sL = max(length(sl), 1e-3);
  vec3 ahead = sl / sL;
  float along = dot(vAt - seeFrom, ahead);
  vec3 upward = normalize(vec3(0., 1., 0.) - ahead * ahead.y);
  vec3 met = (vAt - seeFrom) * (sL / max(along, 1e-3)) - sl;
  float up = dot(met, upward);
  float body = (1. - smoothstep(1.7, 2.4, length(met))) *
    smoothstep(-seeTall * .5 - .35, -seeTall * .5 - .1, up);
  float thin = along > 0. && along < sL - 1. ? body : 0.;
  for (int i = 0; i < FOES; i++) {
    vec4 foe = seeFoes[i];
    if (foe.w <= 0.) continue;
    vec3 toFoe = foe.xyz - seeFrom;
    float distanceToFoe = max(length(toFoe), 1e-3);
    float alongFoe = dot(vAt - seeFrom, toFoe / distanceToFoe);
    if (alongFoe <= 0. || alongFoe >= distanceToFoe - .5) continue;
    vec3 metFoe = (vAt - seeFrom) *
      (distanceToFoe / max(alongFoe, 1e-3)) - toFoe;
    float upFoe = dot(metFoe,
      normalize(vec3(0., 1., 0.) - toFoe *
        (toFoe.y / (distanceToFoe * distanceToFoe))));
    float clearFoe = (1. - smoothstep(foe.w * .7, foe.w, length(metFoe))) *
      smoothstep(-foe.w * .8, -foe.w * .55, upFoe);
    thin = max(thin, clearFoe);
  }
  float near = 1. - smoothstep(1.2, 2., length(vAt - seeFrom));
  thin = max(thin, near * smoothstep(seeFrom.y - 1., seeFrom.y - .5, vAt.y));
  float gone = thin * .8;
  for (int i = 0; i < CUTS; i++) {
    vec3 lo = cutLo[i].xyz;
    if (all(greaterThanEqual(vAt, lo)) && all(lessThanEqual(vAt, cutHi[i]))) {
      gone = max(gone, cutLo[i].w);
    }
  }
  if (bayer(gl_FragCoord.xy) < gone) discard;
#endif
`

let COLOR = /* glsl */ `
float r0 = edge(vRim.x, vFace.x, vBw.x);
float r1 = edge(vRim.y, 1. - vFace.x, vBw.x);
float r2 = edge(vRim.z, vFace.y, vBw.y);
float r3 = edge(vRim.w, 1. - vFace.y, vBw.y);
float rounded = max(max(r0, r1), max(r2, r3));
vec3 cellOf = floor(vCell + 1e-3);
float speck = fract(sin(dot(cellOf, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
diffuseColor.rgb *= 1. + speckle * (speck - .5);
diffuseColor.rgb *= 1. + .14 * rounded;
diffuseColor.rgb = mix(diffuseColor.rgb, flash, flashing);
`

let NORMAL = /* glsl */ `
normal = normalize(normal + (vTu * (r1 - r0) + vTv * (r3 - r2)) * .95);
`

// Each light as Lambert has it, and on metal its highlight too: a tight core
// going white in a wider glow of the metal's colour.
let LIGHT = /* glsl */ `
bool metal() { return vMaterial > .5 && vMaterial < 1.5; }
void RE_Direct_Soft(
  const in IncidentLight light,
  const in vec3 at,
  const in vec3 n,
  const in vec3 view,
  const in vec3 coat,
  const in LambertMaterial material,
  inout ReflectedLight reflected
) {
  RE_Direct_Lambert(light, at, n, view, coat, material, reflected);
  if (!metal()) return;
  float nh = saturate(dot(n, normalize(light.direction + view)));
  float nl = saturate(dot(n, light.direction));
  vec3 glint = mix(material.diffuseColor, vec3(1.), .6) * pow(nh, 90.) * 4.
    + material.diffuseColor * pow(nh, 12.) * .5;
  reflected.directSpecular += light.color * nl * glint;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Soft
`

// What metal mirrors, and its highlights, over a little of its own light: the
// sky down to a crisp horizon, paler low and deeper overhead, and the ground
// dark and grey under it.
let MIRROR = /* glsl */ `
if (metal()) {
  vec3 seen = reflect(-geometryViewDir, geometryNormal);
  float grazing = pow(1. - saturate(dot(geometryNormal, geometryViewDir)), 4.);
  vec3 around = vec3(0.);
  #if NUM_HEMI_LIGHTS > 0
    HemisphereLight hemi = hemisphereLights[0];
    float up = dot(seen, hemi.direction);
    vec3 low = hemi.skyColor * 1.1, high = hemi.skyColor * hemi.skyColor;
    vec3 earth = hemi.groundColor;
    earth = mix(vec3(dot(earth, vec3(.3, .6, .1))), earth, .4) * .5;
    around = mix(earth, mix(low, high, saturate(up)), smoothstep(-.03, .03, up));
  #endif
  outgoingLight = outgoingLight * .35
    + around * mix(diffuseColor.rgb, vec3(1.), grazing) * .7
    + reflectedLight.directSpecular;
}
outgoingLight += vec3(1., .32, .08) * vWarmth * (.18 + .82 * night);
`

/** A soft material: `speckle` is how much each voxel's shade wobbles, and a
 * material that can `see` through (the ground's) thins away between the
 * camera and the hero once `sight` says where they are. */
export let soft = (
  opts: {
    speckle?: number
    transparent?: boolean
    opacity?: number
    see?: boolean
  } = {},
) => {
  let m = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  })
  let uniforms = {
    speckle: { value: opts.speckle ?? 0.1 },
    night: { value: 0 },
    flash: { value: new THREE.Color(1, 0.35, 0.3) },
    flashing: { value: 0 },
    seeFrom: { value: new THREE.Vector3() },
    seeFeet: { value: new THREE.Vector3() },
    seeTall: { value: 1 },
    seeFoes: {
      value: Array.from({ length: FOES }, () => new THREE.Vector4()),
    },
    cutLo: { value: Array.from({ length: CUTS }, () => new THREE.Vector4()) },
    cutHi: { value: Array.from({ length: CUTS }, () => new THREE.Vector3()) },
  }
  m.userData.soft = uniforms
  m.defines = { CUTS, FOES, ...opts.see ? { SEE: '' } : {} }
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX}`)
      .replace('#include <project_vertex>', PROJECT)
      .replace(
        '#include <color_vertex>',
        '#include <color_vertex>\nvColor.rgb = unsrgb(vColor.rgb);',
      )
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${SIGHT}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${COLOR}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${NORMAL}`,
      )
      .replace(
        '#include <lights_lambert_pars_fragment>',
        `#include <lights_lambert_pars_fragment>\n${LIGHT}`,
      )
      .replace(
        '#include <envmap_fragment>',
        `#include <envmap_fragment>\n${MIRROR}`,
      )
  }
  m.customProgramCacheKey = () => opts.see ? 'soft-see' : 'soft'
  return m
}

/** The sight a see-through material keeps clear: from the camera (`from`)
 * of the hero standing at `feet`, `tall` metres tall, and the nearest foes
 * aiming at them. A foe's fourth coordinate is its clearance radius. */
export let sight = (
  m: THREE.Material,
  from: THREE.Vector3,
  feet: THREE.Vector3,
  tall: number,
  foes: THREE.Vector4[] = [],
) => {
  let u = m.userData.soft
  if (!u) return
  u.seeFrom.value.copy(from)
  u.seeFeet.value.copy(feet)
  u.seeTall.value = tall
  u.seeFoes.value.forEach((at: THREE.Vector4, i: number) =>
    foes[i] ? at.copy(foes[i]) : at.set(0, 0, 0, 0)
  )
}

/** The boxes a see-through material fades, `lo` to `hi` in metres, each by
 * `fade` (0 not at all, 1 gone); the rest of its CUTS fade none. */
export let cut = (
  m: THREE.Material,
  boxes: { lo: THREE.Vector3Tuple; hi: THREE.Vector3Tuple; fade: number }[],
) => {
  let u = m.userData.soft
  if (!u) return
  u.cutLo.value.forEach((lo: THREE.Vector4, i: number) => {
    let b = boxes[i]
    lo.set(b?.lo[0] ?? 0, b?.lo[1] ?? 0, b?.lo[2] ?? 0, b?.fade ?? 0)
    u.cutHi.value[i].set(b?.hi[0] ?? -1, b?.hi[1] ?? -1, b?.hi[2] ?? -1)
  })
}

/** How strongly a soft material glows its flash colour, 0 to 1. */
export let flash = (m: THREE.Material, amount: number, color?: THREE.Color) => {
  let u = m.userData.soft
  if (!u) return
  u.flashing.value = amount
  if (color) u.flash.value.copy(color)
}

/** How much the day's light has fallen, shared by every soft mesh. */
export let night = (m: THREE.Material, amount: number) => {
  let u = m.userData.soft
  if (u) u.night.value = amount
}
