// Dependency observation at file and module-loading boundaries. FFI calls never
// pass through either boundary, and no permission audit is produced.
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { watchImports } from '@yaks/host/imports'
import { written } from './find.ts'

/// path('file:///r/a%20b.ts', '/r') -> 'a b.ts'
/// path('/r/pkg/', '/r') -> 'pkg'
/// path('x/../y.json', '/r') -> 'y.json'
/// path('/r', '/r') -> '.'
/// path('/elsewhere/y.json', '/r') -> undefined
/// path('/r/.README.md.12.345.example.ts', '/r') -> undefined
/** A path a check names, from `root`; none outside it, or the runner's. */
export let path = (value: string, root: string): string | undefined => {
  let at = resolve(
    root,
    value.startsWith('file:') ? fileURLToPath(value) : value,
  )
  return at == root
    ? '.'
    : at.startsWith(`${root}/`) && !written(basename(at))
    ? at.slice(root.length + 1)
    : undefined
}

/** Observe only reads, retaining one path per file. Restore the runtime's doors
 * after the run; wrappers preserve arguments, receiver, result and exceptions. */
export let observe = (root = Deno.cwd()) => {
  let out = new Map<string, Set<string>>()
  let current: Set<string> | undefined
  let file = ''
  let record = (value: unknown) => {
    if (!current) return
    if (value instanceof URL) value = value.href
    if (typeof value != 'string') return
    let p = path(value, root)
    if (p && p != file) current.add(p)
  }
  let names = [
    'readFile',
    'readFileSync',
    'readTextFile',
    'readTextFileSync',
    'readDir',
    'readDirSync',
    'open',
    'openSync',
    'stat',
    'statSync',
    'lstat',
    'lstatSync',
    'realPath',
    'realPathSync',
    'readLink',
    'readLinkSync',
    'copyFile',
    'copyFileSync',
  ] as const
  let restore = names.map((name) => {
    let original = Deno[name]
    // The overloads differ, but delegation leaves their signatures untouched.
    let door = Deno as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >
    door[name] = function (...args) {
      record(args[0])
      return Reflect.apply(original, this, args)
    }
    return () => {
      door[name] = original as typeof door[string]
    }
  })
  let off = watchImports((specifier) => {
    if (specifier.startsWith('file:')) record(specifier)
  })
  return {
    mark: (name: string) => {
      file = name
      current = out.get(file) ?? new Set()
      out.set(file, current)
    },
    reads: () => new Map([...out].map(([f, paths]) => [f, [...paths].sort()])),
    close: () => {
      off()
      restore.forEach((f) => f())
    },
  }
}
