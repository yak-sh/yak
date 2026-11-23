// `curl -fsSL https://yak.sh/install | sh`: one line from a bare laptop to
// `yak` on its PATH. yak runs on Deno, so the script installs Deno first, with
// Deno's own installer, when the machine has none; then it runs yak's own
// installer from jsr.io (@yaks/cli/install), which puts `yak` on the PATH at
// one release with every package it loads. It reads no login and asks for
// nothing: signing in to yaks.app is the next command, `yak auth yaks.app`.

/** The address the install line fetches. */
export const INSTALLER = 'https://yak.sh/install'

/** The script `INSTALLER` answers with. POSIX sh, so `| sh` runs it on macOS
 * and Linux alike. */
export const SCRIPT = `#!/bin/sh
# yak's installer: curl -fsSL ${INSTALLER} | sh
#
# yak runs on Deno (https://deno.com). Where this machine has no Deno, this
# installs it with Deno's own installer, which also adds it to your shell's
# PATH. Then it installs yak from jsr.io with yak's own installer.
set -eu

deno=$(command -v deno || true)
if [ -z "$deno" ]; then
  deno="\${DENO_INSTALL:-$HOME/.deno}/bin/deno"
  if [ ! -x "$deno" ]; then
    echo "yak runs on Deno, which this machine does not have yet. Installing it first."
    curl -fsSL https://deno.land/install.sh | sh -s -- -y
  fi
fi

if ! "$deno" eval 'let [a, b] = Deno.version.deno.split(".").map(Number); Deno.exit(a > 2 || (a == 2 && b >= 9) ? 0 : 1)'; then
  echo "yak needs Deno 2.9 or later, and $deno is $("$deno" --version | head -n 1). Update it with: $deno upgrade" >&2
  exit 1
fi

"$deno" run -A jsr:@yaks/cli/install

if ! command -v yak >/dev/null 2>&1; then
  echo "yak is not on this terminal's PATH yet: open a new one, or run"
  echo "  export PATH=\\"$(dirname "$deno"):\\$PATH\\""
fi
`
