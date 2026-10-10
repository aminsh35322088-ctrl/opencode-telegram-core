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

 def _ledger(self, root, identity, secret, retired=True, extra=None):
  import hashlib,sqlite3
  root=Path(root);root.mkdir(parents=True,exist_ok=True)
  with sqlite3.connect(root/'agent.sqlite') as db:
   db.execute('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
   db.execute('DELETE FROM state')
   for key,value in [('identity',identity),('secretFingerprint',hashlib.sha256(secret.encode()).hexdigest()),('retired',retired)]:
    db.execute('INSERT INTO state VALUES (?,?)',(key,json.dumps(value)))
   if extra is not None:db.execute('INSERT INTO state VALUES (?,?)',('session',json.dumps(extra)))

 def test_valid_new_bootstrap_token_rotates_retired_unbound_cache_to_bound_generation(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);old={'nodeId':'node','generation':1,'chatId':0,'threadId':0};new={'nodeId':'node','generation':2,'chatId':-100,'threadId':42}
   module.resolve_cloud_identity(root,'b'*64,'https://control.example','service','project',transport=lambda *_:{'version':1,'identity':old,'secret':'s'*64,'revision':1})
   self._ledger(root,old,'s'*64,True)
   calls=[]
   rotated=module.resolve_cloud_identity(root,'c'*64,'https://control.example','service','project',transport=lambda endpoint,payload:(calls.append((endpoint,payload)) or {'version':1,'identity':new,'secret':'t'*64,'revision':2}))
   self.assertEqual(rotated['identity'],new);self.assertEqual(rotated['secret'],'t'*64);self.assertEqual(len(calls),1)

 def test_recycled_bound_slot_can_rotate_back_to_unbound_next_generation(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);old={'nodeId':'node','generation':2,'chatId':-100,'threadId':42};new={'nodeId':'node','generation':3,'chatId':0,'threadId':0}
   (root/'node-credentials.json').write_text(json.dumps({'version':1,'identity':old,'secret':'s'*64,'controlUrl':'https://control.example','serviceId':'service','projectId':'project'}));os.chmod(root/'node-credentials.json',0o600)
   self._ledger(root,old,'s'*64,True)
   rotated=module.resolve_cloud_identity(root,'d'*64,'https://control.example','service','project',transport=lambda *_:{'version':1,'identity':new,'secret':'u'*64,'revision':3})
   self.assertEqual(rotated['identity'],new)

 def test_rotation_rejects_unretired_or_dirty_previous_generation(self):
  for retired,extra in ((False,None),(True,'durable-session')):
   with self.subTest(retired=retired,extra=extra),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);old={'nodeId':'node','generation':1,'chatId':0,'threadId':0};new={'nodeId':'node','generation':2,'chatId':-100,'threadId':42}
    (root/'node-credentials.json').write_text(json.dumps({'version':1,'identity':old,'secret':'s'*64,'controlUrl':'https://control.example','serviceId':'service','projectId':'project'}));os.chmod(root/'node-credentials.json',0o600)
    self._ledger(root,old,'s'*64,retired,extra)
    with self.assertRaises(ValueError):module.resolve_cloud_identity(root,'e'*64,'https://control.example','service','project',transport=lambda *_:{'version':1,'identity':new,'secret':'t'*64,'revision':2})

 def test_bootstrap_identifies_authenticated_api_client(self):
  from unittest.mock import patch,MagicMock
  response=MagicMock();response.status=200;response.read.return_value=b'{}'
  opener=MagicMock();opener.open.return_value.__enter__.return_value=response
  with patch.object(module,'build_opener',return_value=opener):
   module._request('https://control.example/nodes/bootstrap',{'bootstrapToken':'synthetic'})
  request=opener.open.call_args.args[0]
  self.assertEqual(request.get_header('User-agent'),'OpenCodeTelegramCore/1')

if __name__=='__main__':unittest.main()
