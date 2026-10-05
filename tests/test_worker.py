"""Include the worker security/lifecycle suite in existing root unittest discovery."""
import unittest
from pathlib import Path


def load_tests(loader, tests, pattern):
    directory = str(Path(__file__).parent / 'worker')
    return unittest.TestLoader().discover(directory, pattern='test_*.py', top_level_dir=directory)
