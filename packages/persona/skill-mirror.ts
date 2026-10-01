// Skills import from the primary checkout. Graph exports are proposals in a
// dedicated linked worktree: no mirror write is allowed to touch main.
import {
  type Bundle,
  type Comp,
  derivedEid,
  type Graph,
  identityEid,
  Refused,
  Stale,
  token,
} from '@yaks/graph'
import { and, eq, every, present } from '@yaks/query'
import { land, LandError, type Run, run } from '@yaks/git/land'
import { repositoryEid } from '@yaks/git/host'
import {
  type Agreed,
  type Binding,
  blobOf,
  plan,
  type Report,
} from '@yaks/mirror'
import { parseSkill, renderSkill } from './skill-text.ts'
import { agreement, exact, prepareTree } from './skill-mirror-io.ts'
import { repoSkills, skillFiles, skillLocation } from './skills.ts'

export type SkillSync = Report & { landed?: string; worktree?: string }
export type SkillSyncOpts = { worktree?: string; run?: Run }

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (b: Bundle | undefined, name: string, prop: string): string =>
  String(comp(b, name)[prop] ?? '')
let fileId = (path: string, repository: string) =>
  identityEid('file', [path, repository])
let linkId = (skill: string, file: string) =>
  derivedEid(`skill-file|${skill}|${file}`)
let skillPath = (title: string) => `.claude/skills/${title}/SKILL.md`
let covered = (path: string) =>
  /^\.claude\/skills\/[a-z0-9][a-z0-9_-]*\/.+/i.test(path) &&
  !/[\\:]/.test(path) &&
  ![...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) == 127) &&
  path.split('/').every((p) => p && p != '.' && p != '..')
let primary = (path: string) =>
  path.split('/').length == 4 && path.endsWith('/SKILL.md')
let titleOf = (path: string) => path.split('/')[2]
let owned: Record<string, string[]> = {
  skill: ['invoke', 'arguments', 'paths', 'fork', 'options'],
  doc: ['title', 'body'],
  content: ['body'],
  file: ['path', 'repository'],
  edge: ['from', 'to'],
  references: [],
}

// State every property we own, including absent values: a concurrent editor
// may add a field as well as replace one. The entire import is one apply.
let guarded = (before: Bundle | undefined, change: Bundle): Bundle => {
  let was: Record<string, Record<string, string | null>> = {}
  for (let name of Object.keys(change)) {
    if (!owned[name]) continue
    was[name] = Object.fromEntries(
      owned[name].map((p) => [p, token(comp(before, name)[p])]),
    )
  }
  return { ...change, $was: was }
}

/** Primary worktrees known to the graph, not linked agent checkouts. */
export let skillRoots = async (g: Graph): Promise<string[]> => {
  let repos = await g.read(and(present('repository'), every()))
  let common = new Map(repos.map((b) => [
    b.entity.eid,
    str(b, 'repository', 'common'),
  ]))
  let trees = await g.read(and(present('worktree'), every()))
  return [
    ...new Set(
      trees.filter((b) =>
        str(b, 'worktree', 'gitdir') ==
          common.get(str(b, 'worktree', 'repository'))
      ).map((b) => str(b, 'worktree', 'path')).filter(Boolean),
    ),
  ].sort()
}

/** Mirror tracked skill text, keeping agreement outside the graph. Expected
 * conflicts and Git refusals are reports. A failed landing retains its linked
 * worktree for inspection and never acknowledges unlanded graph writes. */
let syncRepository = async (
  g: Graph,
  root: string,
  memory: string,
  opts: SkillSyncOpts = {},
): Promise<SkillSync> => {
  let out: SkillSync = {
    read: [],
    wrote: [],
    removed: [],
    conflicts: [],
    failed: [],
  }
  let command = opts.run ?? run
  let git = async (at: string, args: string[]) => {
    let r = await command(args, at)
    if (!r.ok) {
      throw new Refused(r.err || r.out || `git ${args.join(' ')} failed`)
    }
    return r.out
  }
  let fail = (e: unknown) => out.failed.push(String(e))
  let lock: Deno.FsFile | undefined
  try {
    root = await Deno.realPath(root)
    let listing = await git(root, ['worktree', 'list', '--porcelain'])
    let main = listing.split('\n\n')[0]
    let mainRoot = main.split('\n').find((l) => l.startsWith('worktree '))
      ?.slice(9)
    if (mainRoot != root || !main.includes('\nbranch refs/heads/main')) {
      fail('skills: root must be the primary checkout on main')
      return out
    }
    let common = (await git(root, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ])).trim()
    common = await Deno.realPath(common)
    // Keep the inode: unlinking it races with waiters. The kernel releases
    // this advisory lock even when a CLI/effects process crashes.
    lock = await Deno.open(`${common}/skill-mirror.lock`, {
      create: true,
      write: true,
    })
    await lock.lock(true)
    let repository = repositoryEid(common)
    let files = await g.read(and(
      present('file'),
      eq('file.repository', repository),
      every(),
    ))
    let skills = await repoSkills(g, repository)
    let edges = await g.read(and(present('references'), every()))
    let locations = new Map<string, Bundle>()
    for (let skill of skills) {
      let location = await skillLocation(g, skill)
      if (location) locations.set(str(location, 'file', 'path'), skill)
    }
    for (let [old, skill] of locations) {
      let next = skillPath(str(skill, 'doc', 'title'))
      if (next != old && locations.has(next)) {
        throw new Refused(`skills: rename destination is occupied ${next}`)
      }
    }
    let before = new Map([...files, ...skills, ...edges].map((b) => [
      b.entity.eid,
      b,
    ]))
    let values = await skillFiles(g, repository)
    for (let path of values.keys()) {
      if (!covered(path)) throw new Refused(`skills: unsafe path ${path}`)
    }
    let tracked = (await git(root, [
      'ls-files',
      '--stage',
      '-z',
      '--',
      '.claude/skills',
    ])).split('\0').filter(Boolean)
    let raw = new Map<string, string>()
    let blobs = new Map<string, string>()
    for (let entry of tracked) {
      let [metadata, path] = entry.split('\t')
      if (!covered(path)) {
        throw new Refused(`skills: unsafe tracked path ${path}`)
      }
      if (!/^100(644|755) [a-f0-9]+ 0$/.test(metadata)) {
        throw new Refused(
          `skills: non-regular or unmerged tracked file ${path}`,
        )
      }
      let full = `${root}/${path}`
      try {
        // Check every ancestor too; a directory symlink must not escape root.
        let at = root
        for (let part of path.split('/')) {
          at += `/${part}`
          if (Deno.lstatSync(at).isSymlink) {
            throw new Refused(`skills: symlink ${at}`)
          }
        }
        let bytes = Deno.readFileSync(full)
        if (bytes.includes(0)) throw new Refused(`skills: binary file ${path}`)
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch (e) {
          if (!(e instanceof TypeError)) throw e
          throw new Refused(`skills: invalid UTF-8 ${path}`)
        }
        raw.set(path, text)
        blobs.set(full, await blobOf(text))
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e
      }
    }
    // Parsing all tracked documents before mutation avoids half an import.
    for (let [path, text] of raw) {
      if (primary(path)) parseSkill(text, titleOf(path))
      else if (
        !raw.has(skillPath(titleOf(path))) &&
        !skills.some((b) => str(b, 'doc', 'title') == titleOf(path))
      ) {
        throw new Refused(`skills: support file has no skill ${path}`)
      }
    }
    let memoryStore = agreement(memory)
    let agreed = await memoryStore.agreed()
    // A memo belongs to one root. Never let a stale key become a write target.
    for (let path of agreed.keys()) {
      if (
        !path.startsWith(`${root}/`) || !covered(path.slice(root.length + 1))
      ) {
        throw new Refused(`skills: unsafe agreement path ${path}`)
      }
    }
    let absolute = new Map([...values].map(([p, t]) => [`${root}/${p}`, t]))
    let binding: Binding = {
      name: 'skills',
      files: () => Promise.resolve(blobs),
      values: () => Promise.resolve(absolute),
      agreed: () => Promise.resolve(agreed),
      read: () => Promise.resolve(),
    }
    let decisions = await plan(binding)
    out.conflicts = decisions.filter((d) => d.act == 'conflict').map((d) =>
      d.path
    )
    // A pending title rename is one proposal in BOTH directions. No read or
    // same acknowledgement may change one half while another half conflicts.
    let groups = new Map<string, string[]>()
    let blocked = new Set<string>()
    for (let [old, skill] of locations) {
      let next = skillPath(str(skill, 'doc', 'title'))
      if (old == next) continue
      let dirs = [old.slice(0, -8), next.slice(0, -8)]
      let group = decisions.filter((d) =>
        dirs.some((dir) => d.path.startsWith(`${root}/${dir}`))
      )
      groups.set(skill.entity.eid, group.map((d) => d.path))
      if (group.some((d) => d.act == 'conflict')) {
        for (let d of group) blocked.add(d.path)
      }
    }
    let reads = decisions.filter((d) => d.act == 'read' && !blocked.has(d.path))
    let pending = new Map<string, Agreed | null>()
    let changes: Bundle[] = []
    let removedSkills = new Set<string>()
    let renamed = new Set<string>()
    let readPaths = new Set(reads.map((d) => d.path.slice(root.length + 1)))
    for (let d of reads) {
      let path = d.path.slice(root.length + 1)
      let text = raw.get(path)
      let file = files.find((b) => str(b, 'file', 'path') == path)
      let skill = locations.get(path)
      if (text != undefined && primary(path)) {
        let parsed = parseSkill(text, titleOf(path))
        if (!skill) {
          // A file rename can preserve identity when its instructions identify
          // one deleted document unambiguously. Ambiguous matches must wait.
          let candidates = [...locations].filter(([old, b]) =>
            readPaths.has(old) && !raw.has(old) &&
            str(b, 'content', 'body') == parsed.content.body &&
            str(b, 'doc', 'body') == parsed.doc.body
          )
          if (candidates.length > 1) {
            throw new Refused(`skills: ambiguous rename ${path}`)
          }
          skill = candidates[0]?.[1]
          if (skill) renamed.add(skill.entity.eid)
        }
        let eid = skill?.entity.eid ?? crypto.randomUUID()
        changes.push(guarded(skill, { entity: { eid }, ...parsed }))
        let fid = fileId(path, repository)
        changes.push(guarded(file, {
          entity: { eid: fid },
          file: { path, repository },
        }))
        changes.push(guarded(before.get(linkId(eid, fid)), {
          entity: { eid: linkId(eid, fid) },
          edge: { from: eid, to: fid },
          references: {},
        }))
        pending.set(d.path, {
          blob: blobs.get(d.path)!,
          hash: await blobOf(renderSkill(parsed)),
        })
      } else if (text != undefined) {
        changes.push(guarded(file, {
          entity: { eid: fileId(path, repository) },
          file: { path, repository },
          content: { body: text },
        }))
        pending.set(d.path, {
          blob: blobs.get(d.path)!,
          hash: await blobOf(text),
        })
      } else {
        if (file) {
          changes.push(guarded(file, {
            entity: file.entity,
            file: null,
            content: null,
          }))
        }
        if (skill) removedSkills.add(skill.entity.eid)
        for (
          let edge of edges.filter((b) =>
            str(b, 'edge', 'to') == file?.entity.eid
          )
        ) {
          changes.push(
            guarded(edge, {
              entity: edge.entity,
              edge: null,
              references: null,
            }),
          )
        }
        pending.set(d.path, null)
      }
    }
    for (let eid of removedSkills) {
      if (!renamed.has(eid)) {
        changes.push(guarded(before.get(eid), {
          entity: { eid },
          skill: null,
          doc: null,
          content: null,
        }))
      }
    }
    if (changes.length) {
      try {
        await g.apply(changes)
        out.read = reads.map((d) => d.path)
      } catch (e) {
        if (!(e instanceof Refused || e instanceof Stale)) throw e
        out.conflicts.push(e.message)
        return out
      }
    }
    // Imports remember raw bytes and canonical graph text separately. Mirror's
    // generic read callback cannot infer a renderer's normalization.
    for (
      let d of decisions.filter((d) => d.act == 'same' && !blocked.has(d.path))
    ) {
      if (d.sides.file != undefined) {
        pending.set(d.path, { blob: d.sides.file, hash: d.sides.value })
      } else pending.set(d.path, null)
    }
    if (pending.size) await memoryStore.remember!(pending)
    let writes = decisions.filter((d) =>
      d.act == 'write' && !blocked.has(d.path)
    )
    if (!writes.length) return out
    if (
      (await git(root, ['status', '--porcelain=v1', '--untracked-files=all']))
        .trim()
    ) {
      fail('skills: main is dirty; graph exports not staged')
      return out
    }
    let head = (await git(root, ['rev-parse', 'HEAD'])).trim()
    let tree = opts.worktree ?? `${common}/skill-mirror`
    out.worktree = tree
    await prepareTree(root, common, head, tree, git, command)
    // Only planned writes enter the rebased binding. Imports always read main.
    let stagedFiles = new Map<string, string>()
    let stagedValues = new Map<string, string>()
    let stagedAgreed = new Map<string, Agreed>()
    for (let d of writes) {
      let p = `${tree}/${d.path.slice(root.length + 1)}`
      if (d.sides.file) stagedFiles.set(p, d.sides.file)
      if (d.text != undefined) stagedValues.set(p, d.text)
      if (d.sides.agreed) stagedAgreed.set(p, d.sides.agreed)
    }
    let learned = new Map<string, Agreed | null>()
    let result: Report = {
      read: [],
      wrote: [],
      removed: [],
      conflicts: [],
      failed: [],
    }
    let staged = await plan({
      name: 'skills',
      files: () => Promise.resolve(stagedFiles),
      values: () => Promise.resolve(stagedValues),
      agreed: () => Promise.resolve(stagedAgreed),
      read: () => Promise.resolve(),
    })
    for (let d of staged) {
      if (d.act != 'write') {
        if (d.act != 'same') result.conflicts.push(d.path)
        continue
      }
      // Graph-created paths can have a tracked symlink ancestor outside the
      // skill subtree. Never follow it out of the dedicated checkout.
      let target = tree
      for (let part of d.path.slice(tree.length + 1).split('/')) {
        target += `/${part}`
        try {
          if ((await Deno.lstat(target)).isSymlink) {
            throw new Refused(`skills: symlink ${target}`)
          }
        } catch (e) {
          if (!(e instanceof Deno.errors.NotFound)) throw e
          break
        }
      }
      if (d.text == undefined) {
        Deno.removeSync(d.path)
        learned.set(d.path, null)
        result.removed.push(d.path)
      } else {
        let folder = d.path.slice(0, d.path.lastIndexOf('/'))
        Deno.mkdirSync(folder, { recursive: true })
        let tmp = `${d.path}.${crypto.randomUUID()}.tmp`
        Deno.writeTextFileSync(tmp, d.text)
        Deno.renameSync(tmp, d.path)
        learned.set(d.path, { blob: d.sides.value!, hash: d.sides.value })
        result.wrote.push(d.path)
      }
    }
    if (result.conflicts.length) {
      out.conflicts.push(...result.conflicts)
      return out
    }
    await git(tree, ['add', '--all', '--', '.claude/skills'])
    await git(tree, ['commit', '-m', 'Mirror graph skills'])
    let outcome = await land({ cwd: tree, run: command, write: () => {} })
    // These commits contain validated skill text only. A clean rebase does not
    // require TS tests, but must validate the newly combined documents again.
    if ('diverged' in outcome && !outcome.conflict) {
      let paths = (await git(tree, ['ls-files', '-z', '--', '.claude/skills']))
        .split('\0').filter(Boolean)
      for (let path of paths.filter(primary)) {
        parseSkill(await Deno.readTextFile(`${tree}/${path}`), titleOf(path))
      }
      outcome = await land({ cwd: tree, run: command, write: () => {} })
    }
    if (!('landed' in outcome)) {
      out.conflicts.push(
        'skills: main diverged; linked worktree remains unresolved',
      )
      return out
    }
    out.landed = outcome.landed
    // Landing may have rebased onto concurrent edits. Acknowledge only exact
    // landed bytes/absence, excluding an entire rename if any member differs.
    let invalid = new Set<string>()
    let verifying = new Set(
      [...learned.keys()].map((path) =>
        `${root}/${path.slice(tree.length + 1)}`
      ),
    )
    for (let [old, skill] of locations) {
      let next = skillPath(str(skill, 'doc', 'title'))
      if (
        result.removed.includes(`${tree}/${old}`) &&
        result.wrote.includes(`${tree}/${next}`)
      ) {
        for (let path of groups.get(skill.entity.eid) ?? []) verifying.add(path)
      }
    }
    for (let original of verifying) {
      if (!await exact(root, original, absolute.get(original))) {
        invalid.add(original)
        out.conflicts.push(
          `skills: landed export differs from proposal ${original}`,
        )
      }
    }
    for (let paths of groups.values()) {
      if (paths.some((path) => invalid.has(path))) {
        for (let path of paths) invalid.add(path)
      }
    }
    for (let path of invalid) {
      learned.delete(`${tree}/${path.slice(root.length + 1)}`)
    }
    // Rename locator rows only after exact exported bytes were verified.
    let moves: Bundle[] = []
    for (let [old, skill] of locations) {
      let next = skillPath(str(skill, 'doc', 'title'))
      if (
        old == next || groups.get(skill.entity.eid)?.some((p) =>
          invalid.has(p)
        ) ||
        !result.removed.includes(`${tree}/${old}`) ||
        !result.wrote.includes(`${tree}/${next}`)
      ) continue
      moves.push(
        guarded(skill, {
          entity: skill.entity,
          doc: {},
          content: {},
          skill: {},
        }),
      )
      for (
        let file of files.filter((b) =>
          str(b, 'file', 'path').startsWith(old.slice(0, -8))
        )
      ) {
        let path = str(file, 'file', 'path')
        let destination = next.slice(0, -8) + path.slice(old.length - 8)
        let fid = fileId(destination, repository)
        let body = comp(file, 'content').body
        moves.push(
          guarded(file, { entity: file.entity, file: null, content: null }),
        )
        moves.push(guarded(before.get(fid), {
          entity: { eid: fid },
          file: { path: destination, repository },
          ...(body == undefined ? {} : { content: { body } }),
        }))
        if (path == old) {
          for (
            let edge of edges.filter((b) =>
              str(b, 'edge', 'from') == skill.entity.eid &&
              str(b, 'edge', 'to') == file.entity.eid
            )
          ) {
            moves.push(
              guarded(edge, {
                entity: edge.entity,
                edge: null,
                references: null,
              }),
            )
          }
          moves.push(guarded(undefined, {
            entity: { eid: linkId(skill.entity.eid, fid) },
            edge: { from: skill.entity.eid, to: fid },
            references: {},
          }))
        }
      }
    }
    if (moves.length) await g.apply(moves)
    let landed = new Map([...learned].map(([p, a]) => [
      `${root}/${p.slice(tree.length + 1)}`,
      a,
    ]))
    await memoryStore.remember!(landed)
    out.wrote = result.wrote.map((p) => `${root}/${p.slice(tree.length + 1)}`)
    out.removed = result.removed.map((p) =>
      `${root}/${p.slice(tree.length + 1)}`
    )
  } catch (e) {
    if (e instanceof LandError) out.conflicts.push(e.message)
    else if (e instanceof Stale) out.conflicts.push(e.message)
    else if (e instanceof Refused) fail(e)
    else throw e
  } finally {
    lock?.close()
  }
  return out
}

// Advisory locks are process-scoped on some platforms. Serialize callers in
// this process too; the persistent common-dir lock coordinates other processes.
let pending = new Map<string, Promise<unknown>>()
export let syncSkills = async (
  g: Graph,
  root: string,
  memory: string,
  opts: SkillSyncOpts = {},
): Promise<SkillSync> => {
  root = await Deno.realPath(root)
  let before = pending.get(root) ?? Promise.resolve()
  let next = before.catch(() => {}).then(() =>
    syncRepository(g, root, memory, opts)
  )
  pending.set(root, next)
  try {
    return await next
  } finally {
    if (pending.get(root) === next) pending.delete(root)
  }
}
