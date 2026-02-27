// ─────────────────────────────────────────────────────────────────────────────
// shared/config.js — Central configuration for all three bot processes
//
// This file is imported by the bot, the music service, and the AI service.
// It holds all the tunable settings in one place so you only have to change
// something once and it affects everywhere it matters.
//
// Think of this like the control panel for the whole bot.
// ─────────────────────────────────────────────────────────────────────────────

// Load the .env file so all process.env.XXX values are available.
// This MUST be the first thing that runs so environment variables are ready.
require('dotenv').config();

// ── Service Network Settings ──────────────────────────────────────────────────
// These are the ports the music and AI services listen on.
// The bot process calls these services over HTTP to ask for help.
const MUSIC_SERVICE_PORT = parseInt(process.env.MUSIC_SERVICE_PORT || '3001', 10);
// parseInt() converts a string like "3001" to the number 3001.
// The second argument (10) tells it to use base-10 (normal decimal numbers).
// The "|| '3001'" part is a fallback: if the env var isn't set, use 3001.

const AI_SERVICE_PORT = parseInt(process.env.AI_SERVICE_PORT || '3002', 10);
// Same pattern as above, defaulting to port 3002.

// Build the full URLs the bot uses to talk to each service.
// 'localhost' means "this same computer" — all three processes run on one machine.
const MUSIC_SERVICE_URL = `http://localhost:${MUSIC_SERVICE_PORT}`;
// Template literals (backtick strings with ${}) let us build URLs easily.
// This produces something like: "http://localhost:3001"

const AI_SERVICE_URL = `http://localhost:${AI_SERVICE_PORT}`;
// Produces something like: "http://localhost:3002"

// ── DJ Feature Settings ───────────────────────────────────────────────────────
const DJ = {
  // Whether the DJ intro feature is on by default when the bot starts.
  // Users can toggle it with /dj on or /dj off.
  ENABLED: true
};

// ── Now Playing Embed Settings ────────────────────────────────────────────────
const EMBED = {
  // How many segments wide the progress bar is.
  // Example with 14 segments: ▬▬▬▬▬🔘▬▬▬▬▬▬▬▬
  PROGRESS_BAR_LENGTH: 14,

  // Whether to show the total time of all queued songs at the bottom.
  SHOW_TOTAL_QUEUE: true,

  // Whether to show how long each song is next to its title.
  SHOW_SONG_LENGTH: true,

  // Whether to show the animated progress bar while a song is playing.
  SHOW_PROGRESS_BAR: true
};

// ── Ollama (Local LLM) Settings ───────────────────────────────────────────────
const OLLAMA = {
  // The web address of the Ollama server running on this computer.
  // Ollama starts a small web server on port 11434 when you run it.
  URL: process.env.OLLAMA_URL || 'http://localhost:11434',

  // Which AI model Ollama should use.
  // llama3.2:3b is fast on CPU, good quality for recipes and short text.
  MODEL: process.env.OLLAMA_MODEL || 'llama3.2:3b'
};

// ── TTS (Text-to-Speech) Settings ─────────────────────────────────────────────
const TTS = {
  // Which TTS provider to use: 'local' (Coqui XTTS v2) or 'elevenlabs' (cloud API).
  // Use 'local' on powerful hardware (6GB+ VRAM or fast CPU).
  // Use 'elevenlabs' for fast, high-quality cloud synthesis (requires API key).
  PROVIDER: process.env.TTS_PROVIDER || 'local',

  // ── Local XTTS v2 settings (only used when PROVIDER = 'local') ──────────────
  // Path to the voice sample .wav file that XTTS will clone the voice from.
  // The file should be clear audio with no background noise, at least 6 seconds.
  VOICE_SAMPLE: process.env.TTS_VOICE_SAMPLE || 'voice-samples/kent.wav',

  // ── ElevenLabs settings (only used when PROVIDER = 'elevenlabs') ────────────
  // Your ElevenLabs API key from https://elevenlabs.io/
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',

  // The voice ID to use. Find IDs in your ElevenLabs voice library, or use
  // a pre-made voice. Example: 'JBFqnCBsd6RMkjVDRZzb' is "George" (deep, warm).
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || '',

  // ElevenLabs model ID. 'eleven_flash_v2_5' is the fastest (lowest latency),
  // good for DJ intros. 'eleven_multilingual_v2' is highest quality but slower.
  ELEVENLABS_MODEL: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',

  // Where generated TTS audio files are saved before being played.
  // /tmp is a temporary folder that the OS cleans up automatically.
  OUTPUT_DIR: '/tmp/kentbot-tts'
};

// ── Export everything so other files can import what they need ─────────────────
// module.exports is how CommonJS JavaScript shares code between files.
// Any file that does  require('./shared/config')  gets this object back.
module.exports = {
  MUSIC_SERVICE_PORT, // The port number for the music service
  AI_SERVICE_PORT,    // The port number for the AI service
  MUSIC_SERVICE_URL,  // The full URL to call the music service
  AI_SERVICE_URL,     // The full URL to call the AI service
  DJ,                 // DJ feature settings
  EMBED,              // Now Playing embed display settings
  OLLAMA,             // Local LLM (Ollama) settings
  TTS                 // Text-to-speech settings
};
