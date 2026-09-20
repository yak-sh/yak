// The portfolio: what work is filed under, the boards that are saved filters
// over the filing, the ventures being built, and where a project lands.
import type { Plugin } from '@yaks/graph'
import { projectDoc, projects } from '@yaks/project'
import { taskMarks } from '@yaks/session'
import type { Host } from '@yaks/cli/serve'

export let vocab = projectDoc
export let rules = (host: Host): Plugin[] => [
  projects(host.vocab, taskMarks),
]
