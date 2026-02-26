// ─────────────────────────────────────────────────────────────────────────────
// bot/music/embed.js — "Now Playing" Discord embed builder
//
// This file creates and updates the rich "Now Playing" message that appears
// in the text channel when music is playing. It shows:
//   • The current song title (as a clickable link)
//   • The song's duration
//   • An animated progress bar showing how far through the song we are
//   • Whether the DJ is doing an intro
//   • A list of upcoming songs in the queue
//   • The total time of all queued songs
//
// Discord "embeds" are special message types with colors, titles, descriptions,
// images, and footers — much fancier than plain text messages.
// EmbedBuilder is the Discord.js tool for creating them.
// ─────────────────────────────────────────────────────────────────────────────

// EmbedBuilder is a Discord.js class that builds rich embed message objects.
const { EmbedBuilder } = require('discord.js');

// Import our state manager and config.
const { getGuildState, setGuildState } = require('../state');
const { EMBED } = require('../../shared/config');

// ─────────────────────────────────────────────────────────────────────────────
// formatTime(seconds)
//
// Converts a number of seconds into a human-readable "M:SS" time string.
//
// Examples:
//   formatTime(213) → "3:33"
//   formatTime(60)  → "1:00"
//   formatTime(9)   → "0:09"
// ─────────────────────────────────────────────────────────────────────────────
function formatTime(seconds) {
  // Math.floor() rounds down to the nearest whole number.
  const m = Math.floor(seconds / 60);   // Total minutes (e.g. 213/60 = 3)
  const s = Math.floor(seconds % 60);   // Remaining seconds (e.g. 213%60 = 33)
  // % is the modulo operator — it gives the remainder after division.

  // .toString() converts the number to a string.
  // .padStart(2, '0') ensures it's at least 2 characters wide by adding a leading '0'.
  // Example: "9".padStart(2, '0') → "09", "33".padStart(2, '0') → "33" (unchanged)
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// getProgressBar(elapsed, total, segments)
//
// Builds a visual progress bar using Unicode characters.
//
// Parameters:
//   elapsed  — seconds played so far
//   total    — total song duration in seconds
//   segments — how many characters wide the bar is (from config)
//
// Example output with 14 segments at 40% progress:
//   ▬▬▬▬▬🔘▬▬▬▬▬▬▬▬
//
// The 🔘 (radio button emoji) shows the current position.
// ▬ fills the rest of the bar.
// ─────────────────────────────────────────────────────────────────────────────
function getProgressBar(elapsed, total, segments) {
  // If we don't know the total duration, we can't draw a meaningful bar.
  if (!total || total <= 0) return '';

  // Calculate what fraction of the song has played (0.0 to 1.0).
  // Math.min() ensures we never go above 1.0 even if timing is slightly off.
  const percent = Math.min(elapsed / total, 1);

  // Calculate which segment position the 🔘 dot should be at.
  // Math.round() rounds to the nearest whole number.
  // (segments - 1) because positions are 0-indexed (0 to segments-1).
  const dotPosition = Math.round(percent * (segments - 1));

  // Build the bar character by character.
  let bar = '';
  for (let i = 0; i < segments; i++) {
    // If this position is the current playback position, put the dot here.
    if (i === dotPosition) {
      bar += '🔘';   // Radio button emoji as the progress indicator
    } else {
      bar += '▬';    // Line character to fill the bar
    }
  }
  return bar;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildNowPlayingEmbed(song, upNextQueue, isIntroPlaying, elapsed)
//
// Creates and returns a Discord EmbedBuilder object with all the Now Playing
// information. This embed is then sent or edited as a Discord message.
//
// Parameters:
//   song          — the current song object { title, url, duration, thumbnail }
//   upNextQueue   — array of upcoming songs (for "Up Next" list)
//   isIntroPlaying — true if the DJ is currently doing the intro speech
//   elapsed       — seconds played so far (for progress bar)
// ─────────────────────────────────────────────────────────────────────────────
function buildNowPlayingEmbed(song, upNextQueue, isIntroPlaying, elapsed) {
  // Start building the description text.
  // Markdown in Discord: **bold**, *italic*, [text](url) = clickable link
  let description = `[**${song.title}**](${song.url})\n`;
  // This makes the song title a clickable link that opens the YouTube video.

  // Optionally show the song's total duration.
  if (EMBED.SHOW_SONG_LENGTH && song.duration && song.duration > 0) {
    description += `Length: ${formatTime(song.duration)}\n`;
  }

  // Show a note when the DJ intro is playing.
  if (isIntroPlaying) {
    description += '_DJ is introducing this song..._\n';
    // _text_ in Discord markdown = italic text
  }

  // Show the progress bar if enabled and we have duration data.
  if (EMBED.SHOW_PROGRESS_BAR && song.duration && song.duration > 0 && !isIntroPlaying) {
    const bar = getProgressBar(elapsed || 0, song.duration, EMBED.PROGRESS_BAR_LENGTH);
    if (bar) {
      // Calculate the time string "elapsed / total"
      const timeStr = `${formatTime(elapsed || 0)} / ${formatTime(song.duration)}`;
      description += `${bar} ${timeStr}\n`;
    }
  }

  // Show the "Up Next" list of queued songs.
  if (upNextQueue && upNextQueue.length > 0) {
    description += '\n**Up Next:**\n';
    // Show at most 10 songs to keep the embed from getting too long.
    // .slice(0, 10) returns the first 10 elements of the array.
    upNextQueue.slice(0, 10).forEach((s, i) => {
      // forEach() calls a function for each item in the array.
      // s = the song object, i = its index (0-based, so we add 1 for display).
      description += `${i + 1}. 🎵 ${s.title}\n`;
    });

    // If there are more than 10 songs, show how many were hidden.
    if (upNextQueue.length > 10) {
      description += `...and ${upNextQueue.length - 10} more songs`;
    }

    // Show total queue time at the bottom if enabled.
    if (EMBED.SHOW_TOTAL_QUEUE) {
      // Sum up all valid durations. .reduce() accumulates a total from an array.
      // acc = running total, s = current song. Start from 0.
      const totalSeconds = upNextQueue.reduce((acc, s) => {
        // Only count songs where we know the duration (duration > 0).
        return acc + (s.duration && s.duration > 0 ? s.duration : 0);
      }, 0); // 0 is the starting value for acc

      if (totalSeconds > 0) {
        description += `\n**Queue time:** ${formatTime(totalSeconds)}`;
      }
    }
  } else {
    description += '\n*No songs in queue*';
    // *text* in Discord markdown = italic text
  }

  // Build and return the EmbedBuilder object.
  return new EmbedBuilder()
    .setColor(0x1DB954)          // Spotify green — music-themed color (hex color code)
    .setTitle('🎵 Now Playing')  // Title shown at the top of the embed
    .setDescription(description) // The main content we just built
    .setThumbnail(song.thumbnail) // Small image shown in the top-right corner
    .setTimestamp();              // Shows when the embed was created/updated
}

// ─────────────────────────────────────────────────────────────────────────────
// updateNowPlayingMessage(guildId, upNextQueue)
//
// Sends or updates the "Now Playing" embed in the guild's text channel.
// If the embed already exists, it edits it in place.
// If it doesn't exist yet, it sends a new message.
//
// This is called:
//   • When a song starts playing
//   • Every 10 seconds to update the progress bar
//   • When a new song is added to the queue (to refresh "Up Next")
//   • When playback stops (to delete the embed)
// ─────────────────────────────────────────────────────────────────────────────
async function updateNowPlayingMessage(guildId, upNextQueue) {
  // Get the current playback state for this guild.
  const state = getGuildState(guildId);

  // If nothing is playing, delete the "Now Playing" message if one exists.
  if (!state.currentSong) {
    if (state.statusMessage) {
      try {
        await state.statusMessage.delete();
        // .delete() removes the Discord message. Wrapped in try/catch because
        // Discord might throw if the message was already deleted.
      } catch { /* ignore — message might already be deleted */ }
      setGuildState(guildId, { statusMessage: null });
    }
    return;
  }

  // Calculate how many seconds of the current song have elapsed.
  let elapsed = 0;
  if (state.songStartTime) {
    // Date.now() returns the current time in milliseconds.
    // Subtract the start time and divide by 1000 to get seconds.
    // Math.floor() rounds down to a whole number.
    elapsed = Math.floor((Date.now() - state.songStartTime) / 1000);
  }

  // Build the embed using the current state.
  const embed = buildNowPlayingEmbed(
    state.currentSong,          // The song that's playing
    upNextQueue || [],          // Songs waiting in the queue
    state.isIntroPlaying,       // Whether the DJ intro is currently playing
    elapsed                     // Seconds elapsed for the progress bar
  );

  // Try to edit the existing message, or send a new one.
  const textChannel = require('../state').getTextChannel(guildId);

  if (state.statusMessage) {
    // An embed message already exists — edit it to show updated progress/queue.
    try {
      await state.statusMessage.edit({ embeds: [embed] });
      // .edit() modifies the existing Discord message instead of sending a new one.
      // { embeds: [embed] } = the updated embed content
    } catch (err) {
      // If editing fails (message deleted, permissions changed), clear the reference
      // so we send a new one next time.
      console.warn('[EMBED] Could not edit status message:', err.message);
      setGuildState(guildId, { statusMessage: null });
    }
  } else if (textChannel) {
    // No embed exists yet — send a new one.
    try {
      const msg = await textChannel.send({ embeds: [embed] });
      // textChannel.send() sends a message to the Discord channel.
      // It returns a Message object that we save so we can edit it later.
      setGuildState(guildId, { statusMessage: msg });
    } catch (err) {
      console.warn('[EMBED] Could not send status message:', err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// clearNowPlayingMessage(guildId)
//
// Deletes the "Now Playing" embed from Discord when music stops.
// ─────────────────────────────────────────────────────────────────────────────
async function clearNowPlayingMessage(guildId) {
  const state = getGuildState(guildId);

  if (state.statusMessage) {
    try {
      await state.statusMessage.delete();
    } catch { /* already deleted or missing permissions */ }
    setGuildState(guildId, { statusMessage: null });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export functions for use by the music player
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  updateNowPlayingMessage,  // Send or update the Now Playing embed
  clearNowPlayingMessage,   // Delete the Now Playing embed when music stops
  buildNowPlayingEmbed,     // Build just the embed object (for manual use)
  formatTime                // Convert seconds to "M:SS" string (utility)
};
