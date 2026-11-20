import ts from 'typescript'

type Statement = { names?: string[]; code: string }

let bindings = (named: ts.NamedImportBindings | undefined) => {
  if (!named || ts.isNamespaceImport(named)) return named?.name.text
  let values = named.elements.filter((e) => !e.isTypeOnly)
    .map((e) => [e.propertyName?.text, e.name.text])
  return values.length || !named.elements.length ? values : 'type-only'
}

// Keep the runtime imports in source order. Named type imports can change
// without changing which module loads or the values brought into scope.
let importing = (s: ts.ImportDeclaration, file: ts.SourceFile) => {
  let clause = s.importClause
  return JSON.stringify([
    s.moduleSpecifier.getText(file),
    s.attributes?.getText(file),
    clause?.name?.text,
    bindings(clause?.namedBindings),
  ])
}

let statements = (path: string, text: string): Statement[] => {
  let file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest)
  return file.statements.flatMap((s): Statement[] => {
    if (
      ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) ||
      ts.isImportDeclaration(s) && s.importClause?.isTypeOnly ||
      ts.isExportDeclaration(s) && s.isTypeOnly
    ) return []
    let code = s.getText(file)
    if (ts.isImportDeclaration(s)) return [{ code: importing(s, file) }]
    if (ts.isVariableStatement(s)) {
      let bindings = s.declarationList.declarations.map((d) => d.name)
      if (bindings.every(ts.isIdentifier)) {
        return [{ names: bindings.map((n) => n.text), code }]
      }
    }
    if (
      (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) ||
        ts.isEnumDeclaration(s)) && s.name
    ) return [{ names: [s.name.text], code }]
    return [{ code }]
  })
}

let byName = (statements: Statement[]) => {
  let found = new Map<string, string[]>()
  for (let { names, code } of statements) {
    for (let name of names ?? []) {
      let prior = found.get(name) ?? []
      prior.push(code)
      found.set(name, prior)
    }
  }
  return found
}

let order = (one: Statement[], other: Statement[]) => {
  let key = ({ names, code }: Statement) => JSON.stringify(names ?? code)
  let shared = new Set(other.map(key))
  return one.map(key).filter((k) => shared.has(k))
}

/** Changed top-level declarations, with `*` for changes to the module's
 * other runtime statements or their order. */
export let declarations = (path: string, before: string, after: string) => {
  let was = statements(path, before), now = statements(path, after)
  let opaque = (all: Statement[]) => all.flatMap((s) => s.names ? [] : [s.code])
  let same = (a: unknown, b: unknown) => JSON.stringify(a) == JSON.stringify(b)
  let moved = !same(order(was, now), order(now, was))
  let a = byName(was), b = byName(now)
  return [
    ...moved || !same(opaque(was), opaque(now)) ? ['*'] : [],
    ...[...new Set([...a.keys(), ...b.keys()])].filter((name) =>
      !same(a.get(name), b.get(name))
    ),
  ]
}
