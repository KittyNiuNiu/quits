"""The error vocabulary, shared with the frontend.

SPEC §8: validation is enforced server-side. These codes are what the API
reports; the client dispatches on ``code`` and shows ``message`` verbatim, so
messages must be human-readable and safe to display.

The values here match `frontend/src/services/errors.js` and the `ErrorCode`
enum in `openapi.yaml`.
"""

from __future__ import annotations


class ErrorCode:
    NOT_FOUND = "not_found"
    TRIP_NAME_EMPTY = "trip_name_empty"
    NAME_EMPTY = "name_empty"
    NAME_TAKEN = "name_taken"
    DESCRIPTION_EMPTY = "description_empty"
    AMOUNT_NOT_POSITIVE = "amount_not_positive"
    NO_PARTICIPANTS_IN_SPLIT = "no_participants_in_split"
    EXACT_SUM_MISMATCH = "exact_sum_mismatch"
    PERCENT_SUM_MISMATCH = "percent_sum_mismatch"
    PARTICIPANT_IN_USE = "participant_in_use"
    UNKNOWN_PARTICIPANT = "unknown_participant"
    INVALID_CATEGORY = "invalid_category"
    INVALID_SPLIT_TYPE = "invalid_split_type"

    # Not in openapi.yaml's enum. Returned only for a request the documented
    # codes cannot describe — a body that is not JSON, or an unroutable path.
    # The frontend never produces one; it degrades to showing `message`.
    INVALID_REQUEST = "invalid_request"


class ApiError(Exception):
    """An error the client is meant to see, carrying its HTTP status."""

    def __init__(self, code: str, message: str, status_code: int = 422, **details: object):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details

    def to_body(self) -> dict:
        return {"code": self.code, "message": self.message, "details": self.details}


def not_found(message: str = "That trip link is not valid.") -> ApiError:
    """SPEC §2: with no roles, an unknown token is simply not found — never a
    401 or 403, because there is nothing else access could depend on."""
    return ApiError(ErrorCode.NOT_FOUND, message, status_code=404)
