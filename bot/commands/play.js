// ─────────────────────────────────────────────────────────────────────────────
// bot/commands/play.js — The /play slash command
//
// This file handles what happens when someone types /play in Discord.
//
// Flow:
//   1. User types: /play never gonna give you up
//   2. Discord sends an "interaction" event to our bot
//   3. This command handler runs
//   4. It checks: is the user in a voice channel? If not, tell them to join one.
//   5. It asks the music service to look up the song on YouTube
//   6. The music service adds it to the queue and returns the song info
//   7. If nothing is currently playing, we start playback
//   8. The bot replies with "Added to queue!" or just starts playing
//
// The bot and the music service (separate process) work together here.
// If the music service is down, the bot replies with an error message
// but doesn't crash — it just can't play music until the service is back.
// ─────────────────────────────────────────────────────────────────────────────

// SlashCommandBuilder is a Discord.js tool for defining what a slash command
// looks like — its name, description, and what arguments it accepts.
const { SlashCommandBuilder } = require('discord.js');

// Import the music player (handles voice connections and actual playback).
const { startPlayback, ensureVoiceConnection } = require('../music/player');

// Import state functions to track channels and check if we're already playing.
const { setTextChannel, setVoiceChannel, getGuildState } = require('../state');

// Import config to know the music service URL.
const { MUSIC_SERVICE_URL } = require('../../shared/config');

// ── Define the slash command structure ───────────────────────────────────────
// This object tells Discord what the command looks like.
// Discord uses this to show autocomplete, help text, and validate inputs.
const data = new SlashCommandBuilder()
  .setName('play')                         // The command name: /play
  .setDescription('Play a song from YouTube — type a name or paste a URL')
  .addStringOption(option =>
    // addStringOption() adds a text input parameter to the command.
    option
      .setName('query')                    // Internal name for this parameter
      .setDescription('Song name or YouTube URL (e.g. "Cotton Eyed Joe" or https://youtu.be/...)')
      .setRequired(true)                   // User MUST provide this — command won't send without it
  );

// ── Command execution function ────────────────────────────────────────────────
// This runs when a user actually uses the /play command.
// 'interaction' is the Discord.js object representing the command use.
async function execute(interaction) {
  // Check that this command was used in a server (guild), not a DM.
  if (!interaction.guild) {
    // .reply() sends a response message. flags: 64 makes it "ephemeral" —
    // only the command user can see it (like a private response).
    await interaction.reply({ content: '❌ This command only works in a server.', flags: 64 });
    return; // Stop here — don't continue if there's no guild
  }

  // Get the unique ID of this Discord server.
  const guildId = interaction.guild.id;

  // Check if the user is in a voice channel.
  // interaction.member is the guild member who used the command.
  // .voice is their voice state (whether they're in a voice channel and which one).
  // .channel is the actual voice channel object (null if not in one).
  const voiceChannel = interaction.member.voice.channel;

  if (!voiceChannel) {
    // User isn't in any voice channel — we can't play music without one.
    await interaction.reply({
      content: '❌ You need to be in a voice channel first! Join a voice channel and try again.',
      flags: 64  // Ephemeral — only the user sees this error
    });
    return;
  }

  // Get the search query the user typed after /play.
  // interaction.options.getString('query') retrieves the value of the 'query' parameter.
  const query = interaction.options.getString('query');

  // "Defer" the reply — this tells Discord "we got your command, give us a moment".
  // Discord requires a response within 3 seconds or the interaction expires.
  // deferReply() buys us time to do the YouTube search (which can take a few seconds).
  await interaction.deferReply();
  // After deferReply(), we have up to 15 minutes to use editReply() or followUp().

  try {
    // Remember the text channel where /play was typed — the "Now Playing" embed
    // will be sent to this same channel.
    setTextChannel(guildId, interaction.channel);
    // interaction.channel is the Discord TextChannel object.

    // Remember the voice channel so the player knows where to connect.
    setVoiceChannel(guildId, voiceChannel);

    // Ask the music service to search YouTube and add the song to the queue.
    // We make an HTTP POST request to the music service's /enqueue endpoint.
    const response = await fetch(`${MUSIC_SERVICE_URL}/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // JSON.stringify() converts our JavaScript object to a JSON text string.
      body: JSON.stringify({ guildId, query })
    });

    if (!response.ok) {
      // Music service returned an error (e.g. YouTube search failed).
      const errorData = await response.json().catch(() => ({}));
      // .catch(() => ({})) means: if parsing fails, use an empty object as fallback.

      await interaction.editReply({
        content: `❌ Could not find that song: ${errorData.error || 'Unknown error'}`
      });
      return;
    }

    // Parse the song info returned by the music service.
    const song = await response.json();
    // song = { title, url, duration, thumbnail, position }

    // Check if music is already playing in this guild.
    const state = getGuildState(guildId);

    if (state.isPlaying) {
      // Music is already playing — the song was added to the queue.
      // Edit the deferred reply to show the "Added to queue" confirmation.
      await interaction.editReply({
        content: `✅ Added to queue (#${song.position}): **${song.title}**`
      });
      return;
    }

    // Nothing is currently playing — delete the "thinking..." message and start.
    // We delete it because the "Now Playing" embed will appear immediately.
    await interaction.deleteReply().catch(() => {});
    // .catch(() => {}) = if deleting fails (e.g. already deleted), ignore the error.

    // Connect to voice and start playing the song.
    // ensureVoiceConnection() joins the voice channel if not already there.
    await ensureVoiceConnection(voiceChannel);

    // startPlayback() fetches the first song from the queue and starts playing.
    await startPlayback(guildId, voiceChannel);

  } catch (err) {
    console.error('[PLAY] Error:', err.message);

    // Check if the error is about the music service being offline.
    const errorMsg = err.message.includes('not running')
      ? '❌ Music service is offline. Please start it and try again.'
      : '❌ Something went wrong while trying to play that.';

    // Send the error message — use editReply since we already deferred.
    await interaction.editReply({ content: errorMsg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export the command definition and execution function.
// The command loader (commands/index.js) reads these exports to register
// and handle the command.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  data,     // The SlashCommandBuilder object — describes the command to Discord
  execute   // The function to call when the command is used
};
