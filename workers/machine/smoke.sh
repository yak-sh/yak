#!/bin/bash
# docker run --rm -i --cpus=1 --memory=2g IMAGE bash -s < workers/machine/smoke.sh
set -euo pipefail

test "$(id -un)" = agent
test "$(id -u)" = 1000
test "$HOME" = /home/agent
test -w "$HOME"
test -w "$BASH_ENV"
test -w /home/agent/workspace/.git
sudo -n true
HTTP_PROXY=http://127.0.0.1:12345 sudo -n env | grep -qx 'HTTP_PROXY=http://127.0.0.1:12345'

deno --version
git --version
gh --version
rg --version
curl --version
jq --version
python3 --version
ssh -V
pgrep --version
google-chrome --version
git -C /home/agent/workspace rev-parse HEAD
test -z "$(git -C /home/agent/workspace status --porcelain)"

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
deno eval 'if (1 + 1 !== 2) throw Error("runtime")'
git init -q "$scratch/repo"
git -C "$scratch/repo" -c user.name=smoke -c user.email=smoke@example.invalid commit --allow-empty -qm smoke
yak --help > "$scratch/help"
grep -q 'yak —' "$scratch/help"
printf '<html><body><h1 id="result">bad</h1><script>document.getElementById("result").textContent="machine-ok"</script></body></html>' > "$scratch/browser.html"
# Docker's default seccomp/user namespaces do not support Chromium's own
# sandbox here. This flag is per probe, NOT baked into the executable/image.
google-chrome --no-sandbox --headless --disable-gpu --dump-dom "file://$scratch/browser.html" > "$scratch/dom"
grep -q '<h1 id="result">machine-ok</h1>' "$scratch/dom"
printf 'PASS: non-root tools, writable checkout, sudo proxy, Deno, yak, browser JavaScript\n'
