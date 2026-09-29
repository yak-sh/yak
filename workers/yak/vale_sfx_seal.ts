// The one-time Vale Store snapshot is bound to its app and Store, with its
// complete bytes and row counts checked before the cutover can consume it.

import { sha256 } from './versions.ts'

export let kinds = [
  'builders',
  'builds',
  'outputs',
  'sounds',
  'artifacts',
  'citations',
] as const

export let counts = (data: Record<string, unknown>) =>
  Object.fromEntries(kinds.map((kind) => [
    kind,
    Array.isArray(data[kind]) ? data[kind].length : -1,
  ])) as Record<(typeof kinds)[number], number>

export let seal = async (
  bytes: Uint8Array<ArrayBuffer>,
  app: string,
  store: string,
) => {
  let data = JSON.parse(new TextDecoder().decode(bytes))
  if (data.app != app || data.store != store) {
    throw new Error('Vale snapshot names a different app or Store')
  }
  let rows = counts(data)
  if (Object.values(rows).some((n) => n < 0)) {
    throw new Error('Vale snapshot has missing row sets')
  }
  return { app, store, sha: await sha256(bytes), counts: rows }
}

export let verified = async (
  bytes: Uint8Array<ArrayBuffer>,
  proof: unknown,
  app: string,
  store: string,
) => {
  let expected = await seal(bytes, app, store)
  if (JSON.stringify(expected) != JSON.stringify(proof)) {
    throw new Error('Vale snapshot seal does not match its bytes and rows')
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}
