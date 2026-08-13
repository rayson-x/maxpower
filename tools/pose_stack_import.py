"""Small import helper for scripts stored in the hyphenated pose-stack folder."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType


def load_pose_stack_module(filename: str) -> ModuleType:
    path = Path(__file__).parent / "pose-stack" / filename
    spec = spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
