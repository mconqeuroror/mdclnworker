#!/bin/bash
set -euo pipefail
umask 077
ADDON=/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211
test "$(cat "$ADDON/BUILDING")" = modelclone-image-python-addon-20261002-v1
test ! -e "$ADDON/READY"
exec 9>"$ADDON/../.cpython-3.12.12-20260211.lock"
flock -n 9
test ! -e "$ADDON/native"
mkdir -p "$ADDON/native/debs/partial" "$ADDON/native/rootfs"
EMPTY_STATUS=$(mktemp /tmp/modelclone-apt-status.XXXXXX)
trap 'rm -f "$EMPTY_STATUS"' EXIT
test -f "${NATIVE_PACKAGE_LOCK:?Set NATIVE_PACKAGE_LOCK to the checked-in native-packages.lock.json}"
mapfile -t pinned_packages < <(python3 -B - "$NATIVE_PACKAGE_LOCK" <<'PY_LOCK'
import json,re,sys
for row in json.load(open(sys.argv[1])):
    assert re.fullmatch(r'[a-z0-9+.-]+', row['package'])
    assert re.fullmatch(r'[a-zA-Z0-9:+.~-]+', row['version'])
    print(row['package']+'='+row['version'])
PY_LOCK
)
test "${#pinned_packages[@]}" -eq 250
printf '%s\n' '{"event":"native-closure-download-start"}'
# Resolve against an empty package status so SSH bootstrap dependencies cannot
# accidentally satisfy libraries absent from the actual thin GPU base image.
apt-get -o "Dir::State::status=$EMPTY_STATUS" \
  -o "Dir::Cache::archives=$ADDON/native/debs" \
  -o APT::Keep-Downloaded-Packages=true \
  --download-only --reinstall install -y --no-install-recommends \
  "${pinned_packages[@]}" \
  > /tmp/modelclone-image-native-apt.log 2>&1
python3 -B - <<'PY'
import hashlib,json,pathlib,subprocess,os
addon=pathlib.Path('/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211')
expected=json.loads(pathlib.Path(os.environ['NATIVE_PACKAGE_LOCK']).read_text())
records=[]
for deb in sorted((addon/'native/debs').glob('*.deb')):
    fields=subprocess.check_output(['dpkg-deb','-f',str(deb),'Package','Version','Architecture'],text=True)
    info=dict(line.split(': ',1) for line in fields.splitlines())
    skipped=info['Package'] in {'libc6','libc-bin'}
    records.append({'package':info['Package'],'version':info['Version'],'architecture':info['Architecture'],
                    'sha256':hashlib.sha256(deb.read_bytes()).hexdigest(),'bytes':deb.stat().st_size,
                    'providedByPinnedUbuntuBase':skipped})
    if not skipped:
        subprocess.run(['dpkg-deb','-x',str(deb),str(addon/'native/rootfs')],check=True,capture_output=True)
assert sorted(records,key=lambda r:r['package'])==sorted(expected,key=lambda r:r['package']), 'native-package-pin-mismatch'
(addon/'native-packages.lock.json').write_text(json.dumps(records,sort_keys=True,indent=2)+'\n')
print(json.dumps({'event':'native-closure-staged','packages':len(records),'downloadBytes':sum(r['bytes'] for r in records),
                   'excludedBasePackages':[r['package'] for r in records if r['providedByPinnedUbuntuBase']]}),flush=True)
PY
