import type { VocabDoc } from '@yaks/vocab'
export let claudeDoc: VocabDoc = {
  title: 'Claude Code',
  $defs: {
    claude: {
      component: true,
      description:
        'Claude Code one-turn identifiers; not resumable graph anchors.',
      properties: {
        response_id: { type: 'string' },
        session_id: { type: 'string' },
      },
    },
  },
}
export let docs: VocabDoc[] = [claudeDoc]
