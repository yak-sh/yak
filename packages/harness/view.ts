// The harness in a terminal, opened directly by `yak session tui` or as a view
// exported by `@yaks/harness/tui`. A session or an entry answered alone is
// drawn as the whole harness, selected on that session — what
// `yak session new "…" --tui` shows once the session has settled on its reply.
//
// It runs the harness the way the harness always ran in a terminal: the agent
// and the graph in a worker (./remote.ts), drafts in a vault of their own
// (./draft_vault.ts), the app over both (./app.ts). The graph is the one the
// command's config names, composed there as the command composed it. A first
// Ctrl-C waits for the worker to finish what it admitted, a second forces it
// (@yaks/tui `useShutdown`).

import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { Bundle, Comp } from '@yaks/graph'
import type { ComponentRenderer } from '@yaks/preact'
import { parse } from '@yaks/query'
import { define, type Registry } from '@yaks/render'
import { run, useShutdown } from '@yaks/tui'
import { read } from '@yaks/cli/host'
import { App } from './app.ts'
import { openDrafts } from './draft_vault.ts'
import { remote } from './remote.ts'
import { dress } from './sheet.ts'

type Up = {
  backend: Awaited<ReturnType<typeof remote>>
  drafts: Awaited<ReturnType<typeof openDrafts>>
}

let boot = async (
  config: string,
  session: string | undefined,
  progress: (text: string) => void,
): Promise<Up> => {
  let drafts = await openDrafts()
  let backend = await remote({ cwd: Deno.cwd(), config: read(config) }).catch(
    async (error) => {
      await drafts.close()
      throw error
    },
  )
  try {
    progress('resuming unfinished sessions…')
    await backend.resume().catch((error) => {
      throw new Error(
        `resuming unfinished sessions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    })
    if (session) await drafts.ui.patch({ selected: session })
    return { backend, drafts }
  } catch (error) {
    backend.force()
    await drafts.close()
    throw error
  }
}

let Harness = ({ e, config }: { e?: Bundle; config?: string }) => {
  let session = e
    ? String((e.entry as Comp | undefined)?.session ?? e.entity.eid)
    : undefined
  let [up, set] = useState<Up | Error>()
  let [stage, progress] = useState('opening the harness graph…')
  useEffect(() => {
    if (!config) {
      return void set(new Error('a terminal app needs a config to open'))
    }
    let booting = boot(config, session, progress)
    booting.then(set, set)
    return () =>
      void booting.then(({ backend, drafts }) =>
        backend.close().finally(() => drafts.close())
      ).catch(() => {})
  }, [config, session])
  useShutdown(async () => {
    if (!up || up instanceof Error) return
    up.drafts.ui.patch({
      shuttingDown: true,
      error:
        'Shutting down—waiting for active operations; Ctrl+C again to force.',
    })
    await up.backend.close({ timeout: null })
  }, up && !(up instanceof Error) ? up.backend.force : undefined)
  if (up instanceof Error) return h('div', null, `harness: ${up.message}`)
  if (!up) return h('div', null, stage)
  return h(App, {
    agent: up.backend.agent,
    subscribe: up.backend.subscribe,
    frontend: up.drafts.ui,
  })
}

let page = (query: string): ComponentRenderer => ({
  view: 'Page',
  match: parse(query),
  Render: Harness as ComponentRenderer['Render'],
})

/** The views a terminal holds a harness answer with. */
export let views: Registry<ComponentRenderer> = define([
  page('.session'),
  page('.entry'),
])

/** Open the harness without creating or selecting a session. */
export let open = (config: string): Promise<void> =>
  run(() => h(Harness, { config }), { sheet: dress })
