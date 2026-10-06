"""Validated generated-action discovery; execution remains owned by Core tools."""
import copy
import json
import re

RISKS = {'read', 'write', 'external', 'mutating', 'destructive'}


class ActionRuntime:
    def __init__(self, snapshot):
        self.snapshot = snapshot

    def _actions(self):
        source = self.snapshot.get('actions')
        if not isinstance(source, list) or len(source) > 10000:
            raise ValueError('invalid action snapshot')
        owners = self.snapshot.get('configuration', {}).get('extensions', [])
        if not isinstance(owners, list):
            raise ValueError('invalid extension snapshot')
        enabled_owners = {owner.get('id'): owner for owner in owners if isinstance(owner, dict) and isinstance(owner.get('id'), str) and owner.get('enabled') is not False and owner.get('userDisabled') is not True}
        result, ids = [], set()
        for action in source:
            if not isinstance(action, dict) or action.get('enabled') is not True or action.get('userDisabled') is True:
                continue
            if action.get('extensionId') not in enabled_owners:
                continue
            identity = action.get('id')
            if not isinstance(identity, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{1,127}', identity) or identity in ids:
                raise ValueError('ambiguous generated action')
            ids.add(identity)
            if action.get('risk') not in RISKS:
                raise ValueError('invalid generated action risk')
            self._invocation(action.get('invocation'))
            invocation = action['invocation']
            owner_resource = enabled_owners[action['extensionId']].get('resource', {})
            if invocation['kind'] == 'mcp-tool' and (not isinstance(owner_resource, dict) or owner_resource.get('kind') != 'mcp' or invocation['server'] != owner_resource.get('serverName')):
                raise ValueError('MCP action owner mismatch')
            result.append(copy.deepcopy(action))
        return sorted(result, key=lambda item: item['id'])

    @staticmethod
    def _invocation(value):
        if not isinstance(value, dict) or value.get('kind') not in ('native-tool', 'action-tool', 'mcp-tool'):
            raise ValueError('invalid action invocation')
        kind = value['kind']
        allowed = {'kind', 'tool'} | ({'server'} if kind == 'mcp-tool' else {'arguments'}) | ({'actionArgument', 'actionValue'} if kind == 'action-tool' else set())
        if set(value) - allowed or not isinstance(value.get('tool'), str) or not 0 < len(value['tool']) <= 128:
            raise ValueError('invalid action target')
        if kind == 'mcp-tool' and (not isinstance(value.get('server'), str) or not 0 < len(value['server']) <= 128):
            raise ValueError('explicit MCP server required')
        fixed = value.get('arguments', {})
        if not isinstance(fixed, dict) or len(fixed) > 16:
            raise ValueError('invalid fixed arguments')
        for key, item in fixed.items():
            if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', key) or re.search(r'secret|token|password|credential|authorization|api.?key', key, re.I) or not isinstance(item, str) or len(item) > 1024 or re.search(r'Bearer\s|-----BEGIN .*PRIVATE KEY', item, re.I):
                raise ValueError('invalid fixed argument')
        if kind == 'action-tool' and (not isinstance(value.get('actionArgument'), str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', value['actionArgument']) or not isinstance(value.get('actionValue'), str) or not 0 < len(value['actionValue']) <= 128 or value['actionArgument'] in fixed):
            raise ValueError('invalid action discriminator')

    def list(self):
        return {'revision': self.snapshot['revision'], 'actions': self._actions()}

    def resolve(self, identity):
        if not isinstance(identity, str):
            raise ValueError('exact action id required')
        match = next((action for action in self._actions() if action['id'] == identity), None)
        if match is None:
            raise ValueError('action unavailable')
        return {'revision': self.snapshot['revision'], 'action': match}

    def plan(self, identity, arguments):
        action = self.resolve(identity)['action']
        if not isinstance(arguments, dict) or len(json.dumps(arguments)) > 65536:
            raise ValueError('bounded action arguments required')
        invocation = action['invocation']
        fixed = invocation.get('arguments', {})
        discriminator = invocation.get('actionArgument')
        if set(arguments) & set(fixed) or discriminator and discriminator in arguments:
            raise ValueError('approved fixed arguments cannot be overridden')
        merged = copy.deepcopy(arguments)
        merged.update(fixed)
        if discriminator:
            merged[discriminator] = invocation['actionValue']
        return {'revision': self.snapshot['revision'], 'id': identity, 'risk': action['risk'], 'invocation': copy.deepcopy(invocation), 'arguments': merged}

    def invoke(self, identity, arguments):
        self.plan(identity, arguments)
        # Python cannot manufacture Core's permission, cancellation or process scope.
        raise ValueError('Action invocation requires the active Core tool context; use the resolved exact native/action/MCP tool')
