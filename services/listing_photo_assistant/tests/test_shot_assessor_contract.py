from __future__ import annotations

import json

import pytest

from services.listing_photo_assistant.providers.shot_assessor import (
    AssessmentImage,
    RequestedShot,
    ResponsesShotAssessor,
    ShotAssessmentContractError,
    ShotAssessorInput,
    validate_shot_assessment,
)


def test_contract_is_closed_and_measurement_is_not_a_shot() -> None:
    valid = {
        "shotType": "front",
        "quality": "ok",
        "issues": [],
        "missingShots": ["back", "tag"],
        "nextAction": "REQUEST_NEXT",
    }
    assert validate_shot_assessment(valid).to_payload() == valid

    with pytest.raises(ShotAssessmentContractError):
        validate_shot_assessment({**valid, "measurement": {}})
    with pytest.raises(ShotAssessmentContractError):
        ShotAssessorInput(AssessmentImage(b"jpeg"), "measurement")  # type: ignore[arg-type]


class FakeResponses:
    def __init__(self, payload: object) -> None:
        self.payload = payload
        self.request: dict[str, object] | None = None

    async def create(self, **kwargs: object) -> object:
        self.request = kwargs
        return type("Response", (), {"output_text": json.dumps(self.payload)})()


@pytest.mark.asyncio
async def test_responses_adapter_disables_storage_and_uses_strict_schema() -> None:
    client = FakeResponses(
        {
            "shotType": "tag",
            "quality": "ok",
            "issues": [],
            "missingShots": [],
            "nextAction": "COMPLETE",
        }
    )
    assessor = ResponsesShotAssessor(client, "test-model")
    result = await assessor.assess(
        ShotAssessorInput(AssessmentImage(b"jpeg"), RequestedShot.TAG)
    )

    assert result.to_payload()["nextAction"] == "COMPLETE"
    assert client.request is not None
    assert client.request["store"] is False
    assert client.request["reasoning"] == {"effort": "none"}
    assert client.request["max_output_tokens"] == 256
    text = client.request["text"]
    assert isinstance(text, dict)
    assert text["format"]["strict"] is True  # type: ignore[index]
    schema = text["format"]["schema"]
    assert isinstance(schema, dict)
    assert "measurement" not in schema["properties"]


@pytest.mark.asyncio
async def test_responses_adapter_rejects_invalid_json_response() -> None:
    class InvalidResponses:
        async def create(self, **kwargs: object) -> object:
            del kwargs
            return type("Response", (), {"output_text": "not-json"})()

    assessor = ResponsesShotAssessor(InvalidResponses(), "test-model")
    with pytest.raises(ShotAssessmentContractError):
        await assessor.assess(
            ShotAssessorInput(AssessmentImage(b"jpeg"), RequestedShot.FRONT)
        )
