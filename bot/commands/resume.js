// ─────────────────────────────────────────────────────────────────────────────
// bot/commands/resume.js — The /resume slash command
//
// Resumes playback after it's been paused with /pause.
// Picks up from exactly where it left off.
// ─────────────────────────────────────────────────────────────────────────────

const { SlashCommandBuilder } = require('discord.js');
const { resume } = require('../music/player');  // The resume function
const { getGuildState } = require('../state');

const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resume a paused song');

async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ This command only works in a server.', flags: 64 });
    return;
  }

  const guildId = interaction.guild.id;
  const state = getGuildState(guildId);

  // Check if there's a paused song to resume.
  if (!state.isPaused) {
    const msg = state.isPlaying
      ? '▶️ Already playing! Nothing is paused.'
      : '❌ Nothing is paused right now.';
    await interaction.reply({ content: msg, flags: 64 });
    return;
  }

  // Resume playback.
  const resumed = resume(guildId);

  if (resumed) {
    await interaction.reply({ content: '▶️ Resumed!', flags: 64 });
  } else {
    await interaction.reply({ content: '❌ Could not resume.', flags: 64 });
  }
}

module.exports = { data, execute };
