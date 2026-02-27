// ─────────────────────────────────────────────────────────────────────────────
// services/ai/image.js — Recipe image generation via OpenAI gpt-image-1
//
// Generates a photorealistic, gritty spaghetti western-style image of
// Cowboy Kent Rollins tasting the recipe he just cooked.
//
// Two-step process:
//   Step 1: GPT-4o-mini writes a detailed scene description from the recipe.
//           This produces better prompts than writing them manually.
//   Step 2: gpt-image-1 generates the image from that description.
//
// Unlike DALL-E 3, gpt-image-1 returns base64 PNG data (no URL).
// We save the PNG to a temp file and return the file path.
// The bot reads the file and attaches it directly to the Discord message.
//
// Why gpt-image-1 over DALL-E 3?
//   gpt-image-1 follows detailed style prompts much more reliably. It produces
//   genuinely photorealistic results and handles "gritty film photography" and
//   "spaghetti western" style directions that DALL-E 3 tends to ignore.
// ─────────────────────────────────────────────────────────────────────────────

// OpenAI's official JavaScript library.
const OpenAI = require('openai');

// Node.js built-ins for file I/O.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Where generated recipe images are saved before being sent to Discord.
// Kept separate from TTS files in /tmp/kentbot-tts for cleanliness.
const IMAGE_OUTPUT_DIR = '/tmp/kentbot-recipe';

// Create the output directory when this module first loads.
try {
  fs.mkdirSync(IMAGE_OUTPUT_DIR, { recursive: true });
  // recursive: true creates parent directories too and doesn't error if it exists.
} catch (err) {
  if (err.code !== 'EEXIST') {
    console.error('[IMAGE] Could not create output directory:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// generateRecipeImage(recipeText, personaName, personaRarity, userPrompt)
//
// Generates a photorealistic spaghetti western-style image of Kent tasting
// the generated recipe, then saves the PNG to a temp file.
//
// Returns: the absolute file path to the saved PNG (e.g. /tmp/kentbot-recipe/recipe-abc123.png)
//          Returns null if image generation fails (recipe still sends without image).
// ─────────────────────────────────────────────────────────────────────────────
async function generateRecipeImage(recipeText, personaName, personaRarity, userPrompt) {
  // If no API key is set, skip image generation silently.
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[IMAGE] OPENAI_API_KEY not set — skipping image generation');
    return null;
  }

  // Create the OpenAI client with the API key from the environment.
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // ── Step 1: Ask GPT-4o-mini to write a detailed scene description ─────
    // We give it specific style instructions so the description carries the
    // spaghetti western / gritty film photography aesthetic into DALL-E's prompt.
    console.log(`[IMAGE] Generating image prompt for: ${personaName} (${personaRarity})`);

    const promptResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',  // Fast, cheap model — just writing a description
      messages: [
        {
          role: 'system',
          // These instructions tell the AI exactly what kind of description to write.
          // The style keywords are the key difference from the old version:
          // we explicitly ask for gritty film photography, not smooth digital art.
          content:
            'You write a single detailed scene description for an image generator. ' +
            'The scene: Cowboy Kent Rollins (as the given character variant) tasting or sampling the dish he just cooked, reacting with obvious satisfaction — a bite or spoonful in progress, or licking the spoon. ' +
            'Style: photorealistic 35mm film photography, gritty spaghetti western, Sergio Leone cinematography, harsh dramatic side lighting, heavy film grain, desaturated warm earth tones, cracked leather and weathered wood textures, NOT smooth or digitally clean. ' +
            'The finished dish and main ingredients should be visible nearby. ' +
            'The scene must fill the entire wide frame edge to edge — no white borders or empty space on the sides. ' +
            'Keep it under 400 characters. No quotes or preamble, just the description.'
        },
        {
          role: 'user',
          // Give it the character and recipe context so the scene matches the output.
          content: `Character variant: "${personaName}" (${personaRarity}).\n\nRecipe:\n${recipeText.slice(0, 3000)}`
          // .slice(0, 3000) keeps us well under token limits.
        }
      ],
      max_tokens: 200  // We only need one descriptive sentence — 200 tokens is plenty
    });

    // Extract the scene description, with a fallback if the API returns nothing.
    const scenePart = promptResponse.choices[0]?.message?.content?.trim()
      || `Cowboy Kent Rollins as ${personaName} tasting ${userPrompt || 'a homemade dish'}, `
       + `ingredients visible on a rough wooden table, gritty spaghetti western photography, `
       + `35mm film grain, harsh side lighting, weathered textures.`;

    // Append style reinforcement — gpt-image-1 responds well to repeated style cues.
    const imagePrompt = (
      `${scenePart} ` +
      `Photorealistic 35mm film grain, spaghetti western cinematography, harsh dramatic lighting, ` +
      `fills entire wide frame edge to edge, no borders.`
    ).slice(0, 3900);
    // .slice(0, 3900) stays under the 4000 character prompt limit.

    // ── Step 2: Generate the image with gpt-image-1 ──────────────────────
    console.log('[IMAGE] Calling gpt-image-1...');

    const imageResponse = await openai.images.generate({
      model: 'gpt-image-1',    // OpenAI's best image model — far better at style and realism than DALL-E 3
      prompt: imagePrompt,
      size: '1536x1024',       // Wide landscape — fits Discord embeds nicely
      quality: 'medium',       // 'low' / 'medium' / 'high' — medium is fast and looks great
      n: 1                     // Generate one image
    });

    // gpt-image-1 returns base64-encoded PNG data (not a URL like DALL-E 3 did).
    const b64 = imageResponse.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('gpt-image-1 returned no image data');
    }

    // Decode the base64 string into raw bytes and save to a file.
    const uniqueId = crypto.randomBytes(8).toString('hex');
    // crypto.randomBytes(8).toString('hex') = 16-char random hex like "a3f9c12b7e004d1a"
    const imagePath = path.join(IMAGE_OUTPUT_DIR, `recipe-${uniqueId}.png`);
    fs.writeFileSync(imagePath, Buffer.from(b64, 'base64'));
    // Buffer.from(b64, 'base64') decodes the base64 string to raw bytes.
    // writeFileSync() writes those bytes to disk as a PNG file.

    console.log(`[IMAGE] Image saved: ${imagePath}`);
    return imagePath;  // The bot reads this file and attaches it to Discord

  } catch (err) {
    // Image failure is non-fatal — the recipe still sends without a picture.
    console.error('[IMAGE] Image generation failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// cleanupOldImages()
//
// Deletes recipe PNG files older than 1 hour to prevent /tmp from filling up.
// Called every 30 minutes automatically.
// ─────────────────────────────────────────────────────────────────────────────
function cleanupOldImages() {
  try {
    const files = fs.readdirSync(IMAGE_OUTPUT_DIR);
    const oneHourAgo = Date.now() - (60 * 60 * 1000);  // 1 hour in milliseconds

    for (const file of files) {
      const filePath = path.join(IMAGE_OUTPUT_DIR, file);
      const stats = fs.statSync(filePath);
      // stats.mtimeMs = last modified time in milliseconds
      if (stats.mtimeMs < oneHourAgo) {
        fs.unlinkSync(filePath);  // Delete files older than 1 hour
      }
    }
  } catch (err) {
    console.warn('[IMAGE] Cleanup error:', err.message);
  }
}

// Run cleanup every 30 minutes.
setInterval(cleanupOldImages, 30 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Export for use by the AI service HTTP server
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  generateRecipeImage  // Generates a recipe image and returns a local file path
};
