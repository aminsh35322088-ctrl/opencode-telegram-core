"""Privileged generic credential consumption; never exposed on the tool bridge."""
import math
import time
import threading


class CredentialError(ValueError):
    pass


class CredentialBroker:
    def __init__(self, agent, now=time.time):
        self.agent = agent
        self.now = now

    def acquire(self, request):
        try:
            identity, session = self._owner()
            if not isinstance(request, dict) or set(request) - {
                'integrationId', 'credentialId', 'capability', 'scopes', 'resource'
            }:
                raise ValueError()
            if any(not isinstance(request.get(key), str) or not request[key] or len(request[key]) > 256
                   for key in ('integrationId', 'credentialId', 'capability')):
                raise ValueError()
            scopes = request.get('scopes', [])
            if not isinstance(scopes, list) or len(scopes) > 32 or any(
                    not isinstance(scope, str) or not scope or len(scope) > 256 for scope in scopes):
                raise ValueError()
            payload = {**request, 'scopes': scopes, 'workerId': identity['nodeId'],
                       'topicId': str(identity['chatId']) + ':' + str(identity['threadId']),
                       'generation': identity['generation'], 'sessionId': session}
            reply = self.agent.outbound('credential.acquire', payload, session=session)
            if self._owner() != (identity, session) or not isinstance(reply, dict):
                raise ValueError()
            expiry = reply.get('expiresAt')
            if type(expiry) not in (int, float) or not math.isfinite(expiry) or not self.now() * 1000 < expiry <= (self.now() + 60) * 1000:
                raise ValueError()
            if not isinstance(reply.get('leaseId'), str) or not reply['leaseId'] or len(reply['leaseId']) > 128:
                raise ValueError()
            material = reply.get('value')
            if not isinstance(material, str) or not material or len(material) > 16384 or any(ord(c) < 32 or ord(c) == 127 for c in material):
                raise ValueError()
            return CredentialLease(self, identity, session, reply['leaseId'], expiry, material)
        except Exception:
            raise CredentialError('credential acquisition rejected') from None

    def _owner(self):
        if self.agent.retired or not self.agent.ready or self.agent.boundary.unbound:
            raise CredentialError('credential owner unavailable')
        identity = dict(self.agent.boundary.identity)
        session = self.agent.boundary.get('session')
        if not session or not identity['chatId'] or identity['threadId'] <= 1:
            raise CredentialError('credential owner unavailable')
        return identity, session


class CredentialLease:
    __slots__ = ('_broker', '_identity', '_session', '_id', '_expiry', '__material', '_lock', '_released')

    def __init__(self, broker, identity, session, lease_id, expiry, material):
        self._broker, self._identity, self._session = broker, identity, session
        self._id, self._expiry, self.__material = lease_id, expiry, material
        self._lock, self._released = threading.RLock(), False

    @property
    def metadata(self):
        return {'leaseId': self._id, 'expiresAt': self._expiry}

    def __repr__(self):
        return '<CredentialLease protected>'

    def current(self):
        with self._lock:
            return bool(self.__material and self._broker.now() * 1000 < self._expiry
                        and self._broker._owner() == (self._identity, self._session))

    def discard(self):
        with self._lock:self.__material = None

    def consume(self, consumer):
        """Trusted adapter callback only. Neither this object nor material crosses tool IPC."""
        try:
            if not self.current():
                raise ValueError()
            reply = self._broker.agent.outbound('credential.validate', {'leaseId': self._id}, session=self._session)
            if not isinstance(reply, dict) or reply.get('valid') is not True or not self.current():
                raise ValueError()
            with self._lock:
                if not self.current():raise ValueError()
                material = self.__material
            return consumer(material)
        except Exception:
            raise CredentialError('credential capability rejected') from None

    def release(self):
        with self._lock:
            self.__material = None
            if self._released:return
            self._released = True
        try:
            self._broker.agent.outbound('credential.release', {'leaseId': self._id}, session=self._session)
        except Exception:
            # Local material is discarded even if the authoritative lease must expire.
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.release()
