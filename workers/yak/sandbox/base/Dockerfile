# The workbench image: Cloudflare's sandbox control server, language toolchains
# for app builds, and tools for reading and writing common document formats.
# CLI sources are fetched from the live Worker's assets on first yak use.
#
# Provision with ../base.ts after changing this file, then pin its base-<hash>
# registry reference in both ../wrangler.toml container configs before landing.
# Worker deploys only name that prebuilt image; they never build this file.
# Its build context contains only this Dockerfile, and all tools are downloaded.
#
# Less common tools can still be installed for the session: commands run as
# root, and the container is discarded when the build ends or after idle sleep.
# An installed tool adds disk to every container and pull time to its first
# command, so include tools used for common work and measure the added size.
# standard-2 gives the image and working files 12 GB of disk.
#
# The Cloudflare tag must match @cloudflare/sandbox in ../../package.json: the
# control server here and the client in the Worker are halves of one release.
# Keep its ENTRYPOINT, /container-server/sandbox, which serves every sandbox RPC.
# It already exposes port 3000.
#
# Toolchain archives and Python wheels are pinned and checksummed. Apt packages
# come from the base Ubuntu release, with recommendations and caches omitted.
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
#
# The tarball comes from dl.google.com, where go.dev/dl only redirects: go.dev
# itself answered Workers Builds with a 404 twice in one day (T-38057).
ARG GO_VERSION=1.27.1
ARG GO_SHA256=63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445
ENV PATH=/usr/local/go/bin:$PATH \
    GOTOOLCHAIN=local
RUN set -eux; \
    curl -fsSL -o /tmp/go.tgz \
      "https://dl.google.com/go/go${GO_VERSION}.linux-amd64.tar.gz"; \
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

# Documents: read and edit the original attachment, then write an Office file,
# a PDF, a table or an image without fetching a tool on the person's clock.
# Wheels avoid compilers and build dependencies; Pillow supplies image editing.
RUN python3 -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r /dev/stdin <<'REQUIREMENTS'
cffi==2.1.1 --hash=sha256:a931079504ecc49efed7744c476a5c343a92fabf66dec2db95edb1b2fdc770e2
charset-normalizer==3.5.2 --hash=sha256:7218e8f32b0956cfcd048fd42d9d5779809745ca1d86113ca56f66e7ae1549c4
cryptography==50.0.2 --hash=sha256:630ebfea3bf689d075f82316324ff7433dc447fe6bc1bfc76524b74b4a9567d2
et-xmlfile==2.0.0 --hash=sha256:7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa
lxml==6.1.3 --hash=sha256:b477912f42c5c33405a10c759d22f80cf5af043ae02d95b9d8e5e5bc555739ed
numpy==2.5.4 --hash=sha256:6ffa07666f8da0eef81d149934a626d0d95fbd6838432a33e66245423a9062c0
openpyxl==3.1.5 --hash=sha256:5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2
pandas==3.1.1 --hash=sha256:645fa00fd85cfced2d2c09dc116d3694f578501b1ce4899153fbe64788ecda98
pdfminer-six==20260107 --hash=sha256:366585ba97e80dffa8f00cebe303d2f381884d8637af4ce422f1df3ef38111a9
pdfplumber==0.11.10 --hash=sha256:7741ea81bf165b474b153e6789d10d18e06b6ddcf3ec84289c3ef2fed6802580
pillow==13.0.0 --hash=sha256:5f56499c1a74d2b862beb0c33b8016f99d095858455df9d21583bbbc1c15b582
pycparser==3.12 --hash=sha256:a076f3f489b39b43ed13563a1dafe42447445bec2e294154ec5c57fcdda4c85e
pypdf==7.0.0 --hash=sha256:112a2c7cbabefd8dfe498f7a13977e575e762d58cdb0d832acb8886922602c6f
pypdfium2==5.15.1 --hash=sha256:e479df7f9260865554f301889bf1afcdf9aaf5e2ad98c69797a2ebaa1c5e3a3b
python-dateutil==4.0.0 --hash=sha256:a5e246f79eb80475e691bf93862cead98decd8a498cf53ba0516fcdc0f50dc1c
python-docx==1.2.0 --hash=sha256:3fd478f3250fbbbfd3b94fe1e985955737c145627498896a8a6bf81f4baf66c7
python-pptx==1.0.2 --hash=sha256:160838e0b8565a8b1f67947675886e9fea18aa5e795db7ae531606d68e785cba
typing-extensions==4.16.0 --hash=sha256:481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8
tzdata==2026.6 --hash=sha256:0a10eec6e13ef16b627fabed9a5f2ba61a62b1c67f327305f4e7e412a70b4aec
xlsxwriter==3.3.1 --hash=sha256:8e2c89e59d733fe59e112317218c64fbbc276d90a8c144ebd6f7fa15e7ab184a
REQUIREMENTS
RUN python3 -c 'import pypdf, pdfplumber, docx, openpyxl, pptx, pandas, PIL'

# pandoc converts document formats; Poppler extracts text, inspects and renders
# PDF pages. LibreOffice runs headless for Office conversion and PDF output;
# recommended packages are omitted.
# Liberation supplies metrically compatible Office fonts. Keep apt's downloads
# and indexes out of the finished layer.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      pandoc poppler-utils libreoffice-writer libreoffice-calc \
      libreoffice-impress fonts-liberation \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && pandoc --version && pdftotext -v && libreoffice --headless --version
