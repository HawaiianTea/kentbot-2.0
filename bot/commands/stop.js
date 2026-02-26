// ─────────────────────────────────────────────────────────────────────────────
// bot/commands/stop.js — The /stop slash command
//
// Stops all music completely:
//   • Stops the currently playing song
//   • Clears the entire song queue
//   • Disconnects the bot from the voice channel
//   • Removes the "Now Playing" embed from chat
//
// After /stop, the bot leaves voice. To play again, use /play.
// ─────────────────────────────────────────────────────────────────────────────

const { SlashCommandBuilder } = require('discord.js');
const { stop } = require('../music/player');  // The stop function
const { getGuildState } = require('../state');

const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop music, clear the queue, and disconnect the bot from voice');

async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ This command only works in a server.', flags: 64 });
    return;
  }

  const guildId = interaction.guild.id;
  const state = getGuildState(guildId);

  // Check if there's anything to stop.
  if (!state.isPlaying && !state.currentConnection) {
    await interaction.reply({ content: '❌ Nothing is playing right now.', flags: 64 });
    return;
  }

  // Reply immediately before doing the async stop work.
  // We don't use deferReply() here because stop() is fast enough.
  await interaction.reply({ content: '⏹️ Stopped and cleared the queue.', flags: 64 });

  // Stop everything: player, queue, voice connection, embed.
  await stop(guildId);
}

module.exports = { data, execute };
