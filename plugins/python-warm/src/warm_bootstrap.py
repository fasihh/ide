"""Warm-start bootstrap for live Python runs (driven by launcher.ts).

    python [flags] warm_bootstrap.py [PRELOAD_FROM]

1. Imports the leading import block of PRELOAD_FROM (the previously run script), if given.
2. Blocks until the launcher writes the script path to fd 3 and closes it.
3. Runs that script as __main__, as if it had been started with `python script.py`.

stdin/stdout/stderr belong to the user's program; control data only travels on fd 3.
Kept compatible with Python 3.7+ (no walrus, no builtin generics in annotations).
"""

import ast
import os
import runpy
import sys
import traceback

CONTROL_FD = 3


def leading_imports(source):
    """Modules imported before the first other top-level statement.

    A module docstring, `__future__` imports and relative imports are skipped. Stopping at the first
    other statement keeps code like `os.environ[...] = ...` ahead of the imports it configures.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    names = []
    for index, node in enumerate(tree.body):
        if index == 0 and _is_docstring(node):
            continue
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module and node.module != "__future__":
                names.append(node.module)
        else:
            break
    return names


def _is_docstring(node):
    return isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)


def preload(script_path):
    try:
        with open(script_path, encoding="utf-8") as f:
            source = f.read()
    except OSError:
        return
    for name in leading_imports(source):
        try:
            __import__(name)
        except BaseException:
            # A failing import must not kill the standby; the real run reports it.
            pass


def read_control():
    """The script path, or "" when the launcher closed fd 3 without sending one."""
    chunks = []
    while True:
        chunk = os.read(CONTROL_FD, 4096)
        if not chunk:
            break
        chunks.append(chunk)
    os.close(CONTROL_FD)
    return b"".join(chunks).decode("utf-8")


def user_frames(tb, script):
    """Drop the bootstrap/runpy frames so tracebacks start in the user's script."""
    target = os.path.normcase(os.path.abspath(script))
    first = tb
    while first is not None and os.path.normcase(os.path.abspath(first.tb_frame.f_code.co_filename)) != target:
        first = first.tb_next
    return first or tb


def run_as_main(script):
    sys.argv = [script]
    sys.path[0] = os.path.dirname(os.path.abspath(script))
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit:
        raise
    except BaseException as error:
        traceback.print_exception(type(error), error, user_frames(error.__traceback__, script))
        sys.exit(1)


def main(argv):
    if len(argv) > 1:
        # Resolve the previous script's sibling modules, not this file's.
        sys.path[0] = os.path.dirname(os.path.abspath(argv[1]))
        preload(argv[1])
    script = read_control()
    if script:
        run_as_main(script)


if __name__ == "__main__":
    main(sys.argv)
