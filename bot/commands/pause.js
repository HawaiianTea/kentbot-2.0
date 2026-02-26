// ─────────────────────────────────────────────────────────────────────────────
// bot/commands/pause.js — The /pause slash command
//
// Pauses the currently playing audio at its current position.
// The song stays loaded and can be resumed with /resume from the same spot.
// ─────────────────────────────────────────────────────────────────────────────

const { SlashCommandBuilder } = require('discord.js');
const { pause } = require('../music/player');  // The pause function from our player
const { getGuildState } = require('../state');

const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pause the current song (use /resume to continue)');

async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ This command only works in a server.', flags: 64 });
    return;
  }

  const guildId = interaction.guild.id;
  const state = getGuildState(guildId);

  // Check if we're actually playing something.
  if (!state.isPlaying) {
    await interaction.reply({ content: '❌ Nothing is playing right now.', flags: 64 });
    return;
  }

  // Check if it's already paused.
  if (state.isPaused) {
    await interaction.reply({ content: '⏸️ Already paused. Use /resume to continue.', flags: 64 });
    return;
  }

  // Pause the audio player.
  const paused = pause(guildId);

  if (paused) {
    await interaction.reply({ content: '⏸️ Paused. Use /resume to continue.', flags: 64 });
  } else {
    await interaction.reply({ content: '❌ Could not pause.', flags: 64 });
  }
}

module.exports = { data, execute };
