// The tool declarations, and nothing else: the module a host imports at
// `@yaks/admin/vocab`. This plugin declares no components; its words are the
// `admin` verbs.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `admin` tools. */
export let adminDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [adminDoc]
