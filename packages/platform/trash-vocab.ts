// The directory's trash declarations.
import type { VocabDoc } from '@yaks/vocab'
export let docs: VocabDoc[] = [{
  $defs: {
    notify_trash: {
      effect: true,
      created: ['trashed'],
      changed: ['trashed'],
      removed: ['trashed'],
      active: '(.app|.space)',
      description: 'deliver current app or space dormancy until acknowledged',
    },
  },
}]
