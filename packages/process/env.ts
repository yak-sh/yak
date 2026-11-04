// Environment access without loading operating-system or terminal operations.
import process from 'node:process'

export type Env = {
  get: (name: string) => string | undefined
  set: (name: string, value: string) => void
  delete: (name: string) => void
  toObject: () => Record<string, string>
}
export let env: Env = {
  get: (name: string) => process.env[name],
  set: (name: string, value: string) => {
    process.env[name] = value
  },
  delete: (name: string) => {
    delete process.env[name]
  },
  toObject: (): Record<string, string> =>
    Object.fromEntries(
      Object.entries(process.env).filter((row): row is [string, string] =>
        row[1] != null
      ),
    ),
}
