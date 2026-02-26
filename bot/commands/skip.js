// ─────────────────────────────────────────────────────────────────────────────
// bot/commands/skip.js — The /skip slash command
//
// Skips the currently playing song and immediately plays the next one in queue.
// If nothing is in the queue after skipping, playback stops.
// ─────────────────────────────────────────────────────────────────────────────

const { SlashCommandBuilder } = require('discord.js');
const { skip } = require('../music/player');  // The skip function from our player
const { getGuildState } = require('../state'); // Check current playback state

const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Skip the current song and play the next one in queue');

async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ This command only works in a server.', flags: 64 });
    return;
  }

  const guildId = interaction.guild.id;
  const state = getGuildState(guildId);

  // Check if there's actually something playing to skip.
  if (!state.isPlaying) {
    await interaction.reply({ content: '❌ Nothing is playing right now.', flags: 64 });
    return;
  }

  // Try to skip. skip() returns true if it worked, false if there was nothing to skip.
  const skipped = skip(guildId);

  if (skipped) {
    // Confirm the skip with a brief ephemeral message.
    // flags: 64 makes it ephemeral so it doesn't clutter the chat.
    await interaction.reply({ content: '⏭️ Skipped!', flags: 64 });
  } else {
    await interaction.reply({ content: '❌ Could not skip.', flags: 64 });
  }
}

module.exports = { data, execute };
