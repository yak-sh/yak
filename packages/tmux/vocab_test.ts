import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { docs, TMUX, tmuxDoc } from './vocab.ts'

Deno.test('a terminal says what is showing and where tmux finds it', () => {
  let vocab = loadVocab([
    {
      title: 'spine',
      $defs: {
        entity: { component: true, type: 'object', properties: {} },
      },
    },
    tmuxDoc,
  ])
  assertEquals(vocab.comp(TMUX)?.name, TMUX)
  assertEquals(vocab.columns(TMUX).sort(), ['of', 'pane'])
  // A pane OUTLIVES what ran in it: the window is still open.
  assertEquals(vocab.column(TMUX, 'of')?.death, 'keep')
  assertEquals(vocab.column(TMUX, 'of')?.ref, 'entity')
  assertEquals(docs, [tmuxDoc])
})
