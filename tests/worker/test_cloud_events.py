import importlib.util,sys,unittest,tempfile,io,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[2]/'worker'))
spec=importlib.util.spec_from_file_location('cloud_events_agent',Path(__file__).parents[2]/'worker/node_agent.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class EventTests(unittest.TestCase):
 def test_signed_callback_filters_foreign_session_and_persists_receipt(self):
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;b.set('session','owned');b.set('runId','run');b.set('runMode','native');calls=[];agent.outbound=lambda op,payload,session=None:calls.append((op,payload,session)) or {'accepted':True}
   events=[{'type':'session.idle','properties':{'sessionID':'foreign'}},{'type':'session.idle','properties':{'sessionID':'owned'}}]
   stream=io.BytesIO(b''.join(b'data: '+a.canonical(e)+b'\n\n' for e in events));agent.forward_callbacks(stream,'owned','run')
   self.assertEqual(len(calls),1);self.assertEqual(calls[0][0],'session.event');self.assertEqual(calls[0][2],'owned');self.assertEqual(calls[0][1]['runId'],'run');self.assertIsNone(b.get('callbackPending'));b.db.close()
 def test_callback_failure_keeps_pending_payload_for_reconciliation(self):
  with tempfile.TemporaryDirectory() as root:
   b=a.Boundary(root,'s'*64,dict(nodeId='node',generation=1,chatId=-100,threadId=42));agent=a.Agent(b,'https://control.example');agent.ready=True;b.set('session','owned');b.set('runId','run');b.set('runMode','native')
   def fail(*_args,**_kwargs):raise OSError('unavailable')
   agent.outbound=fail;stream=io.BytesIO(b'data: '+a.canonical({'type':'session.idle','properties':{'sessionID':'owned'}})+b'\n\n')
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
