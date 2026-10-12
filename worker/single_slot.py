"""Single reusable Topic slot for one Railway Worker."""
from enum import Enum
import re
import threading

_SAFE_INTEGER = 9007199254740991


class SlotState(str, Enum):
    UNBOUND = 'UNBOUND'
    BINDING = 'BINDING'
    WARMING = 'WARMING'
    READY = 'READY'
    RUNNING = 'RUNNING'
    RETIRING = 'RETIRING'


def _validated_identity(identity):
    if not isinstance(identity, dict) or set(identity) != {'nodeId', 'generation', 'chatId', 'threadId'}:
        raise ValueError('invalid slot identity')
    if not isinstance(identity['nodeId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', identity['nodeId']):
        raise ValueError('invalid slot identity')
    if any(type(identity[key]) is not int or abs(identity[key]) > _SAFE_INTEGER for key in ('generation', 'chatId', 'threadId')):
        raise ValueError('invalid slot identity')
    if identity['generation'] < 1:
        raise ValueError('invalid slot identity')
    unbound = identity['chatId'] == 0 and identity['threadId'] == 0
    if not unbound and (identity['chatId'] == 0 or identity['threadId'] <= 1):
        raise ValueError('invalid slot Topic identity')
    return dict(identity)


class SingleSlotRuntime:
    def __init__(self, identity):
        identity = _validated_identity(identity)
        self._lock = threading.RLock()
        self._node_id = identity['nodeId']
        self._generation = identity['generation']
        self._topic = None if identity['chatId'] == 0 else (identity['chatId'], identity['threadId'])
        self._active_run_id = None
        self._state = SlotState.UNBOUND if self._topic is None else SlotState.WARMING

    @property
    def state(self):
        with self._lock:
            return self._state

    @property
    def generation(self):
        with self._lock:
            return self._generation

    @property
    def topic(self):
        with self._lock:
            return self._topic

    @property
    def active_run_id(self):
        with self._lock:
            return self._active_run_id

    def assert_generation(self, generation):
        with self._lock:
            if type(generation) is not int or generation != self._generation:
                raise ValueError('stale slot generation')

    def begin_binding(self, identity):
        identity = _validated_identity(identity)
        with self._lock:
            if self._state is not SlotState.UNBOUND:
                raise ValueError('slot is not unbound')
            if identity['nodeId'] != self._node_id or identity['chatId'] == 0:
                raise ValueError('invalid slot binding identity')
            if identity['generation'] != self._generation + 1:
                raise ValueError('binding requires next slot generation')
            self._generation = identity['generation']
            self._topic = (identity['chatId'], identity['threadId'])
            self._state = SlotState.BINDING

    def mark_warming(self):
        with self._lock:
            if self._state is not SlotState.BINDING:
                raise ValueError('slot is not binding')
            self._state = SlotState.WARMING

    def mark_ready(self):
        with self._lock:
            if self._state is not SlotState.WARMING:
                raise ValueError('slot is not warming')
            self._state = SlotState.READY

    def begin_run(self, run_id):
        if not isinstance(run_id, str) or not run_id:
            raise ValueError('run id required')
        with self._lock:
            if self._state is SlotState.RETIRING:
                raise ValueError('slot is retiring')
            if self._state is SlotState.RUNNING:
                if self._active_run_id == run_id:
                    return
                raise ValueError('another run already owns the slot')
            if self._state is not SlotState.READY:
                raise ValueError('slot is not ready')
            self._active_run_id = run_id
            self._state = SlotState.RUNNING

    def finish_run(self, run_id):
        with self._lock:
            if self._state is not SlotState.RUNNING or self._active_run_id != run_id:
                raise ValueError('foreign run cannot release slot')
            self._active_run_id = None
            self._state = SlotState.READY

    def begin_retirement(self):
        with self._lock:
            if self._state is SlotState.RETIRING:
                return
            self._active_run_id = None
            self._state = SlotState.RETIRING

    def complete_retirement(self, next_generation):
        with self._lock:
            if self._state is not SlotState.RETIRING:
                raise ValueError('slot is not retiring')
            if type(next_generation) is not int or next_generation != self._generation + 1:
                raise ValueError('retirement requires next slot generation')
            self._generation = next_generation
            self._topic = None
            self._active_run_id = None
            self._state = SlotState.UNBOUND
