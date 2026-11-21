// Only filesystem effects live here. The image's unchanged bytes are
// regenerable; every changed file and original-file deletion is retained.
export let script = String.raw`
import io, json, os, stat, subprocess, sys, tarfile, time

root = sys.argv[2] if len(sys.argv) > 2 else '/'
held = os.path.join(root, '.yak-recovery')
baseline = os.path.join(held, 'baseline.json')
archive = os.path.join(held, 'snapshot.tar.gz')
ready = os.path.join(held, 'ready')
excluded = {'.yak-recovery', 'proc', 'sys', 'dev'}
# Kernel views, wherever they are mounted (a runtime may mount procfs under
# /run), hold no workbench bytes and refuse some reads with EINVAL.
virtual = {'proc', 'sysfs', 'devtmpfs', 'devpts', 'cgroup', 'cgroup2',
           'mqueue', 'debugfs', 'tracefs', 'securityfs', 'pstore', 'bpf',
           'configfs', 'fusectl', 'binfmt_misc', 'hugetlbfs', 'autofs',
           'nsfs', 'rpc_pipefs'}

def mounts():
    try:
        with open('/proc/mounts') as source:
            lines = source.read().splitlines()
    except OSError:
        return set()
    found = set()
    for line in lines:
        fields = line.split()
        if len(fields) > 2 and fields[2] in virtual:
            point = fields[1].encode().decode('unicode_escape')
            found.add(os.path.normpath(point))
    return found

def path(name):
    return os.path.join(root, name)

def scan():
    found = {}
    skipped = mounts()
    def walk(name):
        if os.path.normpath(path(name)) in skipped:
            return
        try:
            entry = os.lstat(path(name))
        except OSError:
            return
        if stat.S_ISSOCK(entry.st_mode):
            return
        if stat.S_ISDIR(entry.st_mode):
            try:
                children = os.listdir(path(name))
            except OSError:
                return
        found[name] = [entry.st_mode, entry.st_size, entry.st_mtime_ns,
                       entry.st_ctime_ns, entry.st_uid, entry.st_gid]
        if stat.S_ISDIR(entry.st_mode):
            for child in children:
                walk(os.path.join(name, child))
    for name in os.listdir(root):
        if name not in excluded:
            walk(name)
    return found

os.makedirs(held, exist_ok=True)
mode = sys.argv[1]
if mode in ('fresh', 'existing'):
    if os.path.exists(baseline):
        print('existing' if os.path.exists(ready) else 'fresh')
    else:
        # A pre-deploy running container has no pristine-image manifest.
        # Keep all its bytes instead of mistaking its files for the image.
        # Written whole or not at all, so a failed scan leaves no baseline.
        with open(baseline + '.part', 'w') as out:
            json.dump(scan() if mode == 'fresh' else {}, out)
        os.replace(baseline + '.part', baseline)
        print('fresh')
elif mode == 'ready':
    open(ready, 'a').close()
elif mode == 'save':
    # A baseline left empty by an interrupted write (before it was written
    # whole) names no image files: keep every byte.
    try:
        with open(baseline) as source:
            before = json.load(source)
    except ValueError:
        before = {}
    current = scan()
    removed = sorted(set(before) - set(current), key=len, reverse=True)
    with tarfile.open(archive, 'w:gz', dereference=False, compresslevel=1) as out:
        content = json.dumps(removed).encode()
        entry = tarfile.TarInfo('.yak-recovery/deleted.json')
        entry.size = len(content)
        out.addfile(entry, io.BytesIO(content))
        for name, metadata in current.items():
            if before.get(name) != metadata:
                out.add(path(name), arcname=name, recursive=False)
    # An unstable file is not a successful checkpoint: leave the box alive.
    if scan() != current:
        raise RuntimeError('workbench files changed during snapshot; retry')
    print(os.path.getsize(archive))
elif mode == 'restore':
    started = time.monotonic()
    if len(sys.argv) > 3:
        partial = archive + '.part'
        try:
            subprocess.run(['curl', '--fail', '--silent', '--show-error',
                            '--noproxy', '*', '--output', partial, sys.argv[3]],
                           check=True)
            if os.path.getsize(partial) != int(sys.argv[4]):
                raise RuntimeError('workbench snapshot is incomplete')
            os.replace(partial, archive)
        finally:
            if os.path.exists(partial):
                os.unlink(partial)
    downloaded = time.monotonic()
    deleted = '.yak-recovery/deleted.json'
    def remove(source, entry):
        removed = json.load(source.extractfile(entry))
        # The archive lists deleted image entries children first.
        for name in removed:
            target = path(name)
            if os.path.islink(target) or os.path.isfile(target):
                os.unlink(target)
            elif os.path.isdir(target):
                os.rmdir(target)
    def extract(source, entries):
        for entry in entries:
            if entry.name == deleted:
                continue
            target = path(entry.name)
            if os.path.islink(target):
                os.unlink(target)
            elif os.path.lexists(target) and not entry.isdir():
                if os.path.isdir(target):
                    os.rmdir(target)
                else:
                    os.unlink(target)
            elif entry.isdir() and os.path.lexists(target) and not os.path.isdir(target):
                os.unlink(target)
            source.extract(entry, root, filter='fully_trusted')
    with tarfile.open(archive, 'r|gz') as source:
        first = source.next()
        if first and first.name == deleted:
            remove(source, first)
            extract(source, iter(source))
        else:
            # Older archives wrote their deletion list last.
            with tarfile.open(archive, 'r:gz') as old:
                remove(old, old.getmember(deleted))
            extract(source, iter(source))
    print(json.dumps({'downloadMs': round(1000 * (downloaded - started)),
                      'extractMs': round(1000 * (time.monotonic() - downloaded))}))
`
