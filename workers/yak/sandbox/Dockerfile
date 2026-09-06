# The builder's workbench image (sandbox.ts, T-34264): Cloudflare's own
# sandbox container, plus the toolchains a build actually reaches for — Rust,
# Python, Go, Zig, and through `zig cc` a C and C++ path to wasm — plus the
# `yaks` CLI so a command in here can reach the platform (T-34387).
#
# That list is where the image stops, and it stops there on purpose (T-34516).
# Anything rarer is installed for the SESSION instead: a command runs as root,
# so `apt-get install` and a download both work, and the container is thrown
# away when the build ends — what one build adds costs every other build
# nothing. An image is the opposite: it is disk on every build, a per-second
# charge, and it is pulled before the first command of the first one.
#
# Measured unpacked it is about 2.2 GB. Cloudflare caps an image at the disk of
# its instance type, which for the standard-2 in wrangler.toml is 12 GB — so
# there is room, and the room is not unlimited.
#
# THE BUILD CONTEXT IS packages/cli, not this directory (wrangler.toml
# `image_build_context`), because the one thing this image COPYs is that
# package. Everything else it needs it downloads.
#
# The tag MUST match the @cloudflare/sandbox version in package.json: the
# control server inside the container and the client in the Worker are two
# halves of one release, and the SDK warns at startup when they disagree.
#
# Do not add an ENTRYPOINT. The base's is `/container-server/sandbox`, which is
# the control server every tool in sandbox.ts speaks to; overriding it turns
# the container into a box nothing can reach. It already EXPOSEs 3000.
#
# Every version below is pinned and every download is checksummed, because a
# floating toolchain means a build that worked yesterday and does not today,
# and there is no one here to debug it.
FROM docker.io/cloudflare/sandbox:0.12.9

# Rust itself. `--profile minimal` is rustc, cargo and rust-std and none of
# the docs, sources or clippy — the wasm target is the only thing added, since
# that is the only thing anything here compiles for.
ARG RUST_VERSION=1.98.1
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --profile minimal \
      --default-toolchain "${RUST_VERSION}" \
      --target wasm32-unknown-unknown \
 && rustc --version && cargo --version \
 # The toolchain ships every registry index and doc it downloaded; none of it
 # is read again.
 && rm -rf "${CARGO_HOME}/registry" "${RUSTUP_HOME}/downloads"

# wasm-bindgen: what turns a `cdylib` into a .wasm plus the .js that loads it.
# The musl build is one static binary, so it needs nothing of the base's libc.
ARG WASM_BINDGEN_VERSION=0.2.128
ARG WASM_BINDGEN_SHA256=b51f0208fdff83515a787bd8ab9ac5865ed84dabb66d0c709957bb59793c645f
RUN set -eux; \
    name="wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl"; \
    curl -fsSL -o /tmp/wb.tgz \
      "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/${name}.tar.gz"; \
    echo "${WASM_BINDGEN_SHA256}  /tmp/wb.tgz" | sha256sum -c -; \
    tar -xzf /tmp/wb.tgz -C /usr/local/bin --strip-components=1 \
      "${name}/wasm-bindgen"; \
    rm /tmp/wb.tgz; \
    wasm-bindgen --version

# wasm-opt, out of binaryen: the pass that halves a debug .wasm. The release
# tarball is 117 MB of tools we do not run, so exactly one static-pie binary
# comes out of it — 18 MB in the image instead of 400.
ARG BINARYEN_VERSION=132
ARG BINARYEN_SHA256=195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572
RUN set -eux; \
    name="binaryen-version_${BINARYEN_VERSION}"; \
    curl -fsSL -o /tmp/bn.tgz \
      "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/${name}-x86_64-linux.tar.gz"; \
    echo "${BINARYEN_SHA256}  /tmp/bn.tgz" | sha256sum -c -; \
    tar -xzf /tmp/bn.tgz -C /usr/local/bin --strip-components=2 \
      "${name}/bin/wasm-opt"; \
    rm /tmp/bn.tgz; \
    wasm-opt --version

# Python, for the generator, the asset pipeline, the one-off script, and
# everything that is really a pip package. The base is Ubuntu 22.04, whose
# `python3` is 3.10 and which does not even ship one — so this is a
# standalone CPython rather than an apt package: one relocatable tree with pip
# already inside it, and its own `bin` on the PATH so a `pip install`'s console
# scripts land somewhere a later command can call them.
#
# 3.13 and not 3.14 deliberately. A `pip install` that finds no wheel for the
# interpreter falls back to compiling from source, and a build with ten minutes
# of container time cannot afford that; 3.13 is the newest that everything has
# wheels for. `install_only_stripped` is the same interpreter as the full build
# with the debug symbols gone — a third of the download, 103 MB unpacked.
ARG PYTHON_VERSION=3.13.15
ARG PYTHON_BUILD=20260901
ARG PYTHON_SHA256=8a689a077337bea6d1c4bc0b7df1d52fcaa28f5f67e50df8bf417c1e3f9d8874
ENV PATH=/usr/local/python/bin:$PATH
RUN set -eux; \
    name="cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz"; \
    curl -fsSL -o /tmp/py.tgz \
      "https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD}/${name}"; \
    echo "${PYTHON_SHA256}  /tmp/py.tgz" | sha256sum -c -; \
    tar -xzf /tmp/py.tgz -C /usr/local; \
    rm /tmp/py.tgz; \
    python3 -V; pip3 --version

# Go. One tarball, one PATH entry, and `GOOS=js GOARCH=wasm` in it already, so
# a Go program reaches the browser through the `wasm_exec.js` that ships beside
# the toolchain (`$(go env GOROOT)/lib/wasm/wasm_exec.js`).
#
# GOTOOLCHAIN=local is the pin doing its job: from 1.21 on, the `go` command
# DOWNLOADS a different toolchain when a go.mod names a newer one, which is the
# floating toolchain this whole file exists to prevent — and it would do it
# mid-build, on the clock. `test/` and `api/` are the Go project's own
# conformance corpus, read by nothing here.
ARG GO_VERSION=1.27.1
ARG GO_SHA256=63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445
ENV PATH=/usr/local/go/bin:$PATH \
    GOTOOLCHAIN=local
RUN set -eux; \
    curl -fsSL -o /tmp/go.tgz \
      "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"; \
    echo "${GO_SHA256}  /tmp/go.tgz" | sha256sum -c -; \
    tar -xzf /tmp/go.tgz -C /usr/local; \
    rm -rf /tmp/go.tgz /usr/local/go/test /usr/local/go/api; \
    go version

# Zig — and, with it, THE C AND C++ PATH TO WASM. `zig cc` and `zig c++` are
# clang carrying a wasi-libc and a libc++ already built for wasm32, so
#
#   zig cc -target wasm32-freestanding -nostdlib -Wl,--no-entry -o m.wasm m.c
#
# is a module the browser instantiates with no glue at all, and
# `-target wasm32-wasi` is one a WASI shim runs. C++ compiles the same way with
# -fno-exceptions; wasm exception handling is the one thing here that wants
# Emscripten.
#
# It is Zig and not wasi-sdk or Emscripten because, measured unpacked, it is
# the smallest by a wide margin AND it is the only one of the three that is
# also a language worth having: zig 396 MB, wasi-sdk 34 635 MB, the Emscripten
# 6.0.9 toolchain 1.5 GB. Emscripten's extra gigabyte buys JS glue and its own
# exception handling; neither is worth that on every build, and either can be
# installed for the session by a build that wants it.
#
# The tarball is .tar.xz and the base has no `xz` — the CPython above has
# `lzma`, which is one fewer package in the image than xz-utils would be.
ARG ZIG_VERSION=0.16.0
ARG ZIG_SHA256=70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00
ENV PATH=/usr/local/zig:$PATH
RUN set -eux; \
    curl -fsSL -o /tmp/zig.txz \
      "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz"; \
    echo "${ZIG_SHA256}  /tmp/zig.txz" | sha256sum -c -; \
    mkdir -p /usr/local/zig; \
    python3 -c 'import lzma,shutil,sys; shutil.copyfileobj(lzma.LZMAFile(sys.argv[1]), sys.stdout.buffer)' \
      /tmp/zig.txz | tar -x -C /usr/local/zig --strip-components=1; \
    rm /tmp/zig.txz; \
    zig version

# Deno, which is what runs the `yaks` CLI below. A whole runtime is a lot to
# carry, and it earns it by being the runtime the platform itself is written
# in, so a script in the sandbox can be a .ts file rather than a shell heredoc.
# The base image is Ubuntu with `unzip` and `curl` already in it.
ARG DENO_VERSION=2.9.1
ARG DENO_SHA256=710c54d63477d1100844ef4818f19507ce0dbf40510903b1d883f19e394446a2
RUN set -eux; \
    curl -fsSL -o /tmp/deno.zip \
      "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip"; \
    echo "${DENO_SHA256}  /tmp/deno.zip" | sha256sum -c -; \
    unzip -q /tmp/deno.zip -d /usr/local/bin; \
    rm /tmp/deno.zip; \
    deno --version

# The `yaks` command (packages/cli): every tool the connector lists, as a
# subcommand, signed in by the $YAKS_TOKEN sandbox.ts puts in the environment.
#
# It is installed FROM THE REPO because @yaks/cli is not published yet
# (T-34168). Once it is, this whole stanza is one line and the COPY and the
# build context go away:
#
#   RUN deno install -gf --allow-net --allow-env --allow-read --allow-write \
#         --root /usr/local jsr:@yaks/cli/yaks
#
# `--root /usr/local` puts the shim on the PATH every command already has.
COPY . /opt/yaks/cli
RUN set -eux; \
    deno install -gf --allow-net --allow-env --allow-read --allow-write \
      --root /usr/local --config /opt/yaks/cli/deno.json \
      /opt/yaks/cli/yaks.ts; \
    yaks --help > /dev/null
