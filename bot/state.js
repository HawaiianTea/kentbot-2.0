// ─────────────────────────────────────────────────────────────────────────────
// bot/state.js — In-memory state manager for the Discord bot
//
// This file tracks everything the bot needs to remember while it's running —
// which voice channels it's connected to, what's currently playing, whether
// it's paused, etc.
//
// All state is stored in Maps (key-value stores) where the key is always a
// guildId (Discord server ID). This means each server gets completely
// separate, independent state — one server pausing music doesn't affect another.
//
// Why not store state in a database?
//   For a bot like this, everything resets when the bot restarts anyway
//   (voice connections drop, playback stops). In-memory storage is instant,
//   simple, and perfect for this use case.
// ─────────────────────────────────────────────────────────────────────────────

// A Map is a key-value store. Think of it like a filing cabinet where each
// drawer (guildId) holds a folder of data for that server.

// ── Guild playback state ──────────────────────────────────────────────────────
// Stores what's currently happening with music in each server.
// Key: guildId (string)
// Value: { isPlaying, isPaused, isIntroPlaying, currentSong, currentPlayer,
//          currentConnection, statusMessage, songStartTime, progressTimer }
const guildState = new Map();

// ── Text channel tracker ──────────────────────────────────────────────────────
// Remember which text channel to send "Now Playing" messages to in each server.
// The bot uses the channel where the /play command was typed.
// Key: guildId → Value: Discord TextChannel object
const textChannels = new Map();

// ── Voice channel tracker ─────────────────────────────────────────────────────
// Remember which voice channel the bot is connected to in each server.
// Key: guildId → Value: Discord VoiceChannel object
const voiceChannels = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// getOrCreateGuildState(guildId)
//
// Returns the state object for a guild, creating a fresh one if none exists.
// This is an internal helper used by the other exported functions.
//
// The state object holds everything needed to manage playback for one server:
//   isPlaying      — true if audio is currently playing
//   isPaused       — true if playback has been paused (but not stopped)
//   isIntroPlaying — true if the DJ intro TTS is playing (not the actual song yet)
//   currentSong    — the song object currently playing (or null if nothing)
//   currentPlayer  — the Discord AudioPlayer instance (or null)
//   currentConnection — the Discord VoiceConnection instance (or null)
//   statusMessage  — the Discord Message object for the "Now Playing" embed (or null)
//   songStartTime  — Date.now() timestamp for when the current song started
//   progressTimer  — the setInterval() timer ID for updating the progress bar
// ─────────────────────────────────────────────────────────────────────────────
function getOrCreateGuildState(guildId) {
  if (!guildState.has(guildId)) {
    // No state for this guild yet — create the default starting state.
    guildState.set(guildId, {
      isPlaying: false,           // Not playing anything
      isPaused: false,            // Not paused
      isIntroPlaying: false,      // No DJ intro in progress
      currentSong: null,          // No current song
      currentPlayer: null,        // No audio player created yet
      currentConnection: null,    // No voice connection yet
      statusMessage: null,        // No "Now Playing" message posted yet
      songStartTime: null,        // No song is playing yet
      progressTimer: null         // No progress bar timer running
    });
  }
  return guildState.get(guildId);
}

// ─────────────────────────────────────────────────────────────────────────────
// getGuildState(guildId) / setGuildState(guildId, updates)
//
// These are the primary getters and setters for guild playback state.
// setGuildState uses "partial updates" — you only provide the fields you want
// to change, and everything else stays the same.
//
// Example:
//   setGuildState(guildId, { isPlaying: true, currentSong: song })
//   This sets isPlaying and currentSong but leaves all other fields unchanged.
// ─────────────────────────────────────────────────────────────────────────────
function getGuildState(guildId) {
  return getOrCreateGuildState(guildId);
}

function setGuildState(guildId, updates) {
  // Get the current state object.
  const current = getOrCreateGuildState(guildId);

  // Object.assign(target, source) copies all properties from 'source' into 'target'.
  // This "merges" the updates into the existing state, preserving unchanged fields.
  // Example: if current = { a: 1, b: 2 } and updates = { b: 99 }
  //          result = { a: 1, b: 99 }  (a is unchanged, b is updated)
  Object.assign(current, updates);
}

// ─────────────────────────────────────────────────────────────────────────────
// resetGuildState(guildId)
//
// Resets a guild back to the "nothing is playing" state.
// Called when playback stops (/stop command, bot kicked from channel, etc.)
//
// Also clears the progress bar timer if one was running, to prevent memory leaks.
// ─────────────────────────────────────────────────────────────────────────────
function resetGuildState(guildId) {
  const state = getOrCreateGuildState(guildId);

  // Stop the progress bar timer if it's running.
  // clearInterval() stops a timer started by setInterval().
  // Without this, the timer would keep firing even after music stops.
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
  }

  // Reset all fields to their "nothing is playing" defaults.
  guildState.set(guildId, {
    isPlaying: false,
    isPaused: false,
    isIntroPlaying: false,
    currentSong: null,
    currentPlayer: null,
    currentConnection: null,
    statusMessage: null,
    songStartTime: null,
    progressTimer: null
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Text and Voice Channel Getters/Setters
//
// These let the bot remember which Discord channels to use for messages and
// voice connections, tracked separately from playback state.
// ─────────────────────────────────────────────────────────────────────────────

function setTextChannel(guildId, channel) {
  // Store the Discord TextChannel object for this guild.
  textChannels.set(guildId, channel);
}

function getTextChannel(guildId) {
  // Retrieve the stored TextChannel, or undefined if none was set.
  return textChannels.get(guildId);
}

function setVoiceChannel(guildId, channel) {
  // Store the Discord VoiceChannel object for this guild.
  voiceChannels.set(guildId, channel);
}

function getVoiceChannel(guildId) {
  // Retrieve the stored VoiceChannel, or undefined if none was set.
  return voiceChannels.get(guildId);
}

// ─────────────────────────────────────────────────────────────────────────────
// DJ Mode State
//
// A simple Map to track whether DJ mode (song intros) is enabled per-guild.
// Defaults to whatever ENABLED is set to in shared/config.js.
// ─────────────────────────────────────────────────────────────────────────────
const djModeEnabled = new Map();
// Tracks whether DJ mode is on (true) or off (false) per guild.

function getDJMode(guildId) {
  // If DJ mode hasn't been set for this guild yet, fall back to the config default.
  if (!djModeEnabled.has(guildId)) {
    const { DJ } = require('../shared/config');
    return DJ.ENABLED;  // Use the default from config.js
  }
  return djModeEnabled.get(guildId);
}

function setDJMode(guildId, enabled) {
  // enabled should be true or false.
  djModeEnabled.set(guildId, enabled);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export all state functions
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  getGuildState,       // Get the full playback state for a guild
  setGuildState,       // Update specific playback state fields for a guild
  resetGuildState,     // Reset a guild back to "nothing playing" state
  setTextChannel,      // Remember which text channel to use for a guild
  getTextChannel,      // Retrieve the stored text channel for a guild
  setVoiceChannel,     // Remember which voice channel the bot is in
  getVoiceChannel,     // Retrieve the stored voice channel for a guild
  getDJMode,           // Check if DJ mode (song intros) is enabled for a guild
  setDJMode            // Enable or disable DJ mode for a guild
};
