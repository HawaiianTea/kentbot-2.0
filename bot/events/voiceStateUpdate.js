// ─────────────────────────────────────────────────────────────────────────────
// bot/events/voiceStateUpdate.js — Voice state change handler
//
// Discord fires a "voiceStateUpdate" event whenever anything related to voice
// changes in a server: someone joins/leaves a voice channel, gets muted,
// deafened, etc.
//
// We use this event to detect two situations:
//
//   1. The BOT gets kicked or disconnected from a voice channel.
//      When this happens, we need to clean up the guild state so the bot
//      doesn't think it's still playing music (it's not, it was kicked).
//
//   2. The voice channel becomes empty (everyone left).
//      When there's no one left to listen, we should stop playing and leave.
//      This prevents the bot from "ghost playing" to an empty channel.
// ─────────────────────────────────────────────────────────────────────────────

// Import state functions for cleanup.
const { resetGuildState, getGuildState } = require('../state');

// Import the stop function to properly clean everything up.
const { stop } = require('../music/player');

// ─────────────────────────────────────────────────────────────────────────────
// execute(oldState, newState)
//
// Called every time any voice state changes in a server.
//
// Parameters:
//   oldState — the voice state BEFORE the change
//              (e.g. the channel the user WAS in, before they moved)
//   newState — the voice state AFTER the change
//              (e.g. the channel the user IS NOW in, after they moved)
//
// By comparing oldState and newState, we can figure out what changed.
// ─────────────────────────────────────────────────────────────────────────────
async function execute(oldState, newState) {
  // We need a guild to operate in. If there's no guild, something is very wrong.
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const guildId = guild.id;

  // .guild.members.me is the bot's own guild member object.
  // .id is the bot's user ID.
  const botId = guild.members.me?.id;
  if (!botId) return; // Bot isn't in this guild somehow

  // ── Case 1: The BOT was disconnected from a voice channel ──────────────────
  // This happens when:
  //   - Someone clicks "Disconnect" on the bot
  //   - The bot is kicked from the channel
  //   - The channel is deleted while the bot is in it
  //   - The server is experiencing issues

  if (oldState.member?.id === botId && oldState.channelId && !newState.channelId) {
    // oldState.member.id === botId → this event is about the bot
    // oldState.channelId → the bot WAS in a channel before
    // !newState.channelId → the bot is NO LONGER in a channel

    console.log(`[VOICE] Bot was disconnected from voice in guild ${guild.name}`);

    // Clean up playback state — stop the player and clear everything.
    await stop(guildId).catch(err => {
      // .catch() handles any errors from stop() gracefully.
      // We don't want cleanup itself to throw and crash the event handler.
      console.error('[VOICE] Error during disconnect cleanup:', err.message);
    });

    return; // Handled — no need to check the other cases
  }

  // ── Case 2: Someone left a voice channel — check if the channel is now empty ──
  // When users leave, check if the channel the bot is in has become empty.
  // If so, stop playing and leave (no point playing to an empty room).

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    // Someone moved channels or left a channel.
    // oldState.channelId = the channel they WERE in
    // The channel they moved FROM might now be empty.

    const state = getGuildState(guildId);

    // Check if the bot is currently in a voice channel.
    if (!state.currentConnection) return; // Bot isn't connected to voice
    if (!state.isPlaying) return;          // Bot isn't playing anything

    // Get the channel the bot is connected to.
    // .joinConfig.channelId is stored inside the VoiceConnection object.
    const botChannelId = state.currentConnection?.joinConfig?.channelId;
    if (!botChannelId) return; // Can't determine which channel the bot is in

    // Was the person who left the same channel the bot is in?
    if (oldState.channelId !== botChannelId) return;
    // If they left a DIFFERENT channel, not our channel — ignore.

    // Count how many non-bot members are in the bot's voice channel.
    const voiceChannel = guild.channels.cache.get(botChannelId);
    // guild.channels.cache is a Map of all channels in the server.
    // .get(id) retrieves the channel by ID.

    if (!voiceChannel) return; // Channel doesn't exist (was deleted)

    // .members is a Map of all members currently in the voice channel.
    // We filter out bots to count only real human users.
    const humanMembers = voiceChannel.members.filter(member => !member.user.bot);
    // .filter() returns a new Map with only entries where the callback returns true.
    // !member.user.bot = "not a bot" = is a human

    if (humanMembers.size === 0) {
      // The channel is now empty (only the bot remains, or no one).
      console.log(`[VOICE] Voice channel empty in ${guild.name}, stopping playback`);

      // Stop playing and disconnect after a 30-second grace period.
      // This gives people time to come back if they accidentally disconnected.
      setTimeout(async () => {
        // Check again after 30 seconds — maybe someone rejoined.
        const freshChannel = guild.channels.cache.get(botChannelId);
        if (!freshChannel) return;

        const freshHumans = freshChannel.members.filter(m => !m.user.bot);
        if (freshHumans.size === 0) {
          // Still empty after 30 seconds — stop and leave.
          console.log(`[VOICE] Still empty after 30s, disconnecting from ${guild.name}`);
          await stop(guildId).catch(() => {});
        }
        // Otherwise, someone came back — keep playing!
      }, 30_000); // 30_000ms = 30 seconds
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export the event name and handler
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  name: 'voiceStateUpdate',  // The Discord.js event name to listen for
  once: false,                // Fire every time there's a voice state change
  execute                     // The function to call when the event fires
};
