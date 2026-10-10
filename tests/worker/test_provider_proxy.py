import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('provider_proxy', Path(__file__).parents[2] / 'worker/provider_proxy.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class ProxyTests(unittest.TestCase):
    def test_private_and_redirect_target_endpoints_rejected(self):
        for endpoint in ('http://example.com/v1', 'https://localhost/v1', 'https://example.com:8443/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?token=fixture'):
            with self.assertRaises(ValueError):
                p.provider_endpoint(endpoint)
        with patch.object(p.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(ValueError):
                p.provider_endpoint('https://provider.example/v1')
        with patch.object(p.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('169.254.169.254', 443))]):
            with self.assertRaises(ValueError):
                p.provider_endpoint('https://provider.example/v1')

    def test_rewrite_never_materializes_real_secret(self):
        proxy = p.ProviderProxy(None)
        original = {'provider': {'p': {'options': {'apiKey': 'bot-credential-proxy:model-provider:p:api-key', 'baseURL': 'https://provider.example/v1'}}}}
        result = proxy.rewrite(original, [{'credentialId': 'api-key'}])
        self.assertEqual(result['provider']['p']['options']['apiKey'], 'local-capability')
        self.assertTrue(result['provider']['p']['options']['baseURL'].startswith('http://127.0.0.1:4097/proxy/'))
        self.assertEqual(original['provider']['p']['options']['apiKey'], 'bot-credential-proxy:model-provider:p:api-key')
        provider = next(iter(proxy.providers.values()))
        self.assertEqual(provider['capability'], 'model-provider:p')

    def test_credential_lease_is_fresh_each_request_and_expiry_closed(self):
        class Agent:
            def __init__(self):
                self.calls = []
                class Boundary:
                    unbound = False
                    def get(self, key):
                        return 'ses_owned'
                self.boundary = Boundary()
            def outbound(self, operation, payload, session=None):
                self.calls.append((operation, payload))
                return {'value': 'fixture-provider-key', 'expiresAt': 200000}
        agent = Agent()
        proxy = p.ProviderProxy(agent)
        provider = {'capability': 'model-provider:p', 'credentialId': 'api-key'}
        with patch.object(p.time, 'time', return_value=100):
            self.assertEqual(proxy.credential(provider), 'fixture-provider-key')
            proxy.credential(provider)
            self.assertEqual(len(agent.calls), 2)
            self.assertEqual(proxy.leases, {})
        with patch.object(p.time, 'time', return_value=201):
            with self.assertRaises(ValueError):
                proxy.credential(provider)
        self.assertEqual(agent.calls[0], ('credential.get', {'capability': 'model-provider:p', 'credentialId': 'api-key', 'purpose': 'provider.request'}))

class ProxyHTTPTests(unittest.TestCase):
    def test_caller_auth_is_stripped_and_exact_capability_secret_stays_upstream(self):
        from urllib.request import Request, urlopen
        class Boundary:
            unbound = False
            def get(self, key):
                return 'ses_owned'
        class Agent:
            ready = True
            retired = False
            boundary = Boundary()
            def outbound(self, operation, payload, session=None):
                assert operation == 'credential.get' and session == 'ses_owned'
                return {'value': 'fixture-private-key', 'expiresAt': p.time.time() * 1000 + 60000}
        requests = []
        class Connection:
            def __init__(self, host, address):
                self.chunks = [b'model-result', b'']
            def request(self, method, route, body=None, headers=None):
                requests.append((method, route, body, dict(headers)))
            def getresponse(self):
                return self
            status = 200
            def getheader(self, key, default=None):
                return default
            def read1(self, size):
                return self.chunks.pop(0)
            def close(self):
                pass
        proxy = p.ProviderProxy(Agent(), port=0)
        proxy.rewrite({'provider': {'p': {'options': {'apiKey': 'bot-credential-proxy:model-provider:p:api-key', 'baseURL': 'https://provider.example/v1'}}}}, [{'credentialId': 'api-key'}])
        route = next(iter(proxy.providers))
        proxy.start()
        try:
            with patch.object(p, 'provider_endpoint', return_value=('provider.example', '/v1', '8.8.8.8')), patch.object(p, 'PinnedConnection', Connection):
                url = 'http://127.0.0.1:' + str(proxy.server.server_port) + '/proxy/' + route + '/chat/completions'
                with urlopen(Request(url, data=b'{}', headers={'Authorization': 'Bearer attacker', 'x-api-key': 'attacker'})) as response:
                    self.assertEqual(response.read(), b'model-result')
            self.assertEqual(requests[0][1], '/v1/chat/completions')
            self.assertEqual(requests[0][3]['Authorization'], 'Bearer fixture-private-key')
            self.assertNotIn('x-api-key', requests[0][3])
        finally:
            proxy.server.shutdown()
            proxy.server.server_close()

class GenericProviderTests(unittest.TestCase):
    def test_canonical_reference_uses_validated_broker_each_request_and_releases(self):
        import sys, time
        from types import SimpleNamespace
        sys.path.insert(0,str(Path(__file__).parents[2]/'worker'))
        from credential_broker import CredentialBroker
        calls=[]
        identity=dict(nodeId='worker',chatId=-100,threadId=42,generation=3)
        boundary=SimpleNamespace(unbound=False,identity=identity,get=lambda _:'session')
        agent=SimpleNamespace(boundary=boundary,ready=True,retired=False)
        def outbound(operation,payload,session=None):
            calls.append((operation,payload))
            if operation=='credential.acquire':return dict(value='fixture-generic-token',leaseId='lease',expiresAt=(time.time()+40)*1000)
            return dict(valid=True)
        agent.outbound=outbound;agent.credentials=CredentialBroker(agent)
        proxy=p.ProviderProxy(agent)
        config={'provider':{'p':{'options':{'apiKey':'bot-credential-proxy:model-provider:p:cid','baseURL':'https://provider.example/v1'}}}}
        proxy.rewrite(config,[dict(integrationId='provider:p',credentialId='cid',configured=True)])
        provider=next(iter(proxy.providers.values()))
        for _ in range(2):
            with proxy.acquire(provider) as lease:self.assertEqual(lease.consume(len),21)
        self.assertEqual(sum(op=='credential.acquire' for op,_ in calls),2)
        self.assertEqual(sum(op=='credential.validate' for op,_ in calls),2)
        self.assertEqual(sum(op=='credential.release' for op,_ in calls),2)
        self.assertEqual(calls[0][1]['capability'],'provider.request')
        self.assertEqual(calls[0][1]['integrationId'],'provider:p')
        self.assertNotIn('fixture-generic-token',str(config))
