// The directory's start-up work that keeps every app worker's wrapper
// current (rewrap.ts).
import type { VocabDoc } from '@yaks/vocab'
export let docs: VocabDoc[] = [{
  reserved: false,
  $defs: { wrap_install: { effect: true, start: true } },
}]
