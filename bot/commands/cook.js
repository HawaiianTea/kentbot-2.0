// ─────────────────────────────────────────────────────────────────────────────
// bot/commands/cook.js — The /cook slash command
//
// This is the recipe generation command. When a user types /cook "spicy chili",
// the bot asks the AI service to generate a recipe using a local LLM (Ollama)
// in the style of a randomly chosen Cowboy Kent Rollins character variant.
// It also generates an image using DALL-E.
//
// Flow:
//   1. User types: /cook spicy cowboy chili
//   2. Bot defers the reply (because this will take ~45 seconds)
//   3. Bot sends a POST request to the AI service's /recipe endpoint
//   4. AI service calls Ollama locally → generates recipe text (~30-50 sec)
//   5. AI service calls DALL-E → generates image (~5-10 sec)
//   6. AI service returns { text, rarity, name, imageUrl }
//   7. Bot builds a fancy Discord embed with the recipe + image
//   8. Bot sends the embed as the reply
//
// The AI service runs in a separate process, so if Ollama crashes or is slow,
// only this command is affected — the rest of the bot keeps working.
// ─────────────────────────────────────────────────────────────────────────────

// SlashCommandBuilder — defines what the command looks like to Discord.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
// EmbedBuilder — creates rich embed message objects with colors, images, etc.

// AI service URL from config — this is where we send the recipe request.
const { AI_SERVICE_URL } = require('../../shared/config');

// ── Rarity visual settings ────────────────────────────────────────────────────
// Different persona rarities get different emoji flair and embed colors.
// These make rarer personas feel more special and exciting.

// Emoji "decorations" shown next to the rarity name in the embed title.
const RARITY_FLAIR = {
  'Common': '🌾',      // Wheat/grain — cowboy staple
  'Uncommon': '🌿',    // Green herb — slightly special
  'Rare': '💎',        // Diamond — clearly valuable
  'Epic': '🦄',        // Unicorn — very unusual
  'Legendary': '🔥'   // Fire — top tier
};

// Hex color codes for the left border of each rarity's embed.
// 0x prefix = hexadecimal color value (same format as CSS colors like #1DB954).
const RARITY_COLORS = {
  'Common': 0x808080,      // Gray
  'Uncommon': 0x00FF00,    // Bright green
  'Rare': 0x0080FF,        // Bright blue
  'Epic': 0x8000FF,        // Purple
  'Legendary': 0xFFD700    // Gold
};

// ── Define the slash command ──────────────────────────────────────────────────
const data = new SlashCommandBuilder()
  .setName('cook')
  .setDescription('Ask Cowboy Kent Rollins to cook something up — powered by a local AI')
  .addStringOption(option =>
    option
      .setName('prompt')
      .setDescription('What do you want Kent to cook? (e.g. "spicy chili", "breakfast tacos")')
      .setRequired(true)
  );

// ── Command execution ─────────────────────────────────────────────────────────
async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ This command only works in a server.', flags: 64 });
    return;
  }

  // Get the recipe prompt the user typed.
  const prompt = interaction.options.getString('prompt');

  // Defer the reply because recipe generation takes ~30-60 seconds with local LLM.
  // This shows a "Bot is thinking..." loading indicator to the user.
  // The message is PUBLIC (not ephemeral) so everyone can see the recipe when it's done.
  await interaction.deferReply();

  try {
    console.log(`[COOK] Recipe request: "${prompt}"`);

    // Send the request to the AI service.
    const response = await fetch(`${AI_SERVICE_URL}/recipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      // AI service returned an error.
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 503) {
        // 503 = Service Unavailable (Ollama is probably not running).
        await interaction.editReply({
          content: '❌ The AI service is unavailable right now. Make sure Ollama is running:\n```\nollama serve\n```'
        });
      } else {
        await interaction.editReply({
          content: `❌ Recipe generation failed: ${errorData.error || 'Unknown error'}`
        });
      }
      return;
    }

    // Parse the recipe data from the AI service.
    const { text, rarity, name, imagePath } = await response.json();
    // Destructuring: pulls these four properties out of the response object.
    // imagePath is a local file path to a PNG (e.g. /tmp/kentbot-recipe/recipe-abc123.png),
    // or null if image generation failed. We attach it as a file so Discord displays it inline.

    if (!text) {
      await interaction.editReply({ content: '❌ Got an empty recipe. Try again!' });
      return;
    }

    // ── Build the fancy Discord embed ─────────────────────────────────────
    // Get the visual style for this rarity.
    const flair = RARITY_FLAIR[rarity] || '⭐';          // Fallback emoji
    const color = RARITY_COLORS[rarity] || 0x808080;     // Fallback gray

    // Build the embed title: "🔥 *Legendary* 🔥 — **Ghost Cowboy Kent Rollins**"
    const title = `${flair} *${rarity}* ${flair} — **${name}**`;

    // Discord embeds have a 4096 character limit for the description field.
    // Slice the recipe text if it's too long (LLMs sometimes go long).
    const description = text.slice(0, 4000);

    // Create the embed object.
    const embed = new EmbedBuilder()
      .setColor(color)          // The left-side colored bar on the embed
      .setTitle(title)          // The title shown at the top
      .setDescription(description)  // The main content (the recipe text)
      .setTimestamp();          // Shows when the recipe was generated

    // Build the reply payload — start with just the embed.
    const replyPayload = { embeds: [embed] };

    // If an image was generated, attach it as a file.
    // Discord.js reads the file from the path and uploads it with the message.
    // 'attachment://recipe.png' is a special Discord URL that refers to the
    // attached file named 'recipe.png' — this is how embeds display attached images.
    if (imagePath) {
      replyPayload.files = [{ attachment: imagePath, name: 'recipe.png' }];
      embed.setImage('attachment://recipe.png');
    }

    // Send the finished embed (with image attached if available) as the reply.
    await interaction.editReply(replyPayload);
    // .editReply() replaces the "Bot is thinking..." message with our embed.
    // { embeds: [embed] } = an array of embeds to include in the message.

    console.log(`[COOK] Recipe delivered: "${name}" (${rarity})`);

  } catch (err) {
    console.error('[COOK] Error:', err.message);

    const errorMsg = err.message.includes('ECONNREFUSED')
      ? '❌ AI service is not running. Start it with:\n```\nnode services/ai/index.js\n```'
      : '❌ Something went wrong generating your recipe. Try again!';

    await interaction.editReply({ content: errorMsg }).catch(() => {});
  }
}

module.exports = { data, execute };
