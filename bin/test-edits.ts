import ts from 'typescript'

// A statement is a declaration (`names`), an import binding names (`binds`),
// or other top-level code.
type Statement = { names?: string[]; binds?: string[]; code: string }

// Each value an import brings into scope: where from, by what name there, and
// what it is called here. Type imports bring none.
let bound = (s: ts.ImportDeclaration, file: ts.SourceFile): Statement[] => {
  let clause = s.importClause!
  let from = [s.moduleSpecifier.getText(file), s.attributes?.getText(file)]
  let named = clause.namedBindings
  let binding = (there: string, here: string) => ({
    binds: [here],
    code: JSON.stringify([...from, there, here]),
  })
  return [
    ...clause.name ? [binding('default', clause.name.text)] : [],
    ...!named
      ? []
      : ts.isNamespaceImport(named)
      ? [binding('*', named.name.text)]
      : named.elements.filter((e) => !e.isTypeOnly).map((e) =>
        binding((e.propertyName ?? e.name).text, e.name.text)
      ),
  ]
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
    // An import for its effect alone is top-level code.
    if (ts.isImportDeclaration(s) && s.importClause) return bound(s, file)
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

// The names an import binds afresh, binds no more, or brings from elsewhere.
let rebound = (was: Statement[], now: Statement[]) => {
  let codes = (all: Statement[]) => new Set(all.map((s) => s.code))
  let a = codes(was), b = codes(now)
  return new Set([
    ...was.filter((s) => !b.has(s.code)),
    ...now.filter((s) => !a.has(s.code)),
  ].flatMap((s) => s.binds ?? []))
}

// Whether code says one of `names`, other than as a property.
let saying = (names: Set<string>) => {
  let words = [...names].map((n) => n.replace(/\$/g, '\\$&'))
  let re = new RegExp(`(?<![\\w$.])(?:${words.join('|')})(?![\\w$])`)
  return (code: string) => words.length > 0 && re.test(code)
}

/** Changed top-level declarations, with `*` for changes to the module's
 * other runtime statements or their order. An edited import changes what
 * says the names it binds: the declarations, or the top-level code. */
export let declarations = (path: string, before: string, after: string) => {
  let all = [statements(path, before), statements(path, after)]
  let [was, now] = all.map((a) => a.filter((s) => !s.binds))
  let [from, to] = all.map((a) => a.filter((s) => s.binds))
  let says = saying(rebound(from, to))
  let opaque = (all: Statement[]) => all.flatMap((s) => s.names ? [] : [s.code])
  let same = (a: unknown, b: unknown) => JSON.stringify(a) == JSON.stringify(b)
  let moved = !same(order(was, now), order(now, was))
  let a = byName(was), b = byName(now)
  let rebinds = [...was, ...now].filter((s) => says(s.code))
  return [
    ...new Set([
      ...moved || !same(opaque(was), opaque(now)) ||
          rebinds.some((s) => !s.names)
        ? ['*']
        : [],
      ...[...new Set([...a.keys(), ...b.keys()])].filter((name) =>
        !same(a.get(name), b.get(name))
      ),
      ...rebinds.flatMap((s) => s.names ?? []),
    ]),
  ]
}
