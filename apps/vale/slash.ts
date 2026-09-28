// Commands typed into chat: their words are parsed here, before the chat box
// can put them in its public outbox. The page performs the chosen action.
import { LEVELS } from './levels.ts'

export type Command =
  | { kind: 'teleport'; target: { level: string } | { x: number; z: number } }
  | { kind: 'health'; enabled: boolean }

export type Slash = { command: Command } | { error: string }

let metre = (s: string): number | null => {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return null
  let n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** A slash command, its usage error, or null for ordinary chat. */
export let slash = (text: string): Slash | null => {
  if (!text.startsWith('/')) return null
  let [name, ...args] = text.slice(1).trim().split(/\s+/)
  if (name?.toLowerCase() == 'health') {
    if (args.length == 1 && /^(on|off)$/i.test(args[0])) {
      return {
        command: { kind: 'health', enabled: args[0].toLowerCase() == 'on' },
      }
    }
    return { error: 'Use /health on or /health off.' }
  }
  if (name?.toLowerCase() == 'teleport') {
    if (args.length == 1) {
      let level = args[0].toLowerCase()
      if (Object.hasOwn(LEVELS, level)) {
        return { command: { kind: 'teleport', target: { level } } }
      }
      return { error: `Unknown land: ${args[0]}.` }
    }
    if (args.length == 2) {
      let x = metre(args[0]), z = metre(args[1])
      if (x != null && z != null) {
        return { command: { kind: 'teleport', target: { x, z } } }
      }
    }
    return { error: 'Use /teleport <land> or /teleport <x> <z>.' }
  }
  return { error: `Unknown command: /${name || ''}.` }
}
