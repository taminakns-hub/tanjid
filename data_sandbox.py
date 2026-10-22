import os

def safe_join(base_dir: str, *paths: str) -> str:
    """Safely joins paths ensuring that the result is strictly inside base_dir.
    Prevents directory traversal attacks (e.g. using ../..).
    """
    resolved_base = os.path.abspath(base_dir)
    joined = os.path.join(resolved_base, *paths)
    resolved_joined = os.path.abspath(joined)
    
    # Check if the resolved path starts with the base path
    if resolved_joined != resolved_base and not resolved_joined.startswith(resolved_base + os.sep):
        raise PermissionError("Access Denied: Path traversal detected!")
        
    return resolved_joined


def normalize_python_entrypoint(entrypoint: str) -> str:
    """Validate and normalize a root-relative Python startup file path."""
    if not isinstance(entrypoint, str):
        raise ValueError("Startup file must be a path to a Python file.")

    normalized = entrypoint.strip().replace("\\", "/")
    parts = normalized.split("/")
    if (
        not normalized
        or normalized.startswith("/")
        or "\x00" in normalized
        or (len(normalized) > 1 and normalized[1] == ":")
        or not normalized.lower().endswith(".py")
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError("Startup file must be a safe relative path ending in .py.")

    return "/".join(parts)


def resolve_python_entrypoint(base_dir: str, entrypoint: str):
    """Return a normalized startup path and ensure symlinks stay in the bot folder."""
    normalized = normalize_python_entrypoint(entrypoint)
    root = os.path.realpath(base_dir)
    target = os.path.realpath(os.path.join(root, *normalized.split("/")))
    try:
        if os.path.commonpath([root, target]) != root:
            raise ValueError("Startup file must stay inside the bot project folder.")
    except ValueError as exc:
        raise ValueError("Startup file must stay inside the bot project folder.") from exc
    return normalized, target
