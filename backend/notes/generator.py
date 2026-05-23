"""
Notes Generation — llama.cpp local inference
Generates comprehensive meeting notes from full transcription.
No API key. Runs entirely on-device via llama.cpp.
"""

import asyncio
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Optional, AsyncIterator

logger = logging.getLogger("aurelius.notes")

RESOURCES_DIR = Path(os.environ.get("AURELIUS_RESOURCES", Path(__file__).parent.parent.parent / "resources"))
LLAMA_BIN = RESOURCES_DIR / "bin" / "llama-cli"
MODELS_DIR = RESOURCES_DIR / "models"

# Preferred models in order of quality vs size
PREFERRED_MODELS = [
    "mistral-7b-instruct-v0.3.Q4_K_M.gguf",   # Best quality ~4.1GB
    "mistral-7b-instruct-v0.2.Q4_K_M.gguf",
    "llama-3.2-3b-instruct.Q4_K_M.gguf",       # Smaller ~1.8GB
    "phi-3-mini-4k-instruct.Q4_K_M.gguf",      # Fastest ~2.2GB
]


NOTES_PROMPT_TEMPLATE = """You are an expert meeting analyst. You will receive a full meeting transcript and must produce extremely comprehensive, detailed meeting notes. Miss absolutely nothing important.

TRANSCRIPT:
{transcript}

---

Produce meeting notes in the following exact JSON structure. Be exhaustive — include every decision, action item, concern, question, and discussion point. Do not summarize away important details.

{{
  "meeting_summary": "2-4 sentence high-level summary of what this meeting was about and what was accomplished",
  "key_decisions": [
    {{
      "decision": "exact decision that was made",
      "made_by": "speaker name if known",
      "context": "why this decision was made",
      "timestamp": "HH:MM if mentioned"
    }}
  ],
  "action_items": [
    {{
      "task": "specific task to be done",
      "owner": "person responsible (or 'Unassigned')",
      "deadline": "deadline if mentioned, else null",
      "priority": "high/medium/low",
      "context": "why this task was created"
    }}
  ],
  "topics_discussed": [
    {{
      "topic": "topic name",
      "summary": "detailed summary of what was discussed",
      "participants": ["list of speakers who contributed"],
      "timestamp_start": "HH:MM",
      "outcome": "what was resolved or decided about this topic"
    }}
  ],
  "open_questions": [
    {{
      "question": "question that was raised but not resolved",
      "raised_by": "speaker if known",
      "context": "why this question matters"
    }}
  ],
  "concerns_raised": [
    {{
      "concern": "concern or risk that was mentioned",
      "raised_by": "speaker if known",
      "severity": "high/medium/low"
    }}
  ],
  "participants": [
    {{
      "name": "Speaker A / Speaker B / etc.",
      "role": "inferred role if possible",
      "key_contributions": "what this person contributed"
    }}
  ],
  "next_steps": "paragraph describing what happens next based on the meeting",
  "sentiment": "overall meeting tone: productive/tense/inconclusive/energetic/etc.",
  "keywords": ["list", "of", "key", "topics", "and", "terms"]
}}

Return ONLY the JSON object. No preamble, no explanation."""


class NotesGenerator:
    """
    Generates meeting notes using a local LLM via llama.cpp.
    Falls back to llama-cpp-python library if binary not found.
    """

    def __init__(self):
        self._llama_cpp_python = None
        self._use_python_fallback = not LLAMA_BIN.exists()
        self._model_path: Optional[Path] = None

        self._find_model()
        if self._use_python_fallback:
            self._init_llama_cpp_python()

    def _find_model(self):
        for model_name in PREFERRED_MODELS:
            path = MODELS_DIR / model_name
            if path.exists():
                self._model_path = path
                logger.info(f"Found LLM model: {model_name}")
                return
        logger.warning(f"No LLM model found in {MODELS_DIR} — notes generation unavailable")

    def _init_llama_cpp_python(self):
        try:
            from llama_cpp import Llama
            if self._model_path:
                self._llama_cpp_python = Llama(
                    model_path=str(self._model_path),
                    n_ctx=8192,
                    n_threads=os.cpu_count() or 4,
                    n_gpu_layers=-1,  # Use Metal GPU on Apple Silicon
                    verbose=False,
                )
                logger.info("llama-cpp-python loaded with Metal GPU acceleration")
        except ImportError:
            logger.warning("llama-cpp-python not installed")
        except Exception as e:
            logger.error(f"Failed to load llama-cpp-python: {e}")

    def _format_transcript(self, segments: list[dict]) -> str:
        """Convert transcript segments to readable text with timestamps and speakers."""
        lines = []
        for seg in segments:
            start = seg.get("start", 0)
            minutes = int(start // 60)
            seconds = int(start % 60)
            timestamp = f"{minutes:02d}:{seconds:02d}"
            speaker = seg.get("speaker", "Speaker A")
            text = seg.get("text", "").strip()
            if text:
                lines.append(f"[{timestamp}] {speaker}: {text}")
        return "\n".join(lines)

    async def generate_notes(self, transcript_segments: list[dict]) -> dict:
        """Generate comprehensive meeting notes from transcript segments."""
        if not self._model_path:
            return self._empty_notes("No LLM model available")

        transcript_text = self._format_transcript(transcript_segments)
        if not transcript_text.strip():
            return self._empty_notes("Empty transcript")

        prompt = NOTES_PROMPT_TEMPLATE.format(transcript=transcript_text)

        logger.info(f"Generating notes for transcript ({len(transcript_segments)} segments)...")

        if self._use_python_fallback and self._llama_cpp_python:
            return await self._generate_python(prompt)
        elif not self._use_python_fallback:
            return await self._generate_binary(prompt)
        else:
            return self._empty_notes("No inference backend available")

    async def _generate_binary(self, prompt: str) -> dict:
        cmd = [
            str(LLAMA_BIN),
            "-m", str(self._model_path),
            "--ctx-size", "8192",
            "--temp", "0.1",
            "--top-p", "0.9",
            "--repeat-penalty", "1.1",
            "-n", "4096",
            "--no-display-prompt",
            "-p", prompt,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            logger.error(f"llama.cpp error: {stderr.decode()[:500]}")
            return self._empty_notes("LLM inference failed")

        return self._parse_json_response(stdout.decode())

    async def _generate_python(self, prompt: str) -> dict:
        loop = asyncio.get_event_loop()

        def _run():
            response = self._llama_cpp_python(
                prompt,
                max_tokens=4096,
                temperature=0.1,
                top_p=0.9,
                repeat_penalty=1.1,
                stop=["```", "---END---"],
            )
            return response["choices"][0]["text"]

        try:
            text = await loop.run_in_executor(None, _run)
            return self._parse_json_response(text)
        except Exception as e:
            logger.error(f"llama-cpp-python inference error: {e}")
            return self._empty_notes(str(e))

    def _parse_json_response(self, text: str) -> dict:
        """Extract and parse JSON from LLM response."""
        # Find JSON block
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if not json_match:
            logger.error("No JSON found in LLM response")
            return self._empty_notes("Failed to parse LLM output")

        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            # Try to fix common issues
            raw = json_match.group()
            raw = re.sub(r',\s*}', '}', raw)
            raw = re.sub(r',\s*]', ']', raw)
            try:
                return json.loads(raw)
            except Exception:
                return self._empty_notes("Malformed LLM output")

    def _empty_notes(self, reason: str) -> dict:
        return {
            "meeting_summary": f"Notes unavailable: {reason}",
            "key_decisions": [],
            "action_items": [],
            "topics_discussed": [],
            "open_questions": [],
            "concerns_raised": [],
            "participants": [],
            "next_steps": "",
            "sentiment": "unknown",
            "keywords": [],
            "error": reason,
        }

    @property
    def is_available(self) -> bool:
        return self._model_path is not None and (
            (not self._use_python_fallback and LLAMA_BIN.exists()) or
            self._llama_cpp_python is not None
        )
