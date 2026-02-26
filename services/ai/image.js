// ─────────────────────────────────────────────────────────────────────────────
// services/ai/image.js — Recipe image generation via OpenAI DALL-E
//
// This file handles generating images for the /cook recipe command.
// It uses OpenAI's DALL-E 3 model, which is a cloud service (not local).
//
// Why keep this one as cloud instead of local?
//   Local image generation (Stable Diffusion) requires at least 6GB of VRAM.
//   The bot's GTX 660 Ti only has 2GB, so it can't run SD at acceptable speed.
//   DALL-E 3 produces excellent results and the per-image cost is low (~$0.04).
//
// The image shows a scene of the specific Kent variant character cooking the
// dish that was generated, with ingredients on display.
// ─────────────────────────────────────────────────────────────────────────────

// OpenAI's official JavaScript library for calling the DALL-E API.
const OpenAI = require('openai');

// ─────────────────────────────────────────────────────────────────────────────
// generateRecipeImage(recipeText, personaName, personaRarity, userPrompt)
//
// Generates an image of the Kent Rollins character cooking the recipe.
//
// The process is two steps:
//   Step 1: Ask GPT-4o-mini to write a detailed scene description
//           (better than writing the DALL-E prompt ourselves)
//   Step 2: Send that scene description to DALL-E 3 to generate the image
//
// Returns the image URL as a string, or null if image generation failed.
// ─────────────────────────────────────────────────────────────────────────────
async function generateRecipeImage(recipeText, personaName, personaRarity, userPrompt) {
  // Check that the OpenAI API key is configured.
  // process.env reads environment variables set in the .env file.
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[IMAGE] OPENAI_API_KEY not set — skipping image generation');
    return null; // null tells the caller "no image this time"
  }

  // Create a new OpenAI client using the API key from environment variables.
  // The 'new' keyword creates a new instance of the OpenAI class.
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // ── Step 1: Generate a detailed image prompt using GPT-4o-mini ────────
    // We ask a small, fast AI to write the DALL-E prompt for us.
    // This produces much better image descriptions than writing them manually.
    console.log(`[IMAGE] Generating image prompt for: ${personaName} (${personaRarity})`);

    const promptResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',   // Small, fast, cheap model — perfect for prompt generation
      messages: [
        {
          role: 'system',
          // Tell the AI exactly what kind of description we want.
          // The instructions prevent white borders (common DALL-E issue with portraits).
          content: 'You write a single, detailed sentence for an image generator. Describe a scene: Cowboy Kent Rollins (as the given character variant) cooking the dish from the recipe, with the main ingredients and finished dish visible on display (counter, table, etc.). The scene must fill the entire wide frame edge to edge with no white borders, empty space, or pillarboxing on the sides. Keep it under 350 characters. No quotes or preamble, just the image description.'
        },
        {
          role: 'user',
          // Give it the character info and the recipe to describe.
          // .slice(0, 3000) limits the recipe text to 3000 characters to avoid token limits.
          content: `Character variant: "${personaName}" (${personaRarity}).\n\nRecipe:\n${recipeText.slice(0, 3000)}`
        }
      ],
      max_tokens: 150   // Keep the prompt short — we just need one descriptive sentence
    });

    // Extract the generated prompt text from the API response.
    // The ?. "optional chaining" operator prevents errors if the response is malformed.
    const scenePart = promptResponse.choices[0]?.message?.content?.trim()
      || `Cowboy Kent Rollins as ${personaName} cooking ${userPrompt || 'a homemade dish'}, with ingredients on display, rustic kitchen, warm lighting.`;
    // The || provides a fallback in case the API returned nothing.

    // Build the final DALL-E prompt.
    // We append instructions about frame filling to combat DALL-E's white border habit.
    // .slice(0, 3900) ensures we stay under DALL-E's 4000 character prompt limit.
    const dallePrompt = `${scenePart}. Fills the entire wide frame edge to edge, no white borders or empty space on the sides.`.slice(0, 3900);

    // ── Step 2: Generate the actual image with DALL-E 3 ──────────────────
    console.log('[IMAGE] Calling DALL-E 3...');

    const imageResponse = await openai.images.generate({
      model: 'dall-e-3',           // Use the high-quality DALL-E 3 model
      prompt: dallePrompt,         // The scene description we just built
      size: '1792x1024',           // Wide landscape format (fits Discord nicely)
      response_format: 'url',      // Get back a URL to the generated image
      n: 1,                        // Generate 1 image
      quality: 'standard'          // 'standard' costs less than 'hd', still looks great
    });

    // Extract the image URL from the response.
    const imageUrl = imageResponse.data?.[0]?.url;

    if (!imageUrl) {
      throw new Error('DALL-E returned no image URL');
    }

    console.log('[IMAGE] Image generated successfully');
    return imageUrl;   // Return the URL string — Discord embeds can display this directly

  } catch (err) {
    // Image generation is "nice to have" — if it fails, the recipe still works.
    // Log the error but return null so the caller can send the recipe without an image.
    console.error('[IMAGE] Image generation failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export for use by the AI service HTTP server
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  generateRecipeImage
};
