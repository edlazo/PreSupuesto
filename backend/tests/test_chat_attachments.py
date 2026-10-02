"""Sending the assistant a photo of the notes, or a recording, instead of text.

Typing a job description on a phone is slow, so the work can arrive as a
picture of the paper it is written on or as the tradesman saying it out loud.
Reading either is Gemini's job, which is what most of this checks: that such a
message takes that path, and that whatever cannot be read is refused before it
costs anything.
"""

from __future__ import annotations

import base64
import io
import wave
from types import SimpleNamespace

import pytest

from models import MAX_ATTACHMENT_BYTES, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES
from services import agent_service, hermes_service

# Neither the API nor the model layer looks inside a photo, so a plausible
# header and some filler stand in for one.
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 200


def wav(seconds: float = 0.5) -> bytes:
    """A real, silent WAV in the shape the browser sends: 16 kHz, mono."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16_000)
        handle.writeframes(b"\x00\x00" * int(16_000 * seconds))

    return buffer.getvalue()


def attached(kind: str, mime_type: str, content: bytes) -> dict:
    """One attachment as the browser puts it on the wire."""
    return {
        "kind": kind,
        "mime_type": mime_type,
        "content": base64.b64encode(content).decode(),
    }


@pytest.fixture
def gemini(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """A configured Gemini whose answer is canned, recording what it was given."""
    monkeypatch.setattr(agent_service.settings, "gemini_api_key", "stub-key")
    calls = SimpleNamespace(messages=[], attachments=[])

    async def fake_run(message, session_id, attachments=()):
        calls.messages.append(message)
        calls.attachments.append(list(attachments))
        return agent_service.AgentReply(
            reply="Leí dos trabajos.",
            session_id="gemini-stub",
            model="gemini-stub",
            engine="gemini",
        )

    monkeypatch.setattr(agent_service, "_run_gemini", fake_run)
    return calls


@pytest.fixture
def hermes(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """A reachable Hermes gateway, so routing can be told apart from fallback."""
    calls = SimpleNamespace(count=0)

    async def fake_send(message, session_id=None):
        calls.count += 1
        return "Listo.", "hermes-1", "hermes-agent"

    monkeypatch.setattr(hermes_service, "send_chat_message", fake_send)
    return calls


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------
def test_a_photo_is_read_by_gemini_even_when_hermes_is_up(api, gemini, hermes):
    response = api.post(
        "/api/chat",
        json={
            "message": "Mirá lo que anoté",
            "attachments": [attached("image", "image/jpeg", PNG)],
        },
    )

    assert response.status_code == 200
    assert response.json()["engine"] == "gemini"
    # The gateway speaks text, so it is not even tried with a photo in hand.
    assert hermes.count == 0
    assert [item.kind for item in gemini.attachments[0]] == ["image"]
    assert gemini.attachments[0][0].content == PNG


def test_a_plain_message_still_goes_to_hermes_first(api, gemini, hermes):
    response = api.post("/api/chat", json={"message": "Hola"})

    assert response.status_code == 200
    assert response.json()["engine"] == "hermes"
    assert hermes.count == 1
    assert gemini.attachments == []


def test_a_recording_with_nothing_typed_is_a_complete_turn(api, gemini):
    response = api.post(
        "/api/chat",
        json={"attachments": [attached("audio", "audio/wav", wav())]},
    )

    assert response.status_code == 200
    assert gemini.messages == [""]
    assert [item.kind for item in gemini.attachments[0]] == ["audio"]


def test_reading_a_photo_says_which_key_is_missing(api):
    # No GEMINI_API_KEY here, and no engine but Gemini can look at an image.
    response = api.post(
        "/api/chat",
        json={"attachments": [attached("image", "image/png", PNG)]},
    )

    assert response.status_code == 503
    assert "GEMINI_API_KEY" in response.json()["detail"]


# ---------------------------------------------------------------------------
# What is refused, and before it is paid for
# ---------------------------------------------------------------------------
def test_a_turn_with_neither_text_nor_a_file_is_refused(api, gemini):
    assert api.post("/api/chat", json={}).status_code == 422
    assert api.post("/api/chat", json={"message": "   "}).status_code == 422
    assert gemini.attachments == []


def test_a_format_the_assistant_cannot_read_is_refused(api, gemini):
    response = api.post(
        "/api/chat",
        json={"attachments": [attached("image", "image/heic", PNG)]},
    )

    assert response.status_code == 422
    assert "formato" in str(response.json()["detail"])
    assert gemini.attachments == []


def test_a_recording_in_another_container_is_refused(api, gemini):
    # What the phone recorded is converted to WAV in the browser; anything else
    # arriving here means that step was skipped.
    response = api.post(
        "/api/chat",
        json={"attachments": [attached("audio", "audio/webm", wav())]},
    )

    assert response.status_code == 422
    assert gemini.attachments == []


def test_a_photo_cannot_be_passed_off_as_a_recording(api, gemini):
    response = api.post(
        "/api/chat",
        json={"attachments": [attached("audio", "image/jpeg", PNG)]},
    )

    assert response.status_code == 422
    assert gemini.attachments == []


def test_an_empty_file_is_refused(api, gemini):
    response = api.post("/api/chat", json={"attachments": [attached("image", "image/png", b"")]})

    assert response.status_code == 422
    assert "vacía" in str(response.json()["detail"])


def test_something_that_is_not_base64_is_refused(api, gemini):
    response = api.post(
        "/api/chat",
        json={
            "attachments": [
                {"kind": "image", "mime_type": "image/png", "content": "no-%-base64"}
            ]
        },
    )

    assert response.status_code == 422
    assert gemini.attachments == []


def test_a_photo_over_the_limit_is_refused(api, gemini):
    response = api.post(
        "/api/chat",
        json={"attachments": [attached("image", "image/jpeg", b"0" * (MAX_IMAGE_BYTES + 1))]},
    )

    assert response.status_code == 422
    assert "grande" in str(response.json()["detail"])


def test_a_recording_over_the_limit_is_refused(api, gemini):
    response = api.post(
        "/api/chat",
        json={"attachments": [attached("audio", "audio/wav", b"0" * (MAX_AUDIO_BYTES + 1))]},
    )

    assert response.status_code == 422
    assert "grande" in str(response.json()["detail"])


def test_three_photos_that_fit_are_accepted(api, gemini):
    photo = attached("image", "image/jpeg", b"0" * 400_000)
    response = api.post("/api/chat", json={"attachments": [photo, photo, photo]})

    assert response.status_code == 200
    assert len(gemini.attachments[0]) == 3


def test_a_fourth_photo_is_refused(api, gemini):
    photo = attached("image", "image/jpeg", PNG)
    response = api.post("/api/chat", json={"attachments": [photo] * 4})

    assert response.status_code == 422
    assert gemini.attachments == []


def test_the_whole_request_has_to_fit(api, gemini):
    # Each one is under its own limit; together they are over what a single
    # request can carry, which is the limit that actually breaks in production.
    photo = attached("image", "image/jpeg", b"0" * MAX_IMAGE_BYTES)
    recording = attached("audio", "audio/wav", b"0" * MAX_AUDIO_BYTES)
    assert MAX_IMAGE_BYTES + MAX_AUDIO_BYTES > MAX_ATTACHMENT_BYTES

    response = api.post("/api/chat", json={"attachments": [photo, recording]})

    assert response.status_code == 422
    assert "pesa demasiado" in str(response.json()["detail"])
    assert gemini.attachments == []


# ---------------------------------------------------------------------------
# What the model is sent, and what is kept afterwards
# ---------------------------------------------------------------------------
@pytest.fixture
def listening_gemini(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """A Gemini client that answers at once and keeps every turn it was sent."""
    from google.genai import types

    monkeypatch.setattr(agent_service.settings, "gemini_api_key", "stub-key")
    agent_service._sessions.clear()
    seen = SimpleNamespace(turns=[])

    async def generate_content(*, model, contents, config):
        # The live list is handed to the SDK, so it is copied as it stands now.
        seen.turns.append([*contents])
        answer = types.Content(role="model", parts=[types.Part.from_text(text="Dos trabajos.")])
        return SimpleNamespace(
            candidates=[SimpleNamespace(content=answer)],
            function_calls=[],
            text="Dos trabajos.",
        )

    monkeypatch.setattr(
        agent_service,
        "_get_client",
        lambda: SimpleNamespace(
            aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
        ),
    )
    yield seen
    agent_service._sessions.clear()


def test_the_model_gets_the_words_first_and_then_the_file(api, listening_gemini):
    response = api.post(
        "/api/chat",
        json={
            "message": "Mirá lo que anoté",
            "attachments": [attached("image", "image/jpeg", PNG)],
        },
    )

    assert response.status_code == 200
    sent = listening_gemini.turns[0][-1]
    assert sent.role == "user"
    assert sent.parts[0].text == "Mirá lo que anoté"
    assert sent.parts[1].inline_data.mime_type == "image/jpeg"
    assert sent.parts[1].inline_data.data == PNG


def test_a_photo_alone_asks_the_assistant_to_read_it_back(api, listening_gemini):
    api.post("/api/chat", json={"attachments": [attached("image", "image/png", PNG)]})

    sent = listening_gemini.turns[0][-1]
    assert sent.parts[0].text == agent_service.ATTACHMENT_ONLY_MESSAGE


def test_a_photo_is_not_sent_again_with_every_later_message(api, listening_gemini):
    first = api.post(
        "/api/chat",
        json={
            "message": "Mirá esto",
            "attachments": [
                attached("image", "image/jpeg", PNG),
                attached("audio", "audio/wav", wav()),
            ],
        },
    ).json()

    api.post("/api/chat", json={"message": "Dale, armalo", "session_id": first["session_id"]})

    # Paying for the same photo on every turn of the conversation is what this
    # guards against: the transcript keeps a note of it, not the bytes.
    history = listening_gemini.turns[1]
    assert [part.text for part in history[0].parts] == [
        "Mirá esto [foto adjunta] [audio adjunto]"
    ]
    assert all(part.inline_data is None for turn in history for part in turn.parts)
