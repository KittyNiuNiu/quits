"""Quits — expense splitting for trips and events."""

__all__ = ["create_app"]


def __getattr__(name):  # pragma: no cover - thin re-export
    if name == "create_app":
        from quits.app import create_app

        return create_app
    raise AttributeError(name)
