/** Inbox navigation to populated threads on a private host that offers Inbox.
 * The probe owns its graph, ephemeral HTTP port and cold/warm Chrome profiles;
 * no live host or owner rows participate. Missing views/content fail closed.
 */
import type { CollectedSuite, Samples } from '@yaks/benchmark'
import { type Page } from './pages.ts'

export let COUNT = 100
export let PERSON = '1d55ab2c-76da-4b66-9c37-e871a427f200'
export let PROJECT = '1d55ab2c-76da-4b66-9c37-e871a427f201'
export let HISTORY =
  'Historical Inbox benchmark content, fetched only by opening a thread.'

/** The real Inbox frame, all fixture thread titles and loaded newest content
 * must coexist. A Show fallback, count, heading or loading shell cannot pass.
 */
export let inboxPages = (): Page[] => {
  let loaded = (kind: string) =>
    `(() => {
    let frame = document.querySelector('.Shell_Body .Inbox');
    if (!frame || frame.querySelector('[role=status]')) return false;
    let rows = Array.from(frame.querySelectorAll('[data-thread]'));
    return rows.length == ${COUNT} && rows.every(row =>
      row.textContent.includes(${JSON.stringify(kind + ' Inbox thread ')})${
      kind == 'Person'
        ? ` && row.textContent.includes('Newest Inbox reply')`
        : ''
    });
  })()`
  return [{
    name: 'person-inbox',
    path: `/%23${PERSON.replaceAll('-', '')}?v=Inbox`,
    painted: loaded('Person'),
  }, {
    name: 'project-inbox',
    path: `/%23${PROJECT.replaceAll('-', '')}?v=Inbox`,
    painted: loaded('Project'),
  }, {
    name: 'person-thread',
    path: `/%23${PERSON.replaceAll('-', '')}?v=Inbox`,
    painted: `(() => {
      if (!(${loaded('Person')})) return false;
      let row = document.querySelector('.Shell_Body .Inbox [data-thread]');
      let button = row.querySelector('button[aria-expanded]');
      if (!button) return false;
      if (button.getAttribute('aria-expanded') == 'false') button.click();
      return !!row.querySelector('.Inbox_Detail')?.textContent.includes(${
      JSON.stringify(HISTORY)
    });
    })()`,
  }]
}

export let suite = (
  args: string[] = [],
  root = new URL('../', import.meta.url).pathname,
): CollectedSuite => {
  if (args.length) {
    throw new Error('inbox-content uses only its fixed isolated fixture')
  }
  return {
    name: 'inbox-content',
    metric: 'median-of-round-medians',
    workload:
      `v1/isolated-starter-inbox/${COUNT}-person/${COUNT}-project/threads-and-open-history`,
    benches: inboxPages().flatMap((p) =>
      ['cold', 'warm'].map((mode) => ({
        name: `${p.name}/${mode}`,
        unit: 'ms',
        resolution: 1,
      }))
    ),
    collect: async () => {
      let child = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          `${root}/bench/inbox-content-probe.ts`,
        ],
        cwd: root,
        stdout: 'piped',
        stderr: 'inherit',
      }).output()
      if (!child.success) throw new Error(`Inbox probe failed (${child.code})`)
      let line = new TextDecoder().decode(child.stdout).split('\n')
        .findLast((line) => line.startsWith('INBOX_CONTENT_RESULT='))
      if (!line) throw new Error('Inbox probe returned no measurements')
      return JSON.parse(line.slice('INBOX_CONTENT_RESULT='.length)) as Record<
        string,
        Samples
      >
    },
  }
}
