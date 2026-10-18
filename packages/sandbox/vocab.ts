// Sandbox declarations shared by servers and browsers; no provisioning runs here.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** Containers, jails and confirmed disposal. */
export let sandboxDoc: VocabDoc = doc as VocabDoc
/** The package description. */
export let description: string = manifest.description
/** Every vocabulary document this package declares. */
export let docs: VocabDoc[] = [sandboxDoc]
