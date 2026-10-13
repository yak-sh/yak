// The directory's start-up work that schedules its kill sweep (kills.ts).
import type { VocabDoc } from '@yaks/vocab'
export let docs: VocabDoc[] = [{
  reserved: false,
  $defs: { kills_install: { effect: true, start: true } },
}]
