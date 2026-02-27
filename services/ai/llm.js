// ─────────────────────────────────────────────────────────────────────────────
// services/ai/llm.js — Local LLM text generation via Ollama
//
// This file handles all communication with Ollama, the local AI model runner.
// Ollama runs on your computer and serves AI models through a simple HTTP API.
//
// We use it for two things:
//   1. Generating recipes in the style of Cowboy Kent Rollins (/cook command)
//   2. Generating DJ intro speech before each song plays
//
// Ollama's API is designed to look like OpenAI's API — so the request format
// is very similar to what cloud AI services use, but all the work happens
// locally on your computer with no cost or internet required.
//
// Setup: Make sure Ollama is running: `ollama serve`
//        And the model is downloaded: `ollama pull llama3.2:3b`
// ─────────────────────────────────────────────────────────────────────────────

// fs = File System module, built into Node.js.
// We use it to read the system_prompts.txt file for recipe personas.
const fs = require('fs');

// path helps build file paths correctly regardless of the operating system.
const path = require('path');

// Import the Ollama URL and model name from shared config.
const { OLLAMA } = require('../../shared/config');

// ─────────────────────────────────────────────────────────────────────────────
// getRandomPersona()
//
// Loads the system_prompts.txt file and randomly picks a Kent Rollins persona
// to use for recipe generation. Different personas have different rarities,
// so rarer ones appear less frequently (like random drops in a game).
//
// Returns an object: { prompt, rarity, name }
//   prompt  — the full instruction text to give the AI about who it is
//   rarity  — "Common", "Uncommon", "Rare", "Epic", or "Legendary"
//   name    — the persona's display name (e.g. "Caveman Cowboy Kent Rollins")
// ─────────────────────────────────────────────────────────────────────────────
function getRandomPersona() {
  try {
    // Build the path to system_prompts.txt.
    // __dirname is a special variable that holds the folder this file is in.
    // path.join() builds a file path by connecting folder names with / or \.
    // We go up two folders (../../) from services/ai/ to reach the project root.
    const promptsPath = path.join(__dirname, '../../system_prompts.txt');

    // Read the entire file as a UTF-8 text string.
    const data = fs.readFileSync(promptsPath, 'utf8');
    // readFileSync = read the file right now and wait (synchronous).
    // 'utf8' = decode the raw bytes as text using the UTF-8 standard.

    // The file uses "---" lines to separate different persona entries.
    // .split() cuts the string at each "---" separator.
    // .map() transforms each piece: .trim() removes surrounding whitespace.
    // .filter(Boolean) removes any empty strings (from blank lines).
    const entries = data.split(/---+/).map(p => p.trim()).filter(Boolean);

    // Parse each entry into a structured object.
    // Each entry looks like: "Rarity|Name|Prompt text..."
    const personas = entries.map(entry => {
      // Split on | to get the three parts.
      const parts = entry.split('|');

      if (parts.length >= 3) {
        return {
          rarity: parts[0].trim(),                   // e.g. "Common"
          name: parts[1].trim(),                     // e.g. "Cowboy Kent Rollins"
          prompt: parts.slice(2).join('|').trim()    // Everything after the second | is the prompt
          // parts.slice(2) gets all parts from index 2 onward.
          // .join('|') rejoins them with | in case the prompt itself contained a |.
        };
      }
      // Malformed entry — use safe defaults.
      return { rarity: 'Common', name: 'Classic Kent', prompt: entry };
    });

    if (personas.length === 0) throw new Error('No personas found in system_prompts.txt');

    // Weighted random selection based on rarity.
    // Rarer rarities have lower weights so they appear less often.
    // The weights are like putting entries in a hat: 40 copies of Common,
    // 30 of Uncommon, 20 of Rare, 8 of Epic, and 1.5 of Legendary.
    const rarityWeights = {
      'Common': 40,       // Very common — appears most often
      'Uncommon': 30,     // Shows up fairly regularly
      'Rare': 20,         // Less common
      'Epic': 8,          // Quite rare
      'Legendary': 1.5    // Very rare, exciting when it appears!
    };

    // Build a weighted pool by repeating each persona based on its weight.
    // The more weight, the more copies in the pool, so it's more likely to be picked.
    const weightedPool = [];
    for (const persona of personas) {
      const weight = rarityWeights[persona.rarity] || 1; // Default weight 1 if unknown rarity
      // Use Math.round() to handle decimal weights like 1.5.
      const copies = Math.round(weight);
      for (let i = 0; i < copies; i++) {
        weightedPool.push(persona); // Add 'copies' copies of this persona to the pool
      }
    }

    // Pick a random entry from the weighted pool.
    // Math.random() returns a number between 0 and 1.
    // Multiplying by pool length and using Math.floor() gives a random valid index.
    const selected = weightedPool[Math.floor(Math.random() * weightedPool.length)];
    return selected;

  } catch (err) {
    // If the file can't be read, fall back to a default persona.
    console.warn('[LLM] Could not load system_prompts.txt, using default persona:', err.message);
    return {
      prompt: "You are Cowboy Kent Rollins. Make a recipe based on the user's prompt. Speak naturally and conversationally, no bullet points or headers.",
      rarity: 'Common',
      name: 'Cowboy Kent Rollins'
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// callOllama(systemPrompt, userMessage)
//
// The core function that actually calls the Ollama API to generate text.
//
// Parameters:
//   systemPrompt — instructions that tell the AI what character it's playing
//                  (e.g. "You are Cowboy Kent Rollins, a chef who...")
//   userMessage  — what the user asked for (e.g. "make me a spicy chili recipe")
//
// Returns the AI's text response as a string.
// ─────────────────────────────────────────────────────────────────────────────
async function callOllama(systemPrompt, userMessage) {
  // fetch() is a built-in function for making HTTP requests.
  // We POST to Ollama's /api/chat endpoint with JSON data.
  const response = await fetch(`${OLLAMA.URL}/api/chat`, {
    method: 'POST',  // POST = we're sending data to the server (not just reading)

    // headers tell the server what format our data is in.
    headers: { 'Content-Type': 'application/json' },

    // The request body — what we're sending to Ollama.
    // JSON.stringify() converts a JavaScript object to a JSON text string.
    body: JSON.stringify({
      model: OLLAMA.MODEL,     // Which AI model to use (e.g. "llama3.2:3b")
      stream: false,           // false = wait for the full response, don't stream it word by word
      messages: [
        // The "messages" array follows the chat format used by many AI APIs.
        // "system" role = background instructions for the AI
        { role: 'system', content: systemPrompt },
        // "user" role = the actual request we're making
        { role: 'user', content: userMessage }
      ]
    })
  });

  // Check if Ollama returned an error HTTP status code.
  if (!response.ok) {
    // Read the response body to get the actual error message from Ollama.
    // A 404 usually means the model name doesn't match — e.g. pulled llama3.2:latest
    // but config says llama3.2:3b. The body will say exactly what's wrong.
    const errorBody = await response.text().catch(() => '(no response body)');
    throw new Error(`Ollama HTTP ${response.status}: ${errorBody} — check that model "${OLLAMA.MODEL}" is pulled (run: ollama list)`);
  }

  // Parse the JSON response body.
  // .json() reads the response body and converts the JSON text to a JavaScript object.
  const data = await response.json();

  // The response is nested: data.message.content holds the actual text.
  // The ?. is "optional chaining" — if data.message doesn't exist, return undefined
  // instead of throwing an error. The || '' fallback ensures we return a string.
  return data?.message?.content || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// generateRecipe(prompt)
//
// Generates a cooking recipe in the style of a random Kent Rollins persona.
//
// Parameters:
//   prompt — what kind of recipe the user wants (e.g. "spicy cowboy chili")
//
// Returns: { text, rarity, name }
//   text   — the full recipe text
//   rarity — the persona rarity (for embed styling)
//   name   — the persona name (for embed title)
// ─────────────────────────────────────────────────────────────────────────────
async function generateRecipe(prompt) {
  // Pick a random persona (Kent variant).
  const persona = getRandomPersona();

  // 30% chance to add a fun insult toward "Jason" — keeping the joke from the old bot.
  // Math.random() < 0.3 is true about 30% of the time.
  let userPrompt = prompt;
  if (Math.random() < 0.3) {
    userPrompt += '\nAlso, please include some insults directed at your mortal enemy Jason somewhere in your response. He is a jerk and a loser.';
  }

  console.log(`[LLM] Generating recipe: persona="${persona.name}" rarity="${persona.rarity}"`);

  // Call Ollama with the persona as the system prompt.
  const text = await callOllama(persona.prompt, userPrompt);

  return {
    text: text.trim(),   // .trim() removes leading/trailing whitespace from the response
    rarity: persona.rarity,
    name: persona.name
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateDJIntro(songTitle)
//
// Generates a short, enthusiastic radio DJ introduction for a song.
// Uses the same Ollama model, but with a DJ-focused system prompt.
//
// Parameters:
//   songTitle — the name of the song about to play
//
// Returns: the intro text as a string (kept short for TTS — about 10-15 seconds)
// ─────────────────────────────────────────────────────────────────────────────
async function generateDJIntro(songTitle) {
  const systemPrompt = `You are Cowboy Kent Rollins, a charismatic radio DJ with a warm, friendly personality. You love sharing interesting facts and getting people excited about music. You speak in a southern accent and say things like "well howdy" and "y'all".`;

  const userPrompt = `Introduce the song "${songTitle}" with an interesting trivia fact about the song or artist. Include the song title and artist. Keep it SHORT — under 12 seconds when spoken aloud (about 40-50 words maximum). Be enthusiastic and fun!`;

  console.log(`[LLM] Generating DJ intro for: "${songTitle}"`);

  try {
    const text = await callOllama(systemPrompt, userPrompt);
    return text.trim();
  } catch (err) {
    // If Ollama fails, return a fallback intro so music still plays.
    console.error('[LLM] Failed to generate DJ intro, using fallback:', err.message);
    return `Well howdy there, partners! I've got a mighty fine tune coming up for y'all. It's called "${songTitle}" and I reckon you're gonna love it. Let's get this party started!`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export functions for use by the AI service HTTP server
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  generateRecipe,  // Generate a recipe with persona → { text, rarity, name }
  generateDJIntro  // Generate a DJ intro for a song → string
};
