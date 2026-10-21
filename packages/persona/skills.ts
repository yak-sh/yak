// Graph reads and working-tree views. A local view never imports files into
// the graph: uncommitted edits belong to the checkout until its mirror runs.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import { and, contains, eq, every, fields, list, present } from '@yaks/query'
import { locate } from '@yaks/git/host'
import { SKILL } from './comp.ts'
import { parseSkill, renderSkill } from './skill-text.ts'

let component = (b: Bundle, name: string): Comp => {
  let value = b[name]
  return value && typeof value == 'object' && !Array.isArray(value)
    ? value as Comp
    : {}
}

let text = (b: Bundle, name: string, prop: string): string | undefined => {
  let value = component(b, name)[prop]
  return typeof value == 'string' ? value : undefined
}

let folder = (title: string): boolean => /^[a-z0-9][a-z0-9_-]*$/i.test(title)
let pathOf = (title: string): string => `.claude/skills/${title}/SKILL.md`
let primary = (path: string): boolean =>
  /^\.claude\/skills\/[a-z0-9][a-z0-9_-]*\/SKILL\.md$/i.test(path)
let sorted = (skills: Bundle[]): Bundle[] =>
  skills.sort((a, b) =>
    (text(a, 'doc', 'title') ?? '').localeCompare(text(b, 'doc', 'title') ?? '')
  )

let rendered = (b: Bundle): string =>
  renderSkill({ doc: b.doc, skill: b.skill, content: b.content })

let shaped = (b: Bundle): boolean => {
  let title = text(b, 'doc', 'title')
  if (
    b.file || title == undefined || !folder(title) ||
    text(b, 'doc', 'body') == undefined ||
    text(b, 'content', 'body') == undefined
  ) return false
  try {
    rendered(b)
    return true
  } catch (error) {
    // Authored metadata can be incomplete; programming and I/O errors escape.
    if (!(error instanceof Refused)) throw error
    return false
  }
}

/** Resolve referenced SKILL.md entities together. A locator may still name
 * the old folder while a graph rename is waiting to be materialized. */
let skillSites = async (
  g: Graph,
  skills: (Bundle | string)[],
): Promise<{ places: Map<string, Bundle>; links: Map<string, Bundle[]> }> => {
  let locations = new Map<string, Bundle>()
  let links = new Map<string, Bundle[]>()
  let result = { places: locations, links }
  if (
    !g.vocab.comps.includes('references') || !g.vocab.comps.includes('file')
  ) return result
  let ids = skills.map((b) => typeof b == 'string' ? b : b.entity.eid)
  if (!ids.length) return result
  let edges = await g.read(and(
    present('references'),
    eq('edge.from', list(...ids)),
    every(),
  ))
  let targets = new Map<string, Set<string>>()
  let remember = (from: string, b: Bundle) => {
    if (!links.has(from)) links.set(from, [])
    links.get(from)!.push(b)
    let to = text(b, 'edge', 'to')
    if (!to) return
    if (!targets.has(from)) targets.set(from, new Set())
    targets.get(from)!.add(to)
  }
  // A reader may mask the source property after filtering by it. In that
  // case the individual predicate supplies the identity we cannot read.
  if (edges.some((b) => !text(b, 'edge', 'from'))) {
    for (let eid of ids) {
      for (
        let b of await g.read(and(
          present('references'),
          eq('edge.from', eid),
          every(),
        ))
      ) remember(eid, b)
    }
  } else {
    for (let b of edges) remember(text(b, 'edge', 'from')!, b)
  }
  let eids = [...new Set([...targets.values()].flatMap((ids) => [...ids]))]
  let files = eids.length ? await g.get(eids, ['file']) : []
  let index = new Map(
    files.filter((b) => {
      let path = text(b, 'file', 'path')
      return !!text(b, 'file', 'root') &&
        !!path &&
        primary(path)
    }).map((b) => [b.entity.eid, b]),
  )
  for (let eid of ids) {
    let found = [...targets.get(eid) ?? []].map((id) => index.get(id))
      .filter((b): b is Bundle => b != undefined)
    if (found.length > 1) {
      throw new Refused(`Skill ${eid} references more than one SKILL.md`)
    }
    if (found[0]) locations.set(eid, found[0])
  }
  return result
}

export let skillLocations = async (
  g: Graph,
  skills: (Bundle | string)[],
): Promise<Map<string, Bundle>> => (await skillSites(g, skills)).places

export let skillLocation = async (
  g: Graph,
  skill: Bundle | string,
): Promise<Bundle | undefined> =>
  (await skillLocations(g, [skill])).get(
    typeof skill == 'string' ? skill : skill.entity.eid,
  )

let inRepo = async (
  g: Graph,
  skills: Bundle[],
  repository?: string,
): Promise<Bundle[]> => {
  if (repository == undefined) return skills
  if (!['file', 'references'].every((name) => g.vocab.comps.includes(name))) {
    return []
  }
  if (!skills.length) return []
  let edges = await g.read(and(
    present('references'),
    eq('edge.from', list(...skills.map((b) => b.entity.eid))),
    fields('edge.from', 'edge.to'),
  ))
  let targets = edges.map((b) => text(b, 'edge', 'to'))
    .filter((id): id is string => id != undefined)
  let files = targets.length ? await g.get([...new Set(targets)], ['file']) : []
  let locations = new Set(
    files.filter((b) =>
      text(b, 'file', 'root') == repository &&
      primary(
        text(b, 'file', 'path') ?? '',
      )
    ).map((b) => b.entity.eid),
  )
  let linked = new Set(
    edges.filter((b) => locations.has(text(b, 'edge', 'to') ?? '')).map((b) =>
      text(b, 'edge', 'from')
    ),
  )
  return skills.filter((b) => linked.has(b.entity.eid))
}

/** Discover descriptions without reading instruction bodies. */
export let skillCatalog = async (
  g: Graph,
  repository?: string,
): Promise<Bundle[]> => {
  if (!g.vocab.comps.includes(SKILL)) return []
  return sorted(
    await inRepo(
      g,
      (await g.read(and(
        present(SKILL),
        present('doc.title'),
        present('doc.body'),
        present('content.body'),
        fields('entity.eid', 'doc.title', 'doc.body', 'skill.invoke'),
      ))).filter((b) =>
        folder(text(b, 'doc', 'title') ?? '') &&
        !!text(b, 'doc', 'body')?.trim()
      ),
      repository,
    ),
  )
}

/** Exact graph instructions, optionally limited to one repository. */
export let graphSkill = async (
  g: Graph,
  title: string,
  repository?: string,
): Promise<Bundle> => {
  let found = await inRepo(
    g,
    (await g.read(and(
      present(SKILL),
      eq('doc.title', title),
      every(),
    ))).filter(shaped),
    repository,
  )
  if (!found.length) throw new Refused(`No skill named ${title}`)
  if (found.length > 1) {
    throw new Refused(`Skill ${title} belongs to more than one repository`)
  }
  return found[0]
}

/** Complete skills and their locators for one repository. Other repositories
 * supply no bodies; every selected skill still has its full locator checked.
 * Companions include file contents in the same repository read for a mirror. */
export let skillScope = async (
  g: Graph,
  repository: string,
  companions = false,
): Promise<{
  skills: Bundle[]
  places: Map<string, Bundle>
  edges: Bundle[]
  files: Bundle[]
}> => {
  let places = new Map<string, Bundle>()
  if (![SKILL, 'references', 'file'].every((c) => g.vocab.comps.includes(c))) {
    return { skills: [], places, edges: [], files: [] }
  }
  let rows = companions
    ? await g.read(and(
      present('file'),
      eq('file.root', repository),
      contains('file.path', '.claude/skills/'),
      fields('file.path', 'file.root', 'content.body'),
    ))
    : await g.read(and(
      present('references'),
      eq('edge.to.file.root', repository),
      contains('edge.to.file.path', '.claude/skills/'),
      fields('edge.from', 'edge.to', 'edge.to.file.path'),
    ))
  let files = new Set(
    rows.filter((b) => primary(text(b, 'file', 'path') ?? ''))
      .map((b) => b.entity.eid),
  )
  let links = companions
    ? files.size
      ? await g.read(and(
        present('references'),
        eq('edge.to', list(...files)),
        fields('edge.from', 'edge.to'),
      ))
      : []
    : rows.filter((b) => files.has(text(b, 'edge', 'to') ?? ''))
  let ids = new Set(
    links.map((b) => text(b, 'edge', 'from'))
      .filter((id): id is string => id != undefined),
  )
  // A post-read mask may hide the source while leaving its target visible.
  // Use the predicate's identity, as skillLocations does for the same mask.
  if (links.some((b) => !text(b, 'edge', 'from'))) {
    for (let b of await g.read(and(present(SKILL), fields('entity.eid')))) {
      let from = b.entity.eid
      let linked = await g.read(and(
        present('references'),
        eq('edge.from', from),
        eq('edge.to', list(...files)),
        fields('edge.to'),
      ))
      if (linked.some((b) => files.has(text(b, 'edge', 'to') ?? ''))) {
        ids.add(from)
      }
    }
  }
  let skills = ids.size
    ? (await g.read(and(
      present(SKILL),
      eq('entity.eid', list(...ids)),
      every(),
    ))).filter(shaped)
    : []
  let sites = await skillSites(g, skills)
  places = sites.places
  skills = sorted(skills.filter((b) => {
    let location = places.get(b.entity.eid)
    return location && text(location, 'file', 'root') == repository
  }))
  return {
    skills,
    places,
    files: companions ? rows : [],
    edges: skills.flatMap((b) => sites.links.get(b.entity.eid) ?? []),
  }
}

/** Complete graph skills. Unlinked skills are visible without a repository,
 * but cannot be exported or attributed to a repository until linked. */
export let repoSkills = async (
  g: Graph,
  repository?: string,
): Promise<Bundle[]> => {
  if (repository != undefined) return (await skillScope(g, repository)).skills
  if (!g.vocab.comps.includes(SKILL)) return []
  return sorted((await g.read(and(present(SKILL), every()))).filter(shaped))
}

// Paths are portable repository-relative names, not host paths. Reject both
// separators and all dot segments before a mirror ever joins them to a root.
let relative = (path: string): boolean =>
  !path.includes('\\') && [...path].every((char) => {
    let code = char.charCodeAt(0)
    return code >= 32 && code != 127
  }) &&
  !path.includes(':') &&
  path.split('/').every((part) => !!part && part != '.' && part != '..')

/** Render one read's skills and locators together, including pending renames. */
export let renderFiles = (
  skills: Bundle[],
  locations: Map<string, Bundle>,
  supports: Bundle[],
): Map<string, string> => {
  let files = new Map<string, string>()
  let dirs = new Map<string, string>()
  let put = (path: string, body: string): void => {
    if (files.has(path)) {
      throw new Refused(`More than one skill file targets ${path}`)
    }
    files.set(path, body)
  }
  // The locator keeps the old folder until the mirror lands a rename. Move
  // companions with their skill, keeping every suffix beneath that folder.
  for (let skill of skills) {
    let title = text(skill, 'doc', 'title')!
    let to = `.claude/skills/${title}/`
    put(pathOf(title), rendered(skill))
    let location = locations.get(skill.entity.eid)
    let path = location && text(location, 'file', 'path')
    if (path) {
      let from = path.slice(0, -'SKILL.md'.length)
      if (dirs.has(from)) throw new Refused(`More than one skill owns ${from}`)
      dirs.set(from, to)
    }
  }
  // Files already at the destination can coexist with a pending rename only
  // when they do not overwrite another companion. Locator ownership wins
  // when two skills swap names.
  for (let skill of skills) {
    let dir = `.claude/skills/${text(skill, 'doc', 'title')}/`
    if (!dirs.has(dir)) dirs.set(dir, dir)
  }
  if (!skills.length) return files
  for (
    let b of supports.toSorted((a, b) =>
      (text(a, 'file', 'path') ?? '').localeCompare(
        text(b, 'file', 'path') ?? '',
      )
    )
  ) {
    let path = text(b, 'file', 'path')
    let body = text(b, 'content', 'body')
    if (!path || body == undefined || !relative(path)) continue
    for (let [from, to] of dirs) {
      if (!path.startsWith(from)) continue
      put(`${to}${path.slice(from.length)}`, body)
      break
    }
  }
  return files
}

/** The skill documents and text supporting files the graph owns. */
export let skillFiles = async (
  g: Graph,
  repository: string,
): Promise<Map<string, string>> => {
  let { skills, places, files } = await skillScope(g, repository, true)
  return renderFiles(skills, places, files)
}

// Never follow a link in the skill tree. Missing files represent deletions,
// not permission to fall back to the graph's last imported instructions.
let plain = async (path: string, directory: boolean): Promise<boolean> => {
  try {
    let stat = await Deno.lstat(path)
    return !stat.isSymlink && (directory ? stat.isDirectory : stat.isFile)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

let localSkills = async (
  g: Graph,
  root: string,
  graph: Bundle[],
): Promise<Bundle[]> => {
  let dir = `${root}/.claude/skills`
  if (!await plain(`${root}/.claude`, true) || !await plain(dir, true)) {
    return []
  }
  let byPath = new Map<string, Bundle>()
  let locations = await skillLocations(g, graph)
  for (let skill of graph) {
    let location = locations.get(skill.entity.eid)
    let path = location && text(location, 'file', 'path')
    if (path) byPath.set(path, skill)
  }
  let skills: Bundle[] = []
  for await (let entry of Deno.readDir(dir)) {
    if (!entry.isDirectory || entry.isSymlink || !folder(entry.name)) continue
    let path = pathOf(entry.name)
    let local = `${root}/${path}`
    if (
      !await plain(`${dir}/${entry.name}`, true) || !await plain(local, false)
    ) {
      continue
    }
    let source: string
    try {
      source = await Deno.readTextFile(local)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue
      throw error
    }
    let parsed: ReturnType<typeof parseSkill>
    try {
      parsed = parseSkill(source, entry.name)
    } catch (error) {
      if (!(error instanceof Refused)) throw error
      throw new Refused(`Cannot load ${path}: ${String(error)}`)
    }
    let held = byPath.get(path)
    skills.push({
      ...held,
      entity: held?.entity ?? { eid: derivedEid(`view:skill:${root}:${path}`) },
      ...parsed,
    })
  }
  return sorted(skills)
}

/** Without a cwd, read the graph. With one, the checkout's actual directories
 * replace its graph skills, including untracked additions and deletions. */
export let skillsAt = async (g: Graph, cwd?: string): Promise<Bundle[]> => {
  if (cwd == undefined) return repoSkills(g)
  let at = await locate(cwd)
  if (!at) return []
  let repositories = g.vocab.comps.includes('repository')
    ? await g.read(and(eq('repository.common', at.common), every()))
    : []
  // An unregistered checkout still has readable local skills, but neither its
  // repository nor their temporary view identities are written to the graph.
  let repository = repositories[0]?.entity.eid ??
    `view:repository:${at.common}`
  return localSkills(g, at.path, await repoSkills(g, repository))
}

/** Select an exact folder name. Without a checkout, duplicate names across
 * repositories are ambiguous rather than silently choosing one. */
export let loadSkill = async (
  g: Graph,
  title: string,
  cwd?: string,
): Promise<Bundle> => {
  if (cwd == undefined) return graphSkill(g, title)
  let found = (await skillsAt(g, cwd)).filter((b) =>
    text(b, 'doc', 'title') == title
  )
  if (!found.length) throw new Refused(`No skill named ${title}`)
  if (found.length > 1) {
    throw new Refused(
      `Skill ${title} belongs to more than one repository; supply cwd`,
    )
  }
  return found[0]
}

// The portable codec is shared by MCP manifests and repository views.
export { frontmatter, parseSkill, renderSkill } from './skill-text.ts'
