// The directory's trash declarations and release start-up work.
import type { VocabDoc } from '@yaks/vocab'
export let docs: VocabDoc[] = [{
  $defs: {
    notify_trash: {
      effect: true,
      created: ['trashed'],
      changed: ['trashed'],
      removed: ['trashed'],
      active: '(.app|.space)',
      // Cover marks written before durable notification was installed. Only
      // the directory reconciles these once on restart; apps never poll.
      sweep: '(.app|.space) .trashed',
      description: 'deliver current app or space dormancy until acknowledged',
    },
  },
}, { reserved: false, $defs: { trash_install: { effect: true, start: true } } }]
