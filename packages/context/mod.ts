/** Explicit instruction snapshots; storage and session execution are separate. */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
export const contextDoc: VocabDoc = doc
import type { Bundle } from '@yaks/graph'

export let promptEntry = (
  session: string,
  seq: number,
  body: string,
  source: string,
  scope = 'shared',
  revision?: string,
): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  entry: { session, seq },
  prompt: { scope, source, ...revision ? { revision } : {} },
  content: { body },
})

/** Resolver results are text snapshots, not privileged until explicitly admitted. */
export type Snapshot = { body: string; source: string; revision: string }
export type SourceResolver = (source: string) => Promise<Snapshot | undefined>

/** Freeze a source revision without coupling context to a storage backend. */
export let snapshot = async (
  body: string,
  source: string,
): Promise<Snapshot> => {
  let digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(body),
  )
  let revision = Array.from(
    new Uint8Array(digest),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('')
  return { body, source, revision }
}

export { OUTPUT_LIMIT, outputView } from './output.ts'
