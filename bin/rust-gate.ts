#!/usr/bin/env -S deno run --allow-run --allow-env --allow-read
// rust-gate — the crates/ workspace's fmt + clippy gate (T-22755).
//
// `deno task check` gates only the TS side; the Rust workspace (crates/) had no
// style/lint gate at all — not even a compile check — so drift accumulated
// unguarded as the port grows. This runs `cargo clippy --all-targets` over the
// whole workspace, which compiles every crate AND every test target, so a break
// or a new lint is caught by the same pre-land gate the TS side already uses.
//
// TWO deliberate softenings, each tracked by the reformat follow-up (see below):
//
//  - clippy runs WITHOUT `-D warnings`. The tree carries ~44 pre-existing
//    warnings, most in crates owned by other in-flight work (yak-kernel), so
//    denying warnings today would turn the gate red on code this task must not
//    touch. The gate fails only on a clippy/compile ERROR; warnings are counted
//    and summarized, not spewed, so the fast TS loop stays quiet. The follow-up
//    fixes the warnings and flips on `-D warnings`.
//
//  - `cargo fmt --check` is NOT run yet. The existing crates are HAND-formatted
//    and disagree with stable rustfmt in ~410 spots, inconsistently (some the
//    house breaks where rustfmt joins, some the reverse) — no rustfmt.toml can
//    make `--check` green, only a one-time `cargo fmt` reformat can, and that
//    would collide with live edits. The follow-up runs the reformat once its
//    blockers land, then adds `cargo fmt --all -- --check` here.
//
// GRACEFUL when there is no toolchain: rustup lives under ~/.cargo/bin, which a
// non-login shell (what `deno task` spawns) does not have on PATH, and a
// TS-only contributor or a Rust-less CI may have no cargo at all. So the gate
// finds cargo (PATH, then ~/.cargo/bin), and if there is none it SKIPS with a
// notice rather than failing — a missing toolchain must not turn the TS gate
// red. The clippy component is required once cargo is found.

let home = Deno.env.get('HOME') ?? ''
let cargoBin = home ? `${home}/.cargo/bin` : ''
let root = new URL('../', import.meta.url).pathname // bin/ → repo root
let manifest = `${root}Cargo.toml`

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

// clippy-driver rides in the same dir as cargo; a non-login shell's PATH may not
// have it, so hand the child a PATH that does.
let path = Deno.env.get('PATH') ?? ''
let env: Record<string, string> =
  cargoBin && !path.split(':').includes(cargoBin)
    ? { PATH: `${cargoBin}:${path}` }
    : {}

let { success, stdout, stderr } = await new Deno.Command(cargo, {
  args: ['clippy', '--all-targets', '--manifest-path', manifest],
  env,
  stdout: 'piped',
  stderr: 'piped',
}).output()

let dec = new TextDecoder()
let out = dec.decode(stdout) + dec.decode(stderr)

if (!success) {
  // A compile or clippy error — show everything and fail the gate.
  console.error(out)
  console.error('\nrust-gate: FAILED — cargo clippy reported an error above.')
  Deno.exit(1)
}

// Passed. Count the warnings for a one-line summary instead of spewing them —
// every clippy warning opens `warning: <lint>`, minus the per-crate
// `warning: ... generated N warnings` roll-up lines.
let warnings = (out.match(/^warning: .*/gm) ?? [])
  .filter((l) => !/ generated \d+ warning/.test(l)).length
console.log(
  `rust-gate: clippy passed (${warnings} pre-existing warning(s), not yet gated — see the reformat/tighten follow-up).`,
)
