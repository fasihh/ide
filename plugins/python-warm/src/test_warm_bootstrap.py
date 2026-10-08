import unittest

from warm_bootstrap import leading_imports


class LeadingImportsTest(unittest.TestCase):
    def test_collects_the_leading_import_block(self):
        source = '"""doc"""\nfrom __future__ import annotations\nimport numpy as np, torch.nn\nfrom collections import deque\n\nx = 1\n'
        self.assertEqual(leading_imports(source), ["numpy", "torch.nn", "collections"])

    def test_stops_at_the_first_other_statement(self):
        source = "import os\nos.environ['CUDA_VISIBLE_DEVICES'] = ''\nimport torch\n"
        self.assertEqual(leading_imports(source), ["os"])

    def test_skips_relative_imports(self):
        self.assertEqual(leading_imports("from . import helper\nimport math\n"), ["math"])

    def test_syntax_errors_preload_nothing(self):
        self.assertEqual(leading_imports("import math\ndef f(:\n"), [])


if __name__ == "__main__":
    unittest.main()
