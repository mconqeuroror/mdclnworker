"""Archive safety and pinned interpreter provisioning boundaries."""
import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest

HERE=Path(__file__).resolve().parents[1]/'image_python_addon'
spec=importlib.util.spec_from_file_location('stage_addon',HERE/'stage_python_addon.py')
stage=importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)

class PythonArchiveFilterTests(unittest.TestCase):
    def test_valid_member_relative_python_alias(self):
        info=tarfile.TarInfo('python/share/terminfo/1/1178')
        info.type=tarfile.SYMTYPE
        info.linkname='../a/adm1178'
        with tempfile.TemporaryDirectory() as target:
            result=stage.safe_filter(info,target)
        self.assertTrue(result.issym())
        self.assertEqual(result.linkname,'../a/adm1178')

    def test_absolute_and_escaping_aliases_are_refused(self):
        for target in ['/etc/passwd','../../../../../escape']:
            with self.subTest(target=target),tempfile.TemporaryDirectory() as output:
                info=tarfile.TarInfo('python/lib/alias')
                info.type=tarfile.SYMTYPE
                info.linkname=target
                with self.assertRaises((AssertionError,tarfile.FilterError)):
                    stage.safe_filter(info,output)


class SealedTlsGuardTests(unittest.TestCase):
    def test_verified_bundle_enables_validated_tls_in_child(self):
        import hashlib,http.server,os,shlex,ssl,subprocess,threading
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);cert=root/'ca.pem';key=root/'key.pem'
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',str(key),'-out',str(cert)],check=True,capture_output=True)
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):self.send_response(200);self.end_headers();self.wfile.write(b'ok')
                def log_message(self,*args):pass
            server=http.server.HTTPServer(('127.0.0.1',0),Handler)
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key)
            server.socket=context.wrap_socket(server.socket,server_side=True)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                script=(HERE/'sealed_tls_guard.sh').read_text().replace('/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002/venv/lib/python3.12/site-packages/certifi/cacert.pem',str(cert)).replace('9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f',hashlib.sha256(cert.read_bytes()).hexdigest())
                probe=f"import ssl,urllib.request; assert ssl.create_default_context().verify_mode == ssl.CERT_REQUIRED; assert urllib.request.urlopen('https://localhost:{server.server_port}/',timeout=3).read()==b'ok'"
                env={k:v for k,v in os.environ.items() if k not in ['SSL_CERT_FILE','SSL_CERT_DIR','PYTHONDONTWRITEBYTECODE']}
                env['SSL_CERT_DIR']=str(root/'missing')
                failed=subprocess.run(['python3','-B','-c',probe],env=env,capture_output=True)
                self.assertNotEqual(failed.returncode,0)
                self.assertIn(b'CERTIFICATE_VERIFY_FAILED',failed.stderr)
                passed=subprocess.run(['bash','-c',script+'\npython3 -B -c '+shlex.quote(probe)],env=env,capture_output=True)
                self.assertEqual(passed.returncode,0,passed.stderr.decode())
            finally:server.shutdown();server.server_close();thread.join(timeout=3)

    def test_corrupted_or_missing_bundle_stops_before_child(self):
        import hashlib,subprocess
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);cert=root/'ca.pem';cert.write_bytes(b'expected bundle')
            script=(HERE/'sealed_tls_guard.sh').read_text().replace('/runpod-volume/mdcln-runtime/mdcln-v0172-torch28-v2-20261002/venv/lib/python3.12/site-packages/certifi/cacert.pem',str(cert)).replace('9cc2a774b5198dcff14d9be1e66091f538975d867ce029a96bce15a55dfd730f',hashlib.sha256(cert.read_bytes()).hexdigest())
            marker=root/'child-ran'
            for state in ['corrupt','missing']:
                if state=='corrupt':cert.write_bytes(b'changed bundle')
                else:cert.unlink()
                result=subprocess.run(['bash','-c',script+'\ntouch '+str(marker)],capture_output=True)
                self.assertNotEqual(result.returncode,0)
                self.assertFalse(marker.exists())

if __name__=='__main__':unittest.main()
