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
        cache_expires_at: {
          type: 'string',
          format: 'date-time',
          description:
            'the recorded expiry of this request’s cached prefix: request start plus the lifetime its provider row records (`provider{cache_retention}`). Missing means unknown, not warm',
        },
      },
    },
  },
}
export let docs: VocabDoc[] = [claudeDoc]
