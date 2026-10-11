// The directory's existing commit word and its deployment work.
import { CORE_URI, type VocabDoc } from '@yaks/vocab'
export let gitDirectoryDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'git',
  $defs: {
    commit: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        // The entity's own eid is this value too — it is the object id, which
        // is what makes writing the same commit twice one row. The property is
        // declared anyway because the fleet's `commit` declares it, and one
        // word means one thing in both graphs.
        sha: { type: 'string' },
        repo: { type: 'string' },
        message: { type: 'string' },
        target: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
  },
}
export let docs: VocabDoc[] = [gitDirectoryDoc, {
  reserved: false,
  $defs: {
    git_mint: { effect: true, created: ['deploy'] },
    git_install: { effect: true, start: true },
  },
}]
