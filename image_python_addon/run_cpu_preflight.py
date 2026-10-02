"""Probe the immutable runtime using an additive interpreter and native closure."""
import hashlib,json,os,signal,stat,subprocess,time,urllib.request
from pathlib import Path

ADDON=Path('/runpod-volume/mdcln-runtime-addons/cpython-3.12.12-20260211')
RUNTIME=Path('/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002')
STATE=Path('/workspace/mdcln-state')

def snapshot(root):
    rows=[]
    for parent,dirs,files in os.walk(root,followlinks=False):
        for name in sorted(dirs+files):
            path=Path(parent)/name; st=path.lstat()
            rows.append([str(path.relative_to(root)),st.st_mode,st.st_size,st.st_mtime_ns,st.st_uid,st.st_gid,os.readlink(path) if stat.S_ISLNK(st.st_mode) else None])
    return hashlib.sha256(json.dumps(sorted(rows),separators=(',',':')).encode()).hexdigest(),len(rows)

def main():
    assert ((ADDON/'BUILDING').exists() and (ADDON/'BUILDING').read_text()=='modelclone-image-python-addon-20261002-v1\n') or (ADDON/'READY').is_file()
    env={k:v for k,v in os.environ.items() if k not in ['PYTHONHOME','PYTHONPATH','VIRTUAL_ENV']}
    libdirs=[str(ADDON/'python/lib')]+[str(x/'native/rootfs'/s) for x in [ADDON,RUNTIME] for s in ['usr/lib/x86_64-linux-gnu','lib/x86_64-linux-gnu','usr/lib','lib','usr/lib/x86_64-linux-gnu/pulseaudio','usr/lib/x86_64-linux-gnu/blas','usr/lib/x86_64-linux-gnu/lapack']]
    env.update(LD_LIBRARY_PATH=':'.join(libdirs),PATH=f'{ADDON}/venv/bin:{ADDON}/native/rootfs/usr/bin:{ADDON}/native/rootfs/bin:'+env['PATH'],GIT_EXEC_PATH=str(ADDON/'native/rootfs/usr/lib/git-core'),GIT_TEMPLATE_DIR=str(ADDON/'native/rootfs/usr/share/git-core/templates'),HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',PIP_NO_INDEX='1',PIP_DISABLE_PIP_VERSION_CHECK='1',PYTHONDONTWRITEBYTECODE='1',HOME=str(STATE/'home'),XDG_CACHE_HOME=str(STATE/'home/.cache'),HF_HOME='/runpod-volume/hf_cache',TORCH_HOME=str(STATE/'home/.cache/torch'),NSFW_COMFY_BYPASS_UPSCALE='1')
    for name in ['input','output','temp','user','kie-config','glif-cache','home']:(STATE/name).mkdir(parents=True,exist_ok=True)
    py=str(ADDON/'venv/bin/python3')
    print(json.dumps({'event':'core-preflight-start'}),flush=True)
    cp=subprocess.run([py,'-B',str(ADDON/'probe_cpu.py')],env=env,capture_output=True,text=True)
    (Path('/tmp')/'image-thin-core.jsonl').write_text(cp.stdout)
    (Path('/tmp')/'image-thin-core.stderr').write_text(cp.stderr)
    last=json.loads(cp.stdout.splitlines()[-1]);assert cp.returncode==0,last.get('failures')
    print(json.dumps({'event':'core-preflight-passed','checks':len(last['results'])}),flush=True)
    before=snapshot(Path('/runpod-volume/models'))
    print(json.dumps({'event':'offline-registration-start','modelMetadataEntries':before[1]}),flush=True)
    start=time.monotonic();proc=None
    log=Path('/tmp/image-thin-registration.log')
    try:
        with log.open('wb') as output:
            proc=subprocess.Popen([py,'-B',str(RUNTIME/'loopback_socket_guard.py'),'main.py','--cpu','--listen','127.0.0.1','--port','18188','--input-directory',str(STATE/'input'),'--output-directory',str(STATE/'output'),'--temp-directory',str(STATE/'temp'),'--user-directory',str(STATE/'user'),'--disable-auto-launch','--disable-metadata'],cwd=RUNTIME/'ComfyUI',env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
        deadline=time.monotonic()+600
        while time.monotonic()<deadline:
            if proc.poll() is not None:raise RuntimeError('comfy-exited-'+str(proc.returncode))
            try:
                with urllib.request.urlopen('http://127.0.0.1:18188/system_stats',timeout=2) as response:assert response.status==200
                break
            except (OSError,AssertionError):time.sleep(1)
        else:raise RuntimeError('registration-timeout')
        result=subprocess.run([py,'-B',str(RUNTIME/'runtime_preflight.py'),'--object-info-url','http://127.0.0.1:18188/object_info'],env=env,capture_output=True,text=True,timeout=30)
        assert result.returncode==0,'required-node-registration-failed'
        print(json.dumps({'event':'required-nodes-registered','elapsedSeconds':round(time.monotonic()-start,2)}),flush=True)
    finally:
        if proc and proc.poll() is None:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=15)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
    after=snapshot(Path('/runpod-volume/models'));assert before==after,'model-tree-metadata-changed'
    subprocess.run(['sha256sum','--check','--status','CRITICAL_SHA256SUMS'],cwd=RUNTIME,check=True,capture_output=True)
    proof={'state':'CPU_PASS_PENDING_SEAL','runtimeId':RUNTIME.name,'addonId':ADDON.name,'interpreterNativeChecksPassed':True,'cpuNodeRegistrationPassed':True,'modelMetadataUnchanged':True,'modelMetadataEntries':before[1],'criticalRuntimeReverified':True,'gpuRenderPassed':False,'registrationSeconds':round(time.monotonic()-start,2),'checks':last['results'],'registrationLogSha256':hashlib.sha256(log.read_bytes()).hexdigest(),'verifiedAtUnix':time.time()}
    (Path('/tmp')/'image-thin-cpu-proof.json').write_text(json.dumps(proof,sort_keys=True,indent=2)+'\n')
    print(json.dumps({k:v for k,v in proof.items() if k!='checks'},sort_keys=True),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'event':'cpu-preflight-failed','class':type(error).__name__,'reason':str(error) if str(error) in ['required-node-registration-failed','registration-timeout','model-tree-metadata-changed'] or str(error).startswith('comfy-exited-') else 'safe-details-in-private-log'}),flush=True)
        raise SystemExit(1)
