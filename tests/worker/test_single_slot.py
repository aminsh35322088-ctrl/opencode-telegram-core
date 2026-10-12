import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from single_slot import SingleSlotRuntime, SlotState


def identity(generation=1, chat_id=0, thread_id=0, node_id='slot'):
    return {'nodeId': node_id, 'generation': generation, 'chatId': chat_id, 'threadId': thread_id}


class SingleSlotRuntimeTests(unittest.TestCase):
    def test_unbound_slot_binds_one_topic_through_ready(self):
        slot = SingleSlotRuntime(identity())
        self.assertEqual(slot.state, SlotState.UNBOUND)
        self.assertEqual(slot.generation, 1)
        self.assertIsNone(slot.topic)

        slot.begin_binding(identity(2, -100, 42))
        self.assertEqual(slot.state, SlotState.BINDING)
        self.assertEqual(slot.generation, 2)
        self.assertEqual(slot.topic, (-100, 42))
        with self.assertRaisesRegex(ValueError, 'slot is not unbound'):
            slot.begin_binding(identity(3, -100, 43))

        slot.mark_warming()
        self.assertEqual(slot.state, SlotState.WARMING)
        slot.mark_ready()
        self.assertEqual(slot.state, SlotState.READY)

    def test_bound_constructor_starts_warming(self):
        slot = SingleSlotRuntime(identity(7, -100, 55))
        self.assertEqual(slot.state, SlotState.WARMING)
        self.assertEqual(slot.generation, 7)
        self.assertEqual(slot.topic, (-100, 55))

    def test_only_one_active_run_is_owned(self):
        slot = SingleSlotRuntime(identity(2, -100, 42))
        slot.mark_ready()
        slot.begin_run('run-1')
        self.assertEqual(slot.state, SlotState.RUNNING)
        self.assertEqual(slot.active_run_id, 'run-1')
        # Re-admitting the same prepared run is idempotent.
        slot.begin_run('run-1')
        with self.assertRaisesRegex(ValueError, 'another run'):
            slot.begin_run('run-2')
        with self.assertRaisesRegex(ValueError, 'foreign run'):
            slot.finish_run('run-2')
        slot.finish_run('run-1')
        self.assertEqual(slot.state, SlotState.READY)
        self.assertIsNone(slot.active_run_id)

    def test_generation_is_constant_time_stale_request_fence(self):
        slot = SingleSlotRuntime(identity())
        slot.assert_generation(1)
        with self.assertRaisesRegex(ValueError, 'stale slot generation'):
            slot.assert_generation(2)
        slot.begin_binding(identity(2, -100, 42))
        slot.assert_generation(2)
        with self.assertRaisesRegex(ValueError, 'stale slot generation'):
            slot.assert_generation(1)
        slot.begin_retirement()
        slot.complete_retirement(3)
        slot.assert_generation(3)
        with self.assertRaisesRegex(ValueError, 'stale slot generation'):
            slot.assert_generation(2)

    def test_retirement_blocks_work_and_cleanly_returns_unbound(self):
        slot = SingleSlotRuntime(identity(2, -100, 42))
        slot.mark_ready()
        slot.begin_run('run-1')
        slot.begin_retirement()
        self.assertEqual(slot.state, SlotState.RETIRING)
        self.assertIsNone(slot.active_run_id)
        with self.assertRaisesRegex(ValueError, 'retiring'):
            slot.begin_run('run-2')
        with self.assertRaisesRegex(ValueError, 'slot is not unbound'):
            slot.begin_binding(identity(3, -100, 43))
        slot.complete_retirement(3)
        self.assertEqual(slot.state, SlotState.UNBOUND)
        self.assertEqual(slot.generation, 3)
        self.assertIsNone(slot.topic)
        slot.begin_binding(identity(4, -100, 43))
        self.assertEqual(slot.topic, (-100, 43))

    def test_generation_transitions_must_be_exactly_monotonic(self):
        slot = SingleSlotRuntime(identity())
        for candidate in (1, 3):
            with self.subTest(candidate=candidate), self.assertRaisesRegex(ValueError, 'next slot generation'):
                slot.begin_binding(identity(candidate, -100, 42))
        slot.begin_binding(identity(2, -100, 42))
        slot.begin_retirement()
        for candidate in (2, 4):
            with self.subTest(candidate=candidate), self.assertRaisesRegex(ValueError, 'next slot generation'):
                slot.complete_retirement(candidate)


if __name__ == '__main__':
    unittest.main()
