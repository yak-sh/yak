// Only filesystem effects live here. The image's unchanged bytes are
// regenerable; every changed file and original-file deletion is retained.
export let script = String.raw`
import io, json, os, shutil, stat, sys, tarfile

root = sys.argv[2] if len(sys.argv) > 2 else '/'
held = os.path.join(root, '.yak-recovery')
baseline = os.path.join(held, 'baseline.json')
archive = os.path.join(held, 'snapshot.tar.gz')
ready = os.path.join(held, 'ready')
excluded = {'.yak-recovery', 'proc', 'sys', 'dev'}

def path(name):
    return os.path.join(root, name)

def scan():
    found = {}
    def walk(name):
        try:
            entry = os.lstat(path(name))
        except FileNotFoundError:
            return
        if stat.S_ISSOCK(entry.st_mode):
            return
        found[name] = [entry.st_mode, entry.st_size, entry.st_mtime_ns,
                       entry.st_ctime_ns, entry.st_uid, entry.st_gid]
        if stat.S_ISDIR(entry.st_mode):
            for child in os.listdir(path(name)):
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
        with open(baseline, 'w') as out:
            # A pre-deploy running container has no pristine-image manifest.
            # Keep all its bytes instead of mistaking its files for the image.
            json.dump(scan() if mode == 'fresh' else {}, out)
        print('fresh')
elif mode == 'ready':
    open(ready, 'a').close()
elif mode == 'save':
    with open(baseline) as source:
        before = json.load(source)
    current = scan()
    removed = sorted(set(before) - set(current), key=len, reverse=True)
    with tarfile.open(archive, 'w:gz', dereference=False, compresslevel=1) as out:
        for name, metadata in current.items():
            if before.get(name) != metadata:
                out.add(path(name), arcname=name, recursive=False)
        content = json.dumps(removed).encode()
        entry = tarfile.TarInfo('.yak-recovery/deleted.json')
        entry.size = len(content)
        out.addfile(entry, io.BytesIO(content))
    # An unstable file is not a successful checkpoint: leave the box alive.
    if scan() != current:
        raise RuntimeError('workbench files changed during snapshot; retry')
    print(os.path.getsize(archive))
elif mode == 'restore':
    with tarfile.open(archive, 'r:gz') as source:
        removed = json.load(source.extractfile('.yak-recovery/deleted.json'))
        # Remove only missing image files; unique files live in older retained
        # snapshots. A replacement directory is removed after its children.
        for name in removed:
            target = path(name)
            if os.path.islink(target) or os.path.isfile(target):
                os.unlink(target)
            elif os.path.isdir(target):
                os.rmdir(target)
        for entry in source.getmembers():
            target = path(entry.name)
            if os.path.lexists(target) and not entry.isdir():
                if os.path.isdir(target) and not os.path.islink(target):
                    os.rmdir(target)
                else:
                    os.unlink(target)
            elif entry.isdir() and os.path.lexists(target) and not os.path.isdir(target):
                os.unlink(target)
            source.extract(entry, root, filter='fully_trusted')
elif mode == 'write':
    with open(archive, 'ab' if sys.argv[3] != '0' else 'wb') as out:
        with open(os.path.join(held, 'part'), 'rb') as source:
            shutil.copyfileobj(source, out)
`
