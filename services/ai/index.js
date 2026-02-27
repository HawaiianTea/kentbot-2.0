// ─────────────────────────────────────────────────────────────────────────────
// services/ai/index.js — The AI Service HTTP Server
//
// This file is Process 3 in our three-process bot architecture.
// It runs as a completely separate program from both the Discord bot and the
// music service.
//
// What it does:
//   It starts a small web server on port 3002 that the bot can call with HTTP
//   requests. It handles all AI tasks:
//     • Text generation (recipes, DJ intros) via Ollama (local LLM)
//     • Image generation for recipes via OpenAI DALL-E (cloud)
//     • Text-to-speech via Coqui XTTS v2 (local Python script)
//
// Why separate?
//   AI tasks are slow and unpredictable. Ollama might be starting up,
//   XTTS might take 30 seconds to load the model, DALL-E might timeout.
//   If any of this happens, only THIS process is affected. The Discord bot
//   and music playback keep running normally and show friendly error messages.
//
// Think of it like a production kitchen:
//   The dining room (Discord bot) and the pantry (music service) stay open
//   even if the chef's station (AI service) has a moment.
// ─────────────────────────────────────────────────────────────────────────────

// Express is the HTTP server framework.
const express = require('express');

// Import our AI module functions.
const { generateRecipe, generateDJIntro } = require('./llm');   // Text generation
const { generateRecipeImage } = require('./image');              // Image generation
const { synthesize } = require('./tts');                         // Text-to-speech

// Import shared config to know which port to listen on.
const { AI_SERVICE_PORT } = require('../../shared/config');

// Create the Express application.
const app = express();

// Parse incoming JSON request bodies automatically.
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// GET /health
//
// Health check endpoint. Returns "ok" if the service is running.
// Also checks if Ollama is reachable and reports its status.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  // Check if Ollama is responding.
  let ollamaStatus = 'unknown';
  try {
    const { OLLAMA } = require('../../shared/config');
    // Try to reach Ollama's root endpoint — just checking if it's running.
    const ollamaRes = await fetch(`${OLLAMA.URL}/api/tags`);
    // /api/tags lists available models. If it responds, Ollama is up.
    ollamaStatus = ollamaRes.ok ? 'ok' : 'error';
  } catch {
    ollamaStatus = 'offline';  // fetch() throws if the connection is refused
  }

  res.json({
    status: 'ok',              // This service is running
    ollama: ollamaStatus       // Whether Ollama is reachable
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /recipe
//
// Generates a cooking recipe using the local LLM and a DALL-E image.
//
// Request body (JSON): { prompt: "spicy cowboy chili" }
//   prompt — what the user typed after /cook
//
// Returns (JSON): { text, rarity, name, imageUrl }
//   text     — the full recipe text from the LLM
//   rarity   — persona rarity for styling the Discord embed
//   name     — persona display name for the embed title
//   imageUrl — DALL-E generated image URL (or null if unavailable)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/recipe', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    console.log(`[AI] Recipe request: "${prompt}"`);

    // Generate recipe text with the LLM. This is the slow part (~30-60 seconds).
    // We run text generation and image generation in parallel using Promise.all()
    // to save time — both start at the same time and we wait for both to finish.
    const [recipeResult, imageUrl] = await Promise.all([
      // generateRecipe() calls Ollama with a random Kent persona
      generateRecipe(prompt),

      // generateRecipeImage() is called with placeholder values for now.
      // We'll update the image call after we have the recipe text.
      // For now this returns null (image is generated after recipe finishes).
      Promise.resolve(null)
    ]);
    // Promise.all([a, b]) starts both a and b simultaneously and waits for BOTH.
    // When both finish, it returns [resultA, resultB].
    // This is faster than doing them sequentially (one after the other).

    // Now generate the image using the actual recipe text (better prompt quality).
    // We do this separately because we need recipeResult.text for the image prompt.
    let finalImageUrl = imageUrl;  // Currently null from above
    try {
      finalImageUrl = await generateRecipeImage(
        recipeResult.text,     // The recipe text for context
        recipeResult.name,     // The persona name (e.g. "Caveman Cowboy Kent")
        recipeResult.rarity,   // The rarity (e.g. "Epic")
        prompt                 // The original user request
      );
    } catch (imgErr) {
      // Image failure is non-fatal. Recipe still sends without image.
      console.warn('[AI] Image generation failed (non-fatal):', imgErr.message);
    }

    // Send back all the data the bot needs to build the Discord embed.
    // imagePath is a local file path (e.g. /tmp/kentbot-recipe/recipe-abc123.png).
    // The bot reads this file and attaches it directly to the Discord message.
    res.json({
      text: recipeResult.text,
      rarity: recipeResult.rarity,
      name: recipeResult.name,
      imagePath: finalImageUrl   // null if image generation failed, otherwise a file path
    });

  } catch (err) {
    console.error('[AI] Recipe generation failed:', err.message);
    // 503 = "Service Unavailable" — appropriate when Ollama is down or overloaded
    res.status(503).json({
      error: err.message,
      hint: 'Make sure Ollama is running: ollama serve'
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /dj-intro
//
// Generates a short DJ-style introduction for a song.
// Used right before a song plays when DJ mode is enabled.
//
// Request body (JSON): { title: "Never Gonna Give You Up", artist: "Rick Astley" }
//   title  — the song title
//   artist — the artist name (optional, may not always be available)
//
// Returns (JSON): { text }
//   text — the intro speech text (short, ~40-50 words)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/dj-intro', async (req, res) => {
  try {
    const { title, artist } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    // Build the song description string.
    // If we have both title and artist, use both. Otherwise just the title.
    const songDesc = artist ? `${title} by ${artist}` : title;

    // Generate the intro text using the LLM.
    const text = await generateDJIntro(songDesc);

    res.json({ text });

  } catch (err) {
    console.error('[AI] DJ intro generation failed:', err.message);
    // Return a fallback intro so music still plays even if this fails.
    // We still use 200 OK status because a fallback response IS a valid response.
    res.json({
      text: `Well howdy there, partners! Here comes a mighty fine tune — let's get this party started!`
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /tts
//
// Converts text to speech audio using XTTS v2 voice cloning.
// Returns the path to the generated .wav file that the bot can play.
//
// Request body (JSON): { text: "Well howdy there, partners!" }
//   text — the text to speak
//
// Returns (JSON): { audioFilePath }
//   audioFilePath — absolute path to the generated .wav file
//                   e.g. "/tmp/kentbot-tts/tts-abc123.wav"
// ─────────────────────────────────────────────────────────────────────────────
app.post('/tts', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    console.log(`[AI] TTS request: "${text.slice(0, 50)}..."`);

    // Run XTTS synthesis. This can take 5-15 seconds depending on hardware.
    const audioFilePath = await synthesize(text);

    res.json({ audioFilePath });

  } catch (err) {
    console.error('[AI] TTS synthesis failed:', err.message);
    res.status(503).json({
      error: err.message,
      hint: 'Ensure python3 is installed and TTS is installed: pip install TTS'
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Start the server
// ─────────────────────────────────────────────────────────────────────────────
app.listen(AI_SERVICE_PORT, () => {
  console.log(`[AI SERVICE] Running on port ${AI_SERVICE_PORT}`);
  console.log(`[AI SERVICE] Health check: http://localhost:${AI_SERVICE_PORT}/health`);
  console.log(`[AI SERVICE] Using Ollama model: ${require('../../shared/config').OLLAMA.MODEL}`);
  const { TTS } = require('../../shared/config');
  console.log(`[AI SERVICE] TTS provider: ${TTS.PROVIDER}`);
  if (TTS.PROVIDER === 'local') {
    console.log(`[AI SERVICE] TTS voice sample: ${TTS.VOICE_SAMPLE}`);
  } else if (TTS.PROVIDER === 'elevenlabs') {
    console.log(`[AI SERVICE] ElevenLabs voice ID: ${TTS.ELEVENLABS_VOICE_ID || '(not set)'}`);
    console.log(`[AI SERVICE] ElevenLabs model: ${TTS.ELEVENLABS_MODEL}`);
  }
});
