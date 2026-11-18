// A host's module graph is also its capability boundary. Check every import,
// including dependencies whose bodies a scoped type check need not examine.
import type { Info } from './tsconfig.ts'

export type Unavailable = {
  file: string
  specifier: string
  chain: string[]
}

/** Imports the host cannot load, with one shortest entry-to-import chain.
 * A runtime walk checks direct type imports too, without walking code reached
 * only for its types. Browsers need the complete type graph. */
export let unavailable = (
  info: Info,
  roots: string[],
  absent: (specifier: string) => boolean,
  base: string,
  hostOnly = new Set<string>(),
  runtime = false,
): Unavailable[] => {
  let at = (s: string) => info.redirects[s] ?? s
  let modules = new Map(info.modules.map((m) => [m.specifier, m]))
  let parents = new Map(roots.map((r) => [at(new URL(r, base).href), '']))
  let found: Unavailable[] = []
  let chain = (
    s: string,
  ): string[] => [...parents.get(s) ? chain(parents.get(s)!) : [], s]
  for (let file of parents.keys()) {
    for (let d of modules.get(file)?.dependencies ?? []) {
      let targets = [
        ...new Set(
          [d.code?.specifier, d.type?.specifier].flatMap((s) =>
            s ? [at(s)] : []
          ),
        ),
      ]
      let bad = targets.find(absent) ?? (absent(d.specifier) ? d.specifier : '')
      if (bad) {
        found.push({
          file,
          specifier: d.specifier,
          chain: [...chain(file), bad],
        })
        continue
      }
      for (let to of targets) {
        if (runtime && to != (d.code?.specifier && at(d.code.specifier))) {
          continue
        }
        if (d.isDynamic && hostOnly.has(to)) continue
        if (!parents.has(to)) parents.set(to, file)
      }
    }
  }
  return found
}

/** Locate the import in its current source, since cached module graphs remain
 * valid when edits move an unchanged import to another line. */
export let position = async (
  source: string,
  specifier: string,
  name = 'source.ts',
) => {
  let ts = await import('typescript')
  let file = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  let offset = 0
  let visit = (node: import('typescript').Node) => {
    if (ts.isStringLiteralLike(node) && node.text == specifier) {
      let parent = node.parent
      if (
        ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) ||
        ts.isExternalModuleReference(parent) ||
        ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent) ||
        ts.isCallExpression(parent) &&
          (parent.expression.kind == ts.SyntaxKind.ImportKeyword ||
            ts.isIdentifier(parent.expression) &&
              parent.expression.text == 'require')
      ) offset = node.getStart(file) + 1
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  let before = source.slice(0, offset).split('\n')
  return `${before.length},${before.at(-1)!.length + 1}`
}

/** A host failure in the same source-position format as compiler diagnostics. */
export let diagnostic = async (
  found: Unavailable,
  host: string,
  read: (specifier: string) => string,
  base: string,
) => {
  let name = (s: string) =>
    s.startsWith(base) ? decodeURIComponent(s.slice(base.length)) : s
  return `${name(found.file)}(${await position(
    read(found.file),
    found.specifier,
    found.file,
  )}): ` +
    `error TS2307: ${host} cannot import '${found.specifier}'.\n  ` +
    found.chain.map(name).join(' -> ')
}
