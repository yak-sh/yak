/** Inbox declarations shared by hosts and browser readers. They carry no I/O. */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The conversation mark and the inbox_new tool declaration. */
export let inboxDoc: VocabDoc = doc as VocabDoc
/** The package description, from its manifest. */
export let description: string = manifest.description
/** Every vocabulary document this package declares. */
export let docs: VocabDoc[] = [inboxDoc]
