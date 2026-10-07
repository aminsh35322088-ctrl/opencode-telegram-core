import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('cloud_bootstrap',Path(__file__).parents[2]/'worker'/'cloud_bootstrap.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CloudBootstrapTests(unittest.TestCase):
 def test_two_variable_bootstrap_persists_root_only_identity_and_restarts_without_token_reuse(self):
  with tempfile.TemporaryDirectory() as tmp:
   calls=[]
   def transport(endpoint,payload):
    calls.append((endpoint,payload))
    return {'version':1,'identity':{'nodeId':'node','generation':1,'chatId':0,'threadId':0},'secret':'s'*64,'revision':7}
   first=module.resolve_cloud_identity(Path(tmp),'b'*64,'https://control.example','service','project',transport=transport)
   self.assertEqual(first['identity']['nodeId'],'node')
   second=module.resolve_cloud_identity(Path(tmp),'already-consumed','https://control.example','service','project',transport=lambda *_:self.fail('replayed bootstrap'))
   self.assertEqual(second,first)
   self.assertEqual(calls[0][0],'https://control.example/nodes/bootstrap')
   self.assertEqual(set(calls[0][1]),{'bootstrapToken','serviceId','projectId'})
   self.assertEqual(os.stat(Path(tmp)/'node-credentials.json').st_mode&0o777,0o600)
 def test_identity_cannot_move_to_another_service_or_control_plane(self):
  with tempfile.TemporaryDirectory() as tmp:
   response={'version':1,'identity':{'nodeId':'node','generation':1,'chatId':0,'threadId':0},'secret':'s'*64,'revision':1}
   module.resolve_cloud_identity(Path(tmp),'b'*64,'https://control.example','service','project',transport=lambda *_:response)
   for control,service in [('https://other.example','service'),('https://control.example','other')]:
    with self.assertRaises(ValueError):module.resolve_cloud_identity(Path(tmp),'b'*64,control,service,'project')
 def test_invalid_bootstrap_response_never_replaces_previous_identity(self):
  with tempfile.TemporaryDirectory() as tmp:
   with self.assertRaises(ValueError):module.resolve_cloud_identity(Path(tmp),'b'*64,'https://control.example','service','project',transport=lambda *_:{'version':1,'secret':'short','identity':{}})
   self.assertFalse((Path(tmp)/'node-credentials.json').exists())
 def test_symlink_cache_and_non_tls_endpoint_are_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   target=Path(tmp)/'target';target.write_text('{}');(Path(tmp)/'node-credentials.json').symlink_to(target)
   with self.assertRaises(ValueError):module.resolve_cloud_identity(Path(tmp),'b'*64,'https://control.example','service','project')
   with self.assertRaises(ValueError):module.resolve_cloud_identity(Path(tmp),'b'*64,'http://control.example','service','project')

if __name__=='__main__':unittest.main()
