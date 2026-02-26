// ─────────────────────────────────────────────────────────────────────────────
// bot/index.js — The Discord Bot Entry Point (Process 1)
//
// This is the main file for the Discord bot. When you run:
//   node bot/index.js
// ...this file starts. It:
//   1. Loads environment variables from .env
//   2. Creates the Discord client (the bot connection)
//   3. Loads all command handlers from bot/commands/
//   4. Loads all event handlers from bot/events/
//   5. Registers the event handlers with the client
//   6. Connects to Discord using the bot token
//
// This file is intentionally small and simple — it's just the "wiring".
// The actual command logic lives in bot/commands/*.js
// The actual event logic lives in bot/events/*.js
//
// Architecture note:
//   This process ONLY handles Discord. Music queue lookups and AI generation
//   are delegated to the music service (Process 2) and AI service (Process 3)
//   via HTTP calls. This keeps this process stable and focused.
// ─────────────────────────────────────────────────────────────────────────────

// Load environment variables from the .env file into process.env.
// This MUST run before anything else that reads process.env.XXX values.
// dotenv reads the .env file and populates process.env with all the key=value pairs.
require('dotenv').config();

// Discord.js is the library that lets us talk to the Discord API.
// Client is the main class that represents our bot's connection to Discord.
// GatewayIntentBits is an enum of "intents" — what events Discord should send us.
const { Client, GatewayIntentBits } = require('discord.js');

// Import our dynamic command loader.
const { loadCommands } = require('./commands/index');

// fs and path help us scan the events/ folder for event handler files.
const fs = require('fs');
const path = require('path');

// ── Validate required environment variables ───────────────────────────────────
// The bot can't run without a Discord token — check for it upfront.
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN is not set in your .env file.');
  console.error('   Copy .env.example to .env and fill in your bot token.');
  process.exit(1);
  // process.exit(1) stops Node.js with exit code 1 (1 = error).
  // This gives a clear error rather than a confusing "Cannot read token" crash later.
}

// ── Create the Discord client ─────────────────────────────────────────────────
// A Discord "client" is the bot's connection to Discord's servers.
// "Intents" tell Discord which events to send to our bot.
// Without the right intents, Discord won't send us certain events.
const client = new Client({
  intents: [
    // Guilds = receive events about servers the bot is in (required for most things).
    GatewayIntentBits.Guilds,

    // GuildVoiceStates = receive events when users join/leave voice channels.
    // Required for @discordjs/voice to work (voice connections need this).
    GatewayIntentBits.GuildVoiceStates,

    // GuildMessages = receive events when messages are sent in servers.
    // Not strictly required for slash commands, but useful for context.
    GatewayIntentBits.GuildMessages
  ]
});

// ── Load commands ─────────────────────────────────────────────────────────────
// Scan the commands/ folder and load all command handlers.
// commands is a Map: commandName (string) → command module { data, execute }
const commands = loadCommands();
console.log(`[BOT] Loaded ${commands.size} command(s)`);

// ── Load and register event handlers ─────────────────────────────────────────
// Scan the events/ folder and register each handler with the Discord client.
const eventsPath = path.join(__dirname, 'events');
// __dirname = the folder this file is in (bot/).
// path.join() builds the path to bot/events/

const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
// readdirSync() = read all files in the folder synchronously (waits for result).
// .filter(f => f.endsWith('.js')) = keep only JavaScript files.

for (const file of eventFiles) {
  // Load each event handler file.
  const event = require(path.join(eventsPath, file));
  // event = { name: 'ready', once: true, execute: Function }

  if (event.once) {
    // client.once() registers an event that fires exactly ONE time.
    // The 'ready' event uses once: true because we only need to log "bot is ready" once.
    client.once(event.name, (...args) => {
      // The spread operator (...args) collects all arguments passed to the event.
      // Different events send different arguments:
      //   'ready'             → (client)
      //   'interactionCreate' → (interaction)
      //   'voiceStateUpdate'  → (oldState, newState)

      // For interactionCreate, pass the commands Map as an extra argument.
      // The handler needs it to look up which command to run.
      if (event.name === 'interactionCreate') {
        event.execute(...args, commands);
      } else if (event.name === 'ready') {
        // The ready event handler only needs the client.
        event.execute(client);
      } else {
        event.execute(...args);
      }
    });
  } else {
    // client.on() registers an event that fires every time it occurs.
    // Most events use once: false.
    client.on(event.name, (...args) => {
      if (event.name === 'interactionCreate') {
        event.execute(...args, commands);
      } else {
        event.execute(...args);
      }
    });
  }

  console.log(`[BOT] Registered event: ${event.name}`);
}

// ── Connect to Discord ────────────────────────────────────────────────────────
// client.login() connects the bot to Discord using the secret token.
// This is like entering a password — only bots with the right token can connect.
// It returns a Promise — we use .catch() to handle login errors gracefully.
client.login(process.env.DISCORD_TOKEN)
  .catch(err => {
    // Common errors:
    //   "An invalid token was provided" — DISCORD_TOKEN in .env is wrong
    //   "Used disallowed intents" — the bot needs privileged intents enabled in Discord portal
    console.error('❌ Failed to log in to Discord:', err.message);
    console.error('   Check that DISCORD_TOKEN in your .env file is correct.');
    process.exit(1);
  });

// ── Graceful shutdown handler ─────────────────────────────────────────────────
// When PM2 stops the bot (or you press Ctrl+C), this runs cleanup code.
// process.on('SIGINT') listens for the "interrupt" signal (Ctrl+C).
// process.on('SIGTERM') listens for the "terminate" signal (PM2 stop).
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function shutdown() {
  // Shutdown is the sequence of cleanup steps when the bot is stopping.
  console.log('[BOT] Shutting down...');

  // Destroy the Discord client connection cleanly.
  // .destroy() closes the WebSocket connection and frees resources.
  client.destroy();

  console.log('[BOT] Goodbye!');
  process.exit(0);
  // process.exit(0) = exit with code 0 (success — graceful shutdown)
}
