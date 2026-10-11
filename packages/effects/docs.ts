// Effect, lease and provisional declarations, independent of their workers.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/**
 * This package's components, to load beside your own when effects should be
 * written down and worked by a pool: `loadVocab([effectDoc, ...mine])`. Three
 * components, one document — `effect`, a run owed, whose every property is
 * server-owned; `lease` (./lease.ts), a duty held by one process at a time;
 * and `provisional` (./provisional.ts), an entity whose step is unfinished.
 */
export let effectDoc: VocabDoc = doc
