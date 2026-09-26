// The soft look. Every voxel in the vale is drawn by this one material: three's
// Lambert, taught three things in its shader.
//
//   Rounded edges. A face knows which of its edges are convex (mesh.ts `rim`)
//   and where across it a pixel lies (`face`). Near a convex edge the normal
//   leans outward and the colour brightens a touch, so a hard cube reads as a
//   soft one without a single extra triangle.
//
//   Voxels on merged faces. A pixel is tinted by the voxel cell it falls in,
//   so a large flat quad of ground still shows its voxels.
//
//   A flash. A creature or a player glows for a moment when struck.
//
//   A line of sight. The ground and what stands on it thin away where they come
//   between the camera and the hero, and right around the camera, so a tree
//   or a toadstool in the way shows the hero through it (`see`). It is a
//   stipple, pixels left out in an even pattern, so nothing needs sorting.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Out } from './mesh.ts'

/** A geometry from what a mesher wrote. */
export let geometry = (o: Out): THREE.BufferGeometry => {
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nrm, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3))
  g.setAttribute('face', new THREE.Float32BufferAttribute(o.uv, 2))
  g.setAttribute('rim', new THREE.Float32BufferAttribute(o.rim, 4))
  g.setAttribute('bw', new THREE.Float32BufferAttribute(o.bw, 3))
  g.setIndex(
    o.pos.length / 3 > 65535
      ? new THREE.Uint32BufferAttribute(o.idx, 1)
      : new THREE.Uint16BufferAttribute(o.idx, 1),
  )
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

let VERTEX_PARS = /* glsl */ `
attribute vec2 face;
attribute vec4 rim;
attribute vec3 bw;

varying vec2 vFace;
varying vec4 vRim;
varying vec2 vBw;
varying vec3 vTu;
varying vec3 vTv;
varying vec3 vCell;
varying vec3 vAt;
`

let VERTEX = /* glsl */ `
vAt = (modelMatrix * vec4(transformed, 1.)).xyz;
vFace = face;
vRim = rim;
vBw = bw.xy;
vec3 an = abs(objectNormal);
vec3 tu = an.x > .5 ? vec3(0., 0., 1.) : vec3(1., 0., 0.);
vec3 tv = an.y > .5 ? vec3(0., 0., 1.) : vec3(0., 1., 0.);
#ifdef USE_INSTANCING
  tu = mat3(instanceMatrix) * tu;
  tv = mat3(instanceMatrix) * tv;
#endif
vTu = normalize(normalMatrix * tu);
vTv = normalize(normalMatrix * tv);
vCell = (position - objectNormal * (bw.z * .5)) / bw.z;
`

let FRAGMENT_PARS = /* glsl */ `
uniform vec3 flash;
uniform float flashing;
uniform float speckle;
varying vec2 vFace;
varying vec4 vRim;
varying vec2 vBw;
varying vec3 vTu;
varying vec3 vTv;
varying vec3 vCell;
varying vec3 vAt;
uniform vec3 seeFrom;
uniform vec3 seeTo;
float edge(float flag, float d, float w) {
  return flag * (1. - smoothstep(0., w, d));
}
float b2(vec2 p) {
  float x = mod(p.x, 2.), y = mod(p.y, 2.);
  return 2. * abs(x - y) + y;
}
// A 4 by 4 ordered dither: how far through the pattern this pixel is.
float bayer(vec2 p) {
  return (4. * b2(p) + b2(floor(p / 2.)) + .5) / 16.;
}
`

// What is left out: within 1.5 m of the line from the camera to the hero,
// stopping a metre short of them, and within 2 m of the camera.
let SIGHT = /* glsl */ `
#ifdef SEE
  vec3 sl = seeTo - seeFrom;
  float sL = max(length(sl), 1e-3);
  float along = dot(vAt - seeFrom, sl) / sL;
  float off = length(vAt - seeFrom - sl * (along / sL));
  float thin = along > 0. && along < sL - 1.
    ? 1. - smoothstep(.9, 1.5, off)
    : 0.;
  thin = max(thin, 1. - smoothstep(1.2, 2., length(vAt - seeFrom)));
  if (bayer(gl_FragCoord.xy) < thin * .8) discard;
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
    flash: { value: new THREE.Color(1, 0.35, 0.3) },
    flashing: { value: 0 },
    seeFrom: { value: new THREE.Vector3() },
    seeTo: { value: new THREE.Vector3() },
  }
  m.userData.soft = uniforms
  if (opts.see) m.defines = { SEE: '' }
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX}`)
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
  }
  m.customProgramCacheKey = () => opts.see ? 'soft-see' : 'soft'
  return m
}

/** The line of sight a see-through material keeps clear: from the camera to
 * the hero. */
export let sight = (
  m: THREE.Material,
  from: THREE.Vector3,
  to: THREE.Vector3,
) => {
  let u = m.userData.soft
  if (!u) return
  u.seeFrom.value.copy(from)
  u.seeTo.value.copy(to)
}

/** How strongly a soft material glows its flash colour, 0 to 1. */
export let flash = (m: THREE.Material, amount: number, color?: THREE.Color) => {
  let u = m.userData.soft
  if (!u) return
  u.flashing.value = amount
  if (color) u.flash.value.copy(color)
}
