// A checkout's skills: its working tree's directories in place of its graph
// skills. A local view never imports files into the graph: uncommitted edits
// belong to the checkout until its mirror runs.
import * as fs from '@yaks/file/io'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import { and, eq, every } from '@yaks/query'
import { locate } from '@yaks/git/host'
import { parseSkill } from './skill-text.ts'
import {
  folder,
  graphSkill,
  pathOf,
  repoSkills,
  skillLocations,
  sorted,
} from './skills.ts'

let text = (b: Bundle, name: string, prop: string): string | undefined => {
  let value = (b[name] as Comp | undefined)?.[prop]
  return typeof value == 'string' ? value : undefined
}

// Never follow a link in the skill tree. Missing files represent deletions,
// not permission to fall back to the graph's last imported instructions.
let plain = async (path: string, directory: boolean): Promise<boolean> => {
  try {
    let stat = await fs.lstat(path)
    return !stat.isSymlink && (directory ? stat.isDirectory : stat.isFile)
  } catch (error) {
    if (fs.isNotFound(error)) return false
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
  for await (let entry of fs.readDir(dir)) {
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
      source = await fs.readTextFile(local)
    } catch (error) {
      if (fs.isNotFound(error)) continue
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
