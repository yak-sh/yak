// An app store's own words, plugin `yak/app`'s; package words stay in their facets.
import type { VocabDoc } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { noticesDoc } from './notices-vocab.ts'
import { appFriendsWords } from './app-friends.ts'
import exceptionJson from './vocab/exception.vocab.json' with { type: 'json' }
import referencedJson from './vocab/referenced.vocab.json' with { type: 'json' }
import kernelJson from './vocab/kernel.vocab.json' with { type: 'json' }
import appsJson from './vocab/apps.vocab.json' with { type: 'json' }
import builderInstallJson from './vocab/builder-install.vocab.json' with {
  type: 'json',
}
let referencedDoc: VocabDoc = referencedJson as VocabDoc

export let exceptionDoc: VocabDoc = exceptionJson as VocabDoc

export let kernelDoc: VocabDoc = kernelJson as VocabDoc

export let appsDoc: VocabDoc = appsJson as VocabDoc
export let classificationDoc: VocabDoc = {
  ...archetypeDoc,
  $defs: Object.fromEntries(
    Object.entries(archetypeDoc.$defs ?? {}).map((
      [name, definition],
    ) => [name, { ...definition, wire: false }]),
  ),
}
export let docs: VocabDoc[] = [
  appFriendsWords,
  noticesDoc,
  referencedDoc,
  exceptionDoc,
  kernelDoc,
  appsDoc,
  classificationDoc,
  builderInstallJson as VocabDoc,
]
