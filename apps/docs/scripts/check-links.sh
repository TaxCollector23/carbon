#!/usr/bin/env bash
# Statically verify internal links in the docs source. External URLs are
# skipped (network checks in CI are flaky); every relative/absolute link must
# resolve to a real .md/.mdx file under src/content/docs/.
set -uo pipefail

cd "$(dirname "$0")/.."

python3 - <<'PY'
import os, re, sys

root = os.path.realpath(os.path.join('src', 'content', 'docs'))

def resolve(src_dir, target):
    if target.startswith('/'):
        base = os.path.normpath(os.path.join(root, target.lstrip('/')))
    else:
        base = os.path.normpath(os.path.join(src_dir, target))
    for candidate in (
        base + '.mdx',
        base + '.md',
        os.path.join(base, 'index.mdx'),
        os.path.join(base, 'index.md'),
    ):
        if os.path.isfile(candidate):
            return True
    return os.path.isfile(base)

link_re = re.compile(r'\]\(([^)]+)\)')
href_re = re.compile(r'href="([^"]+)"')

broken = []
for dirpath, _dirs, files in os.walk(root):
    for fn in files:
        if not fn.endswith(('.mdx', '.md')):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, encoding='utf-8') as f:
            text = f.read()
        for target in link_re.findall(text) + href_re.findall(text):
            if target.startswith(('http://', 'https://', 'mailto:', '#')):
                continue
            target = target.split('#', 1)[0]
            if not target:
                continue
            if not resolve(dirpath, target):
                broken.append(f'{os.path.relpath(path, root)} -> {target}')

if broken:
    print('check-links: broken links detected', file=sys.stderr)
    for b in sorted(broken):
        print(f'  {b}', file=sys.stderr)
    sys.exit(1)

print('check-links: no broken links')
PY
