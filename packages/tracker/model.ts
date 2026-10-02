// Tracker records are ordinary graph bundles; the helpers read that boundary.

import type { Bundle, Comp } from '@yaks/graph'

export type Level = 'fatal' | 'error'
export type Frame = {
  file: string
  line?: number
  column?: number
  function?: string
  app?: boolean
  module?: string
  symbol?: string
}
export type Crumb = { at: string; category: string; message: string }
export let comp = (row: Bundle | undefined, name: string): Comp =>
  row?.[name] && typeof row[name] == 'object' ? row[name] as Comp : {}
export let str = (value: unknown): string => value == null ? '' : String(value)
export let title = (row: Bundle): string => {
  let x = comp(row, 'exception')
  return x.type ? `${x.type}: ${str(x.value)}` : str(comp(row, 'error').message)
}
