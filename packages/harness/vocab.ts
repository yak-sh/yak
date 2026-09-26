// The harness's words, exported as `@yaks/harness/vocab`: `docs` is what a host
// composing the harness as one plugin among others (@yaks/cli `compose`) takes
// from it — the harness's own components and tools, and nothing another
// package says. Which other packages a harness graph is made of is the `yak`
// config's to say, never a list here.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

const { home, ...core } = doc.$defs
export let workspaceDoc: VocabDoc = { title: 'workspace', $defs: { home } }
export let harnessDoc: VocabDoc = { title: doc.title, $defs: core }

/** The harness's own words: the `home` a session works from, and its tools. */
export let docs: VocabDoc[] = [harnessDoc, workspaceDoc]
