// Compact, lossless watch changes for the runtime's 2KB socket attachment.
// The map still lives in SQLite when even its compressed changes cannot fit.
import type { Ask } from '@yaks/api'
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'

export type Delta = Record<string, Ask | null>

export let pack = (delta: Delta): string =>
  btoa(
    Array.from(
      deflateSync(strToU8(JSON.stringify(delta)), { level: 1 }),
      (byte) => String.fromCharCode(byte),
    ).join(''),
  )

export let unpack = (delta: Delta | string): Delta =>
  typeof delta == 'string'
    ? JSON.parse(
      strFromU8(
        inflateSync(Uint8Array.from(atob(delta), (char) => char.charCodeAt(0))),
      ),
    )
    : delta
