// The directory's deployment work; commit is declared by @yaks/git.
import type { VocabDoc } from '@yaks/vocab'
export let docs: VocabDoc[] = [{
  reserved: false,
  $defs: {
    git_mint: { effect: true, created: ['deploy'] },
    git_install: { effect: true, start: true },
  },
}]
