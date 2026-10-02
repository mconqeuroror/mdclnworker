"""Seal only the new addon after its offline CPU proof; preserve the base runtime."""
import fcntl,hashlib,json,os,stat,subprocess,tarfile,time
from pathlib import Path
A=Path('/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211')
R=Path('/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002')
BASE='ubuntu:22.04@sha256:08ea48a03a3e78ebc7cd526e6a275053223aadd88bfc09cc49b06d5281525fde'
EXCLUDED={'BUILDING','READY','CPU_PREFLIGHT_READY.json','ADDON_SHA256SUMS'}

def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  while block:=f.read(4*1024*1024):h.update(block)
 return h.hexdigest()

def main():
 archive=A.parent/(A.name+'.tar.gz');assert not archive.exists()
 assert (A/'BUILDING').read_text()=='modelclone-image-python-addon-20261002-v1\n' and not (A/'READY').exists()
 proof=json.loads(Path('/tmp/image-thin-cpu-proof.json').read_text())
 assert proof['state']=='CPU_PASS_PENDING_SEAL' and proof['interpreterNativeChecksPassed'] and proof['cpuNodeRegistrationPassed'] and proof['modelMetadataUnchanged'] and proof['criticalRuntimeReverified']
 lock=os.open(A.parent/'.cpython-3.12.12-20260211.lock',os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 # Keep verified package hashes, but do not ship a redundant download cache.
 debs=A/'native/debs'
 if debs.exists():
  cache=A.parent/'.cpython-3.12.12-20260211-native-debs';assert not cache.exists();debs.rename(cache)
 aliases=[];files=[];bytecount=0
 for parent,dirs,names in os.walk(A,followlinks=False):
  for name in sorted(dirs+names):
   p=Path(parent)/name;s=p.lstat();rel=str(p.relative_to(A))
   if stat.S_ISLNK(s.st_mode):
    target=os.readlink(p)
    if target.startswith('/') and p.is_relative_to(A/'native/rootfs'):
     target=os.path.relpath(A/'native/rootfs'/target.lstrip('/'),p.parent);p.unlink();p.symlink_to(target)
    elif target.startswith('/') and p.is_relative_to(A/'venv/bin'):
     assert Path(target).is_relative_to(A);target=os.path.relpath(target,p.parent);p.unlink();p.symlink_to(target)
    resolved=p.resolve()
    if rel=='venv/lib/python3.12/site-packages':assert resolved==R/'venv/lib/python3.12/site-packages'
    else:assert resolved.is_relative_to(A),'alias-escape'
    if '.so' in p.name or rel.startswith('venv/bin/python'):assert p.exists(),'broken-native-alias'
    aliases.append({'path':rel,'target':target})
   elif stat.S_ISREG(s.st_mode) and rel not in EXCLUDED:
    files.append(p);bytecount+=s.st_size
   elif not stat.S_ISDIR(s.st_mode) and not (stat.S_ISREG(s.st_mode) and rel in EXCLUDED):raise ValueError('unsupported-addon-entry')
 (A/'ADDON_SYMLINKS.json').write_text(json.dumps(sorted(aliases,key=lambda x:x['path']),sort_keys=True,indent=2)+'\n')
 if A/'ADDON_SYMLINKS.json' not in files:files.append(A/'ADDON_SYMLINKS.json')
 rows=[]
 print(json.dumps({'event':'addon-seal-hashing','files':len(files),'bytes':bytecount}),flush=True)
 for i,p in enumerate(sorted(files)):
  before=p.stat();sha=digest(p);after=p.stat()
  assert (before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns)
  rows.append(f'{sha}  {p.relative_to(A)}\n')
  if i and i%2000==0:print(json.dumps({'event':'addon-seal-progress','filesHashed':i}),flush=True)
 (A/'ADDON_SHA256SUMS').write_text(''.join(rows))
 ready={**proof,'state':'READY','baseImage':BASE,'volumeId':'mevpt9ccol','dataCenterId':'EU-RO-1','archiveSha256':'1dbaa624a09e15afe7efbdac08d42993135a68db8d34f986ef6977a6d77bdc3c','fullManifestSha256':'2d4959e2a5fef58adaddd3eee7d0dedf52be612e76e37c4b2c93fc99641ea35a','criticalManifestSha256':'9dc6c09d9d32349ab7e271641c6dc636441c76390b8dbb697504b4ba58ac1e60','addonManifestSha256':digest(A/'ADDON_SHA256SUMS'),'addonSymlinkManifestSha256':digest(A/'ADDON_SYMLINKS.json'),'launcherSha256':digest(A/'launch_image_thin.sh'),'addonFiles':len(files),'addonRegularBytes':bytecount,'addonSymlinks':len(aliases),'verifiedAtUnix':time.time()}
 (A/'CPU_PREFLIGHT_READY.json').write_text(json.dumps(ready,sort_keys=True,indent=2)+'\n')
 (A/'BUILDING').unlink();(A/'READY').write_text('modelclone-image-python-addon-20261002-v1\n')
 print(json.dumps({'event':'addon-sealed','addonManifestSha256':ready['addonManifestSha256'],'files':len(files),'bytes':bytecount}),flush=True)
 # Archive creation is a separate operator command after the immutable seal.
 os.close(lock)

if __name__=='__main__':main()
