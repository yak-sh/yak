// File references are transport input: opted into by the caller, expanded by
// a host-supplied reader, and handed to the runner as ordinary arguments.
import { CallError } from '@yaks/tools/errors'

type Schema = Record<string, unknown>
export type ReadFile = (path: string) => string | Promise<string>

export let FILES =
  'Set "_files":true to read @/absolute/path in string arguments, including nested strings. Omit it for literal @ text.'

export let fileSchema = <S extends Schema>(schema: S, read?: ReadFile): S =>
  read
    ? {
      ...schema,
      properties: {
        ...schema.properties as Schema,
        _files: { type: 'boolean' },
      },
    }
    : schema

let parts = (schema: Schema, root: Schema): Schema[] => {
  let ref = typeof schema.$ref == 'string' && schema.$ref.startsWith('#/')
    ? schema.$ref.slice(2).split('/').reduce<unknown>(
      (node, key) =>
        (node as Schema)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')],
      root,
    )
    : undefined
  return [
    schema,
    ...ref && typeof ref == 'object' ? parts(ref as Schema, root) : [],
    ...['allOf', 'anyOf', 'oneOf'].flatMap((key) =>
      Array.isArray(schema[key])
        ? schema[key].flatMap((s) => parts(s as Schema, root))
        : []
    ),
  ]
}

let expanded = async (
  value: unknown,
  schemas: Schema[],
  root: Schema,
  read: ReadFile,
): Promise<unknown> => {
  let shapes = schemas.flatMap((s) => parts(s, root))
  if (typeof value == 'string') {
    let string = shapes.some((s) =>
      s.type == 'string' || Array.isArray(s.type) && s.type.includes('string')
    )
    if (!string || !value.startsWith('@')) return value
    try {
      return await read(value.slice(1))
    } catch (err) {
      throw new CallError(
        'file',
        `Cannot read ${value}: ${(err as Error).message}`,
      )
    }
  }
  if (Array.isArray(value)) {
    let items = shapes.flatMap((s) =>
      s.items && typeof s.items == 'object' ? [s.items as Schema] : []
    )
    return await Promise.all(value.map((v) => expanded(v, items, root, read)))
  }
  if (value && typeof value == 'object') {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, v]) => {
          let children = shapes.flatMap((s) => {
            let child = (s.properties as Schema)?.[key] ??
              s.additionalProperties
            return child && typeof child == 'object' ? [child as Schema] : []
          })
          return [key, await expanded(v, children, root, read)]
        }),
      ),
    )
  }
  return value
}

export let fileArgs = async (
  args: Record<string, unknown>,
  schema: Schema,
  read?: ReadFile,
): Promise<Record<string, unknown>> => {
  if (!read || !('_files' in args || '$files' in args)) return args
  // Keep calls made from the previously published schema working.
  let { _files, $files, ...input } = args
  let files = _files ?? $files
  if (typeof files != 'boolean') {
    throw new CallError('file', '_files wants true or false')
  }
  return files
    ? await expanded(input, [schema], schema, read) as Record<string, unknown>
    : input
}
