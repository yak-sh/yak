// Mossvale's payload for a generic pulsing ground area.
import {
  type Area as GroundArea,
  areas as decode,
  planted as plant,
} from '@yaks/game'
import type { AreaEffect, Ground } from './ability-effects.ts'
export type { AreaEffect, Ground } from './ability-effects.ts'

export { following, pulse, received, within } from '@yaks/game'
export type Area = GroundArea<Ground, {
  blow: number
  max: number
  element?: string
}>

export let areas = (value: unknown): Area[] => decode(value)

export let planted = (
  e: AreaEffect,
  source: string,
  level: string,
  name: string,
  at: { x: number; y: number; z: number },
  now: number,
  blow: number,
  max: number,
  element?: string,
): Area => plant(e, source, level, name, at, now, { blow, max, element })
