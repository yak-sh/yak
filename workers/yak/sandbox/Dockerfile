# The builder's workbench image (sandbox.ts, T-34264): the toolchain in
# base/Dockerfile, plus the `yak` CLI so a command in here can reach the
# platform (T-34387). This file is what every push to main builds; the base is
# built once per version of its own file and pulled here (base.ts, T-38057),
# so a build pushes only the layers below.
#
# The FROM tag is base/Dockerfile's hash. Edit that file and this line moves
# with it: sandbox_test.ts names the new tag, and the next deploy builds and
# pushes it before it builds this.
#
# The build context is the repo root, not this directory (wrangler.toml
# `image_build_context`), because the one thing this image COPYs is the CLI
# inside its Deno workspace. The root .dockerignore admits only what that
# needs.
FROM registry.cloudflare.com/0f9613dfd3f0451df0bd0f12a1372ea3/yak-sandbox:base-ee6d899f43d821b1

# The `yak` command (packages/cli): every tool the connector lists, as a
# subcommand, signed in by the $YAKS_TOKEN sandbox.ts puts in the environment.
#
# It is installed from the repo, inside the workspace, because @yaks/cli and
# the sibling @yaks/* packages it imports are resolved by the root deno.json:
# the CLI runs here exactly as it runs in a checkout, at whatever main holds,
# rather than against JSR releases that may predate what it imports.
#
# What arrives is the root deno.json and deno.lock, packages/, and each other
# workspace member's deno.json, since deno refuses a workspace with a member
# missing (.dockerignore at the repo root).
#
# `--root /usr/local` puts the shim on the PATH every command already has.
COPY . /opt/yaks
RUN set -eux; \
    deno install -gf --allow-net --allow-env --allow-read --allow-write \
      --root /usr/local --config /opt/yaks/deno.json \
      /opt/yaks/packages/cli/yak.ts; \
    yak --help > /dev/null
