# ◈ Aurelius

**Open-source AI meeting notetaker for macOS — fully local, no API keys, no cloud.**

Everything runs on your Mac. Your audio never leaves your device.

![Aurelius Screenshot](resources/screenshot.png)

---

## Features

- 🎙 **Auto-records meetings** from Google Calendar or manually
- 📝 **Real-time transcription** via whisper.cpp (Apple Silicon optimized)
- 👥 **Speaker identification** — knows who said what
- 🧠 **AI-generated notes** — summaries, decisions, action items, open questions, risks
- 🔒 **100% local** — Whisper + Mistral/LLaMA run entirely on-device
- 🖥 **Native macOS app** — lives in your menu bar, detects meetings automatically

---

## How It Works

```
Audio (mic + system) → whisper.cpp → Transcript
                                          ↓
                              pyannote (speaker labels)
                                          ↓
                              llama.cpp (Mistral 7B)
                                          ↓
                              Notes, actions, decisions
```

All models run locally via compiled C++ binaries. No API key. No subscription.

---

## Requirements

- macOS 12+ (Monterey or later)
- Apple Silicon or Intel Mac
- ~6 GB free disk space (for models)
- Microphone access

---

## Installation (Pre-built DMG)

1. Download `Aurelius-x.x.x.dmg` from [Releases](https://github.com/your-org/aurelius/releases)
2. Drag **Aurelius** to your Applications folder
3. Open Aurelius — it will guide you through first-time setup:
   - Downloads Whisper model (~74MB)
   - Downloads LLM model (~1.8–4GB, one-time)
   - Installs BlackHole audio driver (requires admin password once)
4. (Optional) Connect your Google Calendar
5. Done — Aurelius will auto-detect meetings and start recording

---

## Build from Source

### Prerequisites

```bash
brew install cmake python3 node git
pip3 install pyinstaller
```

### Steps

```bash
# 1. Clone
git clone https://github.com/your-org/aurelius
cd aurelius

# 2. Build whisper.cpp and llama.cpp binaries
chmod +x scripts/build_binaries.sh
./scripts/build_binaries.sh

# 3. Download model weights
chmod +x scripts/download_models.sh
./scripts/download_models.sh          # ~2GB (LLaMA 3.2 3B)
./scripts/download_models.sh large    # ~5GB (Mistral 7B, better quality)

# 4. Bundle Python backend
pip3 install -r backend/requirements.txt
pyinstaller aurelius-backend.spec

# 5. Install frontend deps and build
cd frontend && npm install

# 6. Run in development
npm run dev

# 7. Build distributable DMG
npm run dist:mac
```

The DMG will be at `frontend/dist/Aurelius-x.x.x.dmg`.

---

## Project Structure

```
aurelius/
├── frontend/                     # Electron + React frontend
│   └── src/
│       ├── components/           # Layout, sidebar
│       ├── pages/                # Dashboard, MeetingDetail, RecordingPage, SetupFlow
│       ├── store/                # Zustand state management
│       └── hooks/                # API client, WebSocket
│
├── backend/                      # Python FastAPI backend
│   ├── audio/capture.py          # CoreAudio + BlackHole capture
│   ├── transcription/            # whisper.cpp wrapper
│   ├── diarization/              # pyannote-audio speaker ID
│   ├── notes/generator.py        # llama.cpp notes generation
│   ├── calendar_sync/            # Google Calendar OAuth + polling
│   ├── db/database.py            # SQLite storage
│   └── routes/                   # FastAPI routes
│
├── resources/
│   ├── bin/                      # Compiled whisper-cpp, llama-cli (gitignored)
│   ├── models/                   # Model weights (gitignored)
│   └── drivers/                  # BlackHole.pkg (bundled in DMG)
│
└── scripts/
    ├── build_binaries.sh         # Compile C++ binaries
    └── download_models.sh        # Download model weights
```

---

## Google Calendar Setup

Aurelius uses Google Calendar to auto-detect meetings. To enable:

1. Click "Connect Calendar" in the app
2. Authorize in your browser
3. Aurelius will alert you 2 minutes before any meeting and offer to start recording

To use your own OAuth credentials (for forks/contributors):
1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the Google Calendar API
3. Create OAuth 2.0 credentials (Desktop app)
4. Save as `~/.aurelius/google_credentials.json`

---

## Models Used

| Purpose | Model | Size | Quality |
|---------|-------|------|---------|
| Transcription | Whisper base.en | 74 MB | Good |
| Transcription (optional) | Whisper large-v3 | 1.5 GB | Excellent |
| Notes generation | LLaMA 3.2 3B Q4 | 1.8 GB | Good |
| Notes generation | Mistral 7B Q4 | 4.1 GB | Excellent |
| Speaker ID | pyannote 3.1 | 200 MB | Good |

All models are open-source and run via llama.cpp / faster-whisper.

---

## Contributing

Aurelius is MIT licensed and welcomes contributions.

```bash
# Run tests
cd backend && python -m pytest tests/

# Frontend dev
cd frontend && npm run dev
```

Areas to contribute:
- Zoom/Teams/Meet auto-join detection
- Export to Notion/Obsidian/Linear
- Better speaker name assignment UI
- Windows/Linux support

---

## Privacy

- **No telemetry** — Aurelius collects nothing
- **No cloud** — all processing is local
- **No API keys** — no accounts required
- Recordings stored in `~/.aurelius/recordings/`
- To delete everything: `rm -rf ~/.aurelius`

---

## License

MIT — see [LICENSE](LICENSE)
