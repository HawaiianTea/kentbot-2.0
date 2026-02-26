// ─────────────────────────────────────────────────────────────────────────────
// deploy-commands.js — Register slash commands with Discord
//
// Run this script once (or whenever you add/change commands) to tell Discord
// about your bot's slash commands. Without running this, /play, /cook, etc.
// won't appear in Discord's command list and users can't use them.
//
// How to run:
//   node deploy-commands.js
//
// Two modes:
//   • If GUILD_ID is set in .env → registers commands in that one server only
//     (appears immediately — great for testing!)
//   • If GUILD_ID is not set → registers commands globally (takes up to 1 hour
//     to appear everywhere — use for production)
//
// Discord requires you to "register" slash commands before they can be used.
// This is a one-time setup step. Registration tells Discord:
//   "This bot has a /play command that takes a 'query' text argument."
// After that, Discord shows autocomplete and help text for the command.
// ─────────────────────────────────────────────────────────────────────────────

// Load environment variables from .env
require('dotenv').config();

// REST is the Discord REST API client — used for making direct HTTP API calls.
const { REST, Routes } = require('@discordjs/rest');
// REST handles authentication and request formatting for the Discord API.
// Routes provides helper functions to build the correct API URL paths.

// path and fs help us find and load command files.
const path = require('path');
const fs = require('fs');

// ── Validate required environment variables ───────────────────────────────────
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN and CLIENT_ID must be set in your .env file.');
  console.error('   Find your CLIENT_ID in the Discord Developer Portal:');
  console.error('   https://discord.com/developers/applications → Your App → General Information');
  process.exit(1);
}

// ── Load all command definitions ──────────────────────────────────────────────
// Read the commands/ folder and load the 'data' property from each command file.
// The 'data' property is the SlashCommandBuilder that describes the command.
const commandsPath = path.join(__dirname, 'bot', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js') && f !== 'index.js');
// Filter out index.js (the loader) — it's not a command itself.

// Collect all command builders into an array.
const commandBuilders = [];

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  // Each command file exports { data, execute }.
  // data is a SlashCommandBuilder instance — .toJSON() converts it to the format
  // Discord's API expects.

  if (command.data) {
    commandBuilders.push(command.data.toJSON());
    // .toJSON() converts the SlashCommandBuilder to a plain JavaScript object.
    // The Discord API expects plain objects, not class instances.
    console.log(`[DEPLOY] Found command: /${command.data.name}`);
  }
}

console.log(`[DEPLOY] Preparing to register ${commandBuilders.length} command(s)...`);

// ── Create the REST client ────────────────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
// { version: '10' } = use Discord API version 10
// .setToken() provides the bot token for authentication

// ── Register the commands ─────────────────────────────────────────────────────
// This is an immediately-invoked async function — it runs right away.
// We need async/await to handle the API call cleanly.
(async () => {
  try {
    if (process.env.GUILD_ID) {
      // ── Guild-specific registration (instant, for testing) ───────────────
      // Registers commands in ONE specific server.
      // Commands appear immediately (no delay).
      console.log(`[DEPLOY] Registering commands in guild: ${process.env.GUILD_ID}`);

      await rest.put(
        // Routes.applicationGuildCommands() builds the API URL for guild commands.
        // It needs the bot's app ID and the guild (server) ID.
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commandBuilders }
        // { body: ... } = the commands to register, as JSON-ready objects
      );

      console.log('✅ Successfully registered commands in guild (visible immediately)');

    } else {
      // ── Global registration (for production, takes ~1 hour to propagate) ─
      // Registers commands globally — they appear in ALL servers the bot is in.
      // The downside: changes take up to 1 hour to propagate to all Discord clients.
      console.log('[DEPLOY] Registering commands globally (may take up to 1 hour to appear)...');

      await rest.put(
        // Routes.applicationCommands() builds the URL for global commands.
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commandBuilders }
      );

      console.log('✅ Successfully registered commands globally');
    }

    // List all the registered commands.
    for (const cmd of commandBuilders) {
      console.log(`   /${cmd.name} — ${cmd.description}`);
    }

  } catch (err) {
    // Common errors:
    //   "Unknown application" — CLIENT_ID is wrong
    //   "401: Unauthorized" — DISCORD_TOKEN is wrong
    //   "Missing Access" — GUILD_ID is a server the bot isn't in yet
    console.error('❌ Failed to register commands:', err.message);
    if (err.rawError) {
      // err.rawError contains the Discord API's error details.
      console.error('Discord API error:', JSON.stringify(err.rawError, null, 2));
    }
    process.exit(1);
  }
})();
// The () at the end immediately calls the async function we just defined.
