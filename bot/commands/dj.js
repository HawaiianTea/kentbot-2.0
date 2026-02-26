// ─────────────────────────────────────────────────────────────────────────────
// bot/commands/dj.js — The /dj slash command
//
// Toggles the DJ intro feature on or off for the current server.
//
// When DJ mode is ON:
//   Before each song plays, the AI generates a short intro speech in Kent
//   Rollins' voice (via Ollama text + XTTS TTS). The bot speaks the intro
//   in the voice channel before the song starts.
//
// When DJ mode is OFF:
//   Songs play immediately without any intro.
//
// The setting is stored in memory per-guild and resets when the bot restarts.
// ─────────────────────────────────────────────────────────────────────────────

const { SlashCommandBuilder } = require('discord.js');
const { getDJMode, setDJMode } = require('../state');  // DJ mode state per guild

const data = new SlashCommandBuilder()
  .setName('dj')
  .setDescription('Toggle DJ mode: AI-generated intro speech before each song')
  .addStringOption(option =>
    option
      .setName('mode')
      .setDescription('Turn DJ intros on or off')
      .setRequired(true)
      // .addChoices() restricts the input to specific options.
      // The user picks from a dropdown instead of typing freely.
      .addChoices(
        { name: 'On',  value: 'on'  },  // Display "On",  send "on"  to the bot
        { name: 'Off', value: 'off' }   // Display "Off", send "off" to the bot
      )
  );

async function execute(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ This command only works in a server.', flags: 64 });
    return;
  }

  const guildId = interaction.guild.id;

  // Get the user's choice: 'on' or 'off'.
  const choice = interaction.options.getString('mode');
  // .getString('mode') gets the value of the 'mode' option — either 'on' or 'off'.

  // Convert the string to a boolean (true/false).
  const enabled = choice === 'on';
  // 'on' === 'on' is true → enabled = true
  // 'off' === 'on' is false → enabled = false

  // Save the DJ mode setting for this guild.
  setDJMode(guildId, enabled);

  // Reply with confirmation.
  const statusMsg = enabled
    ? '🎙️ DJ mode is now **ON** — I\'ll introduce every song!'
    : '🔇 DJ mode is now **OFF** — songs will play without intros.';
  // Ternary operator: condition ? value_if_true : value_if_false

  await interaction.reply({ content: statusMsg, flags: 64 });
}

module.exports = { data, execute };
