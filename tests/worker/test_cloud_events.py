import importlib.util,sys,unittest,tempfile,io,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[2]/'worker'))
spec=importlib.util.spec_from_file_location('cloud_events_agent',Path(__file__).parents[2]/'worker/node_agent.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class EventTests(unittest.TestCase):
 def test_signed_callback_filters_foreign_session_and_persists_receipt(self):
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;b.set('session','owned');b.set('runId','run');b.set('runMode','native');calls=[];agent.outbound=lambda op,payload,session=None:calls.append((op,payload,session)) or {'accepted':True}
   events=[{'type':'session.idle','properties':{'sessionID':'foreign'}},{'type':'session.status','properties':{'sessionID':'owned','status':{'type':'busy'}}},{'type':'session.idle','properties':{'sessionID':'owned'}}]
   stream=io.BytesIO(b''.join(b'data: '+a.canonical(e)+b'\n\n' for e in events));agent.forward_callbacks(stream,'owned','run')
   self.assertEqual(len(calls),2);self.assertEqual(calls[0][0],'session.event');self.assertEqual(calls[0][2],'owned');self.assertEqual(calls[0][1]['runId'],'run');self.assertIsNone(b.get('callbackPending'));b.db.close()
 def test_callback_failure_keeps_pending_payload_for_reconciliation(self):
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;b.set('session','owned');b.set('runId','run');b.set('runMode','native')
   def fail(*_args,**_kwargs):raise OSError('unavailable')
   agent.outbound=fail;stream=io.BytesIO(b'data: '+a.canonical({'type':'session.status','properties':{'sessionID':'owned','status':{'type':'busy'}}})+b'\n\n')
   agent.forward_callbacks(stream,'owned','run');self.assertEqual(b.get('callbackPending')['runId'],'run');b.db.close()

 def test_restart_after_admission_reports_incomplete_without_reexecuting(self):
  from unittest.mock import Mock
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));b.set('session','owned');b.set('runId','run');b.set('callbackRunReceipt',{'runId':'run','state':'ACCEPTED'});b.db.close()
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;agent.process=Mock();agent.process.poll.return_value=None
   result=agent.dispatch(b.envelope('callback.status',{'runId':'run'},'owned'))
   self.assertEqual(result['state'],'INCOMPLETE');b.db.close()

 def test_uncertain_prompt_receipt_never_resubmits_or_reports_accepted(self):
  from unittest.mock import Mock
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));b.set('session','owned');b.set('runId','run');b.set('callbackRunReceipt',{'runId':'run','state':'SUBMITTED'});agent=a.Agent(b,'https://control.example');agent.ready=True;agent.process=Mock();agent.process.poll.return_value=None;agent.local=Mock(side_effect=AssertionError('must not submit again'))
   result=agent.dispatch(b.envelope('run',{'runId':'run','text':'hello','events':True},'owned'))
   self.assertFalse(result['accepted']);self.assertEqual(result['state'],'SUBMITTED');agent.local.assert_not_called();b.db.close()

 def test_model_preflight_returns_only_nonsecret_core_catalog_metadata(self):
  from unittest.mock import Mock
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;agent.process=Mock();agent.process.poll.return_value=None
   agent.local=Mock(return_value={'providers':[{'id':'opencode','options':{'apiKey':'must-never-return'},'models':{'big-pickle':{'id':'big-pickle','cost':{'input':0,'output':0}}}}]})
   result=agent.dispatch(b.envelope('model.inspect',{'providerID':'opencode','modelID':'big-pickle'}))
   self.assertTrue(result['available']);self.assertTrue(result['connected']);self.assertNotIn('must-never-return',json.dumps(result));agent.local.assert_called_once_with('GET','/config/providers');b.db.close()

 def test_old_idle_cannot_complete_new_callback_run(self):
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;b.set('session','owned');b.set('runId','run');b.set('runMode','native');calls=[];agent.outbound=lambda op,payload,session=None:calls.append(payload) or {'accepted':True}
   events=[{'type':'session.idle','properties':{'sessionID':'owned'}},{'type':'session.status','properties':{'sessionID':'owned','status':{'type':'busy'}}},{'type':'session.idle','properties':{'sessionID':'owned'}}]
   agent.forward_callbacks(io.BytesIO(b''.join(b'data: '+a.canonical(e)+b'\n\n' for e in events)),'owned','run')
   self.assertEqual([p['event']['type'] for p in calls],['session.status','session.idle']);b.db.close()

 def test_expected_revision_rejects_changed_snapshot_before_prompt(self):
  from unittest.mock import Mock
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;agent.process=Mock();agent.process.poll.return_value=None;b.set('session','owned');agent.local=Mock(return_value=None);agent.refresh_snapshot=Mock();b.snapshot={'revision':2}
   with self.assertRaisesRegex(ValueError,'snapshot revision mismatch'):
    agent.dispatch(b.envelope('run',{'runId':'run','text':'hello','expectedRevision':1},'owned'))
   self.assertFalse(any(c.args[0]=='POST' for c in agent.local.call_args_list));b.db.close()

 def test_signed_control_requests_identify_api_client(self):
  from unittest.mock import patch,MagicMock
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=0,threadId=0));agent=a.Agent(b,'https://control.example');response=MagicMock();response.read.return_value=b'{}';opener=MagicMock();opener.open.return_value.__enter__.return_value=response;b.authenticate=lambda *_:{'operation':'snapshot.get','payload':{},'sessionId':None}
   with patch('urllib.request.build_opener',return_value=opener):agent.outbound('snapshot.get',{})
   self.assertEqual(opener.open.call_args.args[0].get_header('User-agent'),'OpenCodeTelegramCore/1');b.db.close()

 def test_model_preflight_uses_production_headless_config_catalog(self):
  from unittest.mock import Mock
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;agent.process=Mock();agent.process.poll.return_value=None;agent.local=Mock(return_value={'providers':[{'id':'opencode','models':{'big-pickle':{'cost':{'input':0,'output':0}}}}],'default':{'opencode':'big-pickle'}})
   result=agent.dispatch(b.envelope('model.inspect',{'providerID':'opencode','modelID':'big-pickle'}));self.assertTrue(result['available']);self.assertTrue(result['connected']);agent.local.assert_called_once_with('GET','/config/providers');b.db.close()
