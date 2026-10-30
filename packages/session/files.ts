// The transcript files each CLI keeps: discovery and the first metadata line.
// Discovery describes sources; the bounded session duty decides when to read.

/** Where Claude keeps its transcripts on this machine. */
export let claudeProjects = (): string | undefined => {
  let env = globalThis.Deno?.env
  let root = env?.get('CLAUDE_CONFIG_DIR') ??
    (env?.get('HOME') ? `${env.get('HOME')}/.claude` : undefined)
  return root && `${root}/projects`
}

/** Where Claude keeps one file per running process, naming its session. */
export let claudeRunning = (): string | undefined => {
  let env = globalThis.Deno?.env
  let root = env?.get('CLAUDE_CONFIG_DIR') ??
    (env?.get('HOME') ? `${env.get('HOME')}/.claude` : undefined)
  return root && `${root}/sessions`
}

/** Where Codex keeps its rollout files. */
export let codexSessions = (): string | undefined => {
  let env = globalThis.Deno?.env
  let root = env?.get('CODEX_HOME') ??
    (env?.get('HOME') ? `${env.get('HOME')}/.codex` : undefined)
  return root && `${root}/sessions`
}

/** What a compressed transcript is at a moment: its size and when it was
 * written. A read that reached its end records this as `transcript.finished`. */
export let versionOf = (file: Deno.FileInfo | undefined): string =>
  file ? `${file.size}:${file.mtime?.getTime() ?? 0}` : ''

/** One transcript on disk: the harness's id for the session, and the file. */
export type Found = {
  id: string
  path: string
  runner?: 'codex'
  /** a subagent's: the harness's id for the session that started it */
  parent?: string
}

/** Every transcript under a Claude projects directory: the sessions', then
 * their subagents'. */
export let transcripts = (dir: string): Found[] => {
  let out: Found[] = []
  let agents: Found[] = []
  let list = (d: string) => {
    try {
      return [...Deno.readDirSync(d)]
    } catch {
      return []
    }
  }
  for (let project of list(dir)) {
    if (!project.isDirectory) continue
    let at = `${dir}/${project.name}`
    for (let f of list(at)) {
      if (f.isFile && f.name.endsWith('.jsonl')) {
        out.push({
          id: f.name.slice(0, -'.jsonl'.length),
          path: `${at}/${f.name}`,
        })
      }
      if (!f.isDirectory) continue
      for (let a of list(`${at}/${f.name}/subagents`)) {
        let id = a.name.match(/^agent-(.+)\.jsonl$/)?.[1]
        if (!a.isFile || !id) continue
        let path = `${at}/${f.name}/subagents/${a.name}`
        agents.push({ id, path, parent: f.name })
      }
    }
  }
  return [...out, ...agents]
}

// Rollouts are dated YYYY/MM/DD, and the filename carries the thread UUID.
// The same bounded look follows both providers; no second duty scans them.
export let rollouts = (dir: string, depth = 0): Found[] => {
  let files: Deno.DirEntry[]
  try {
    files = [...Deno.readDirSync(dir)]
  } catch {
    return []
  }
  let names = new Set(files.map((f) => f.name))
  return files.flatMap((f) => {
    let path = `${dir}/${f.name}`
    if (f.isDirectory && depth < 3 && /^\d+$/.test(f.name)) {
      return rollouts(path, depth + 1)
    }
    let id = f.name.match(
      /^rollout-.+-([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})\.jsonl(?:\.zst)?$/i,
    )?.[1]
    if (!f.isFile || !id) return []
    if (
      f.name.endsWith('.zst') &&
      names.has(f.name.slice(0, -4))
    ) return []
    return [{ id, path, runner: 'codex' as const }]
  })
}

// Only the header is needed to identify a child. Never read its whole log
// merely to open a tail; the importer will read the remaining bytes once.
export let header = (path: string): Record<string, unknown> => {
  let file = Deno.openSync(path)
  try {
    let buf = new Uint8Array(4096), text = '', dec = new TextDecoder()
    for (let n = file.readSync(buf); n; n = file.readSync(buf)) {
      text += dec.decode(buf.subarray(0, n), { stream: true })
      if (text.includes('\n')) {
        try {
          return JSON.parse(text.split('\n')[0]).payload ?? {}
        } catch {
          return {}
        }
      }
      if (text.length > 1024 * 1024) return {}
    }
    return {}
  } finally {
    file.close()
  }
}
