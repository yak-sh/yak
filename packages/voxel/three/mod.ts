/** Three.js rendering of voxel quads and box rigs. The voxel root stays worker-safe. */
export * from './soft.ts'
export * from './parts.ts'
export * from './puppet.ts'
// Published apps import `light` from here, where it lived before
// @yaks/voxel/light; it keeps answering for them.
export * from '../light.ts'
