import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from action_runtime import ActionRuntime


class ActionRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = {'revision': 7, 'actions': [{'id': 'example.load', 'extensionId': 'skill:example', 'enabled': True, 'userDisabled': False, 'risk': 'read', 'description': 'Load example', 'invocation': {'kind': 'native-tool', 'tool': 'skill', 'arguments': {'name': 'example'}}}], 'configuration': {'extensions': [{'id': 'skill:example', 'enabled': True}]}}
        self.runtime = ActionRuntime(self.snapshot)

    def test_resolve_retains_fixed_arguments_and_revision(self):
        result = self.runtime.resolve('example.load')
        self.assertEqual(result['revision'], 7)
        self.assertEqual(result['action']['invocation']['arguments'], {'name': 'example'})
        result['action']['invocation']['arguments']['name'] = 'changed'
        self.assertEqual(self.runtime.resolve('example.load')['action']['invocation']['arguments']['name'], 'example')

    def test_disabled_unknown_duplicate_and_invalid_actions_fail_closed(self):
        self.snapshot['actions'][0]['enabled'] = False
        with self.assertRaises(ValueError): self.runtime.resolve('example.load')
        self.snapshot['actions'][0]['enabled'] = True
        self.snapshot['actions'].append(dict(self.snapshot['actions'][0]))
        with self.assertRaises(ValueError): self.runtime.resolve('example.load')

    def test_plan_rejects_fixed_argument_override_and_retains_risk(self):
        with self.assertRaises(ValueError): self.runtime.plan('example.load', {'name': 'other'})
        result = self.runtime.plan('example.load', {})
        self.assertEqual(result['arguments'], {'name': 'example'})
        self.assertEqual(result['risk'], 'read')

    def test_no_generic_execution_authority_is_fabricated(self):
        with self.assertRaisesRegex(ValueError, 'Core tool context'): self.runtime.invoke('example.load', {})

    def test_mcp_plan_retains_explicit_owned_server_and_tool(self):
        self.snapshot['configuration']['extensions'] = [{'id': 'mcp:example', 'resource': {'kind': 'mcp', 'serverName': 'example'}}]
        self.snapshot['actions'] = [{'id': 'example.delete', 'extensionId': 'mcp:example', 'enabled': True, 'risk': 'destructive', 'invocation': {'kind': 'mcp-tool', 'server': 'example', 'tool': 'delete_database'}}]
        plan = self.runtime.plan('example.delete', {'database': 'sample'})
        self.assertEqual(plan['risk'], 'destructive')
        self.assertEqual(plan['invocation'], {'kind': 'mcp-tool', 'server': 'example', 'tool': 'delete_database'})
        self.snapshot['actions'][0]['invocation']['server'] = 'foreign'
        with self.assertRaises(ValueError): self.runtime.resolve('example.delete')

    def test_action_tool_discriminator_is_fixed(self):
        self.snapshot['actions'][0]['invocation'] = {'kind': 'action-tool', 'tool': 'bot', 'actionArgument': 'action', 'actionValue': 'skills.list'}
        self.assertEqual(self.runtime.plan('example.load', {})['arguments'], {'action': 'skills.list'})
        with self.assertRaises(ValueError): self.runtime.plan('example.load', {'action': 'skills.delete'})
