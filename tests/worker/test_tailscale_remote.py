import json,os,sys,tempfile,time,unittest,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[2]/'worker'))
from tailscale_remote import remote_command,remote_result

class RemoteScopeTests(unittest.TestCase):
    def setUp(self):
        self.source=(Path(__file__).parents[2]/'runtime/linux/process-scope.c').read_bytes()
        self.identity=dict(nodeId='worker',chatId=-100,threadId=42,generation=3)
    def test_topic_and_generation_have_distinct_remote_workspaces(self):
        _,scope=remote_command(self.identity,'peer','user','pwd',self.source)
        other={**self.identity,'generation':4}
        self.assertNotEqual(scope,remote_command(other,'peer','user','pwd',self.source)[1])
        other={**self.identity,'threadId':43}
        self.assertNotEqual(scope,remote_command(other,'peer','user','pwd',self.source)[1])
    def test_success_has_confirmed_cleanup_and_initial_topic_cwd(self):
        with tempfile.TemporaryDirectory() as d:
            command,scope=remote_command(self.identity,'peer','user','pwd',self.source)
            proc=subprocess.Popen(['/bin/sh','-c',command],env=dict(os.environ,HOME=d),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            proc.wait(timeout=10);stdout=proc.stdout.read().decode();stderr=proc.stderr.read().decode()
            self.assertEqual(proc.returncode,0,stderr)
            result=remote_result(stdout,scope)
            self.assertEqual(result['stdout'].strip(),str(Path(d)/'.opencode-telegram/ssh-workspaces'/scope))
            for stream in (proc.stdin,proc.stdout,proc.stderr):stream.close()
    def test_connection_eof_retires_detached_descendant(self):
        with tempfile.TemporaryDirectory() as d:
            # The command intentionally escapes its initial shell process group.
            command,scope=remote_command(self.identity,'peer','user',"setsid sh -c 'echo $$ > descendant.pid; sleep 120' & wait",self.source)
            proc=subprocess.Popen(['/bin/sh','-c',command],env=dict(os.environ,HOME=d),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            marker=Path(d)/'.opencode-telegram/ssh-workspaces'/scope/'descendant.pid'
            deadline=time.monotonic()+5
            while not marker.exists():self.assertLess(time.monotonic(),deadline);time.sleep(.02)
            pid=int(marker.read_text());proc.stdin.close();proc.wait(timeout=10)
            reply=json.loads(proc.stdout.read());self.assertTrue(reply['joined']);self.assertTrue(reply['cancelled'])
            with self.assertRaises(ProcessLookupError):os.kill(pid,0)
            proc.stdout.close();proc.stderr.close()
    def test_unproven_or_forged_remote_results_rejected(self):
        with self.assertRaises(ValueError):remote_result('{"scope":"other","joined":true}', 'scope')
