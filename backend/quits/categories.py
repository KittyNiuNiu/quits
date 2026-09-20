"""SPEC §7.21: categories are optional and come from a fixed hardcoded list.

SPEC §7.22: shown as a label in the expense list. There is no category
breakdown screen and no per-category totals in v1.
"""

CATEGORIES: tuple[str, ...] = (
    "food",
    "drinks",
    "transport",
    "accommodation",
    "activities",
    "shopping",
    "other",
)
