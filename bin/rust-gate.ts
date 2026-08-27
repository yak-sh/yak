#!/usr/bin/env -S deno run --allow-run --allow-env --allow-read
// rust-gate — the crates/ workspace's fmt + clippy gate (T-22755, T-22836).
//
// `deno task check` gates only the TS side; the Rust workspace (crates/) had no
// style/lint gate at all — not even a compile check — so drift accumulated
// unguarded as the port grows. This runs, in order:
//
//   1. `rustfmt --check` over every crate source file against the repo-root
//      rustfmt.toml, so a formatting drift fails the same pre-land gate the TS
//      side already uses. Run `deno task fmt:rust` (or this script with --fix)
//      to reformat in place.
//   2. `cargo clippy --all-targets -- -D warnings`, which compiles every crate
//      AND every test target, so a break, a new lint, or ANY warning is caught.
//
// The two generated files (crates/yak-kernel/src/{schema_gen,vocab_gen}.rs) are
// EXCLUDED from the fmt step: they are emitted verbatim by src/vocab/gen.ts and
// gated byte-exact by `deno task codegen --check`, so their format is owned by
// the generator, not rustfmt. rustfmt reaches a module's children through its
// `mod` declarations, so it would format them via lib.rs anyway — `skip_children`
// stops that descent, and the explicit file list (every crate .rs on disk minus
// the generated pair) is what gets checked instead. `codegen --check` is the
// stronger gate on those two, so nothing goes unchecked.
//
// GRACEFUL when there is no toolchain: rustup lives under ~/.cargo/bin, which a
// non-login shell (what `deno task` spawns) does not have on PATH, and a
// TS-only contributor or a Rust-less CI may have no cargo at all. So the gate
// finds cargo (PATH, then ~/.cargo/bin), and if there is none it SKIPS with a
// notice rather than failing — a missing toolchain must not turn the TS gate
// red. Both steps are required once cargo is found; rustfmt rides beside it.

let home = Deno.env.get('HOME') ?? ''
let cargoBin = home ? `${home}/.cargo/bin` : ''
let root = new URL('../', import.meta.url).pathname // bin/ → repo root
let manifest = `${root}Cargo.toml`
let fix = Deno.args.includes('--fix') // reformat in place instead of --check

// The two files gen.ts owns; rustfmt must not touch them (see header).
let generated = new Set([
  `${root}crates/yak-kernel/src/schema_gen.rs`,
  `${root}crates/yak-kernel/src/vocab_gen.rs`,
])

// Every crate .rs on disk except the generated pair — the fmt file list. A
// filesystem walk (not the module tree) so a new file is checked the moment it
// exists, before any `mod` wires it in.
let rustFiles: string[] = []
let walk = async (dir: string) => {
  for await (let e of Deno.readDir(dir)) {
    let p = `${dir}/${e.name}`
    if (e.isDirectory) {
      if (e.name !== 'target') await walk(p)
    } else if (e.name.endsWith('.rs') && !generated.has(p)) {
      rustFiles.push(p)
    }
  }
}
await walk(`${root}crates`)
rustFiles.sort()

// cargo, from PATH or the rustup default dir; null if the box has no toolchain.
let findCargo = async (): Promise<string | null> => {
  for (let cargo of ['cargo', cargoBin ? `${cargoBin}/cargo` : '']) {
    if (!cargo) continue
    try {
      let { success } = await new Deno.Command(cargo, {
        args: ['--version'],
        stdout: 'null',
        stderr: 'null',
      }).output()
      if (success) return cargo
    } catch {
      // not here — try the next candidate
    }
  }
  return null
}

let cargo = await findCargo()
if (!cargo) {
  console.log(
    'rust-gate: no cargo toolchain found — skipping (install rustup to enable)',
  )
  Deno.exit(0)
}

// clippy-driver and rustfmt ride in the same dir as cargo; a non-login shell's
// PATH may not have it, so hand the child a PATH that does.
let path = Deno.env.get('PATH') ?? ''
let env: Record<string, string> =
  cargoBin && !path.split(':').includes(cargoBin)
    ? { PATH: `${cargoBin}:${path}` }
    : {}

let dec = new TextDecoder()

// --- 1. formatting -----------------------------------------------------------
// `skip_children` keeps rustfmt from descending into the generated modules via
// their `mod` declarations; the explicit list is the whole non-generated tree.
let fmtArgs = ['--edition', '2021', '--config', 'skip_children=true']
if (!fix) fmtArgs.push('--check')
let fmt = await new Deno.Command('rustfmt', {
  args: [...fmtArgs, ...rustFiles],
  env,
  stdout: 'piped',
  stderr: 'piped',
}).output()

if (fix) {
  if (!fmt.success) {
    console.error(dec.decode(fmt.stderr))
    console.error('rust-gate: rustfmt --fix failed.')
    Deno.exit(1)
  }
  console.log(`rust-gate: reformatted ${rustFiles.length} file(s).`)
  Deno.exit(0)
}

if (!fmt.success) {
  console.error(dec.decode(fmt.stdout) + dec.decode(fmt.stderr))
  console.error(
    '\nrust-gate: FAILED — crates are not rustfmt-clean (diff above). ' +
      'Run `deno task fmt:rust` to fix.',
  )
  Deno.exit(1)
}

// --- 2. clippy (compiles every crate + test target; denies all warnings) -----
let clippy = await new Deno.Command(cargo, {
  args: [
    'clippy',
    '--all-targets',
    '--manifest-path',
    manifest,
    '--',
    '-D',
    'warnings',
  ],
  env,
  stdout: 'piped',
  stderr: 'piped',
}).output()

let out = dec.decode(clippy.stdout) + dec.decode(clippy.stderr)
if (!clippy.success) {
  console.error(out)
  console.error(
    '\nrust-gate: FAILED — cargo clippy reported an error or warning above.',
  )
  Deno.exit(1)
}

console.log(
  `rust-gate: rustfmt (${rustFiles.length} files) + clippy (-D warnings) passed.`,
)
