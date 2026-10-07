"""Exercise the materialized tool, keeping execution out of the HTTP control bridge."""
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from control_bridge import ControlBridge


@unittest.skipUnless(shutil.which('node'), 'Node is required to exercise the materialized Core tool')
class GeneratedActionToolSourceTests(unittest.TestCase):
    def test_invoke_uses_only_captured_callback_and_keeps_target_result(self):
        source = ControlBridge(None).actions_tool_source().replace('export default', 'const actionTool =', 1)
        script = source + '''
let captured;
globalThis.fetch = () => { throw new Error("Invocation must not use HTTP execution"); };
const result = await actionTool.execute({action:"invoke",id:"example.load",arguments:{input:"sample"}}, {
  sessionID:"ses_owned", generatedAction:async (id,args) => {captured={id,args};return {title:"target",output:"done",metadata:{risk:"read"}};}
});
if (captured.id !== "example.load" || captured.args.input !== "sample" || result.output !== "done" || result.metadata.risk !== "read") throw new Error("Exact delegated result was not preserved");
let rejected=false;
try { await actionTool.execute({action:"invoke",id:"example.load"},{sessionID:"ses_owned"}); } catch(error) {rejected=error.message.includes("captured Core tool context");}
if(!rejected) throw new Error("Invocation without a captured context did not fail closed");
'''
        completed = subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True, timeout=15)
        self.assertEqual(completed.returncode, 0, completed.stderr)
