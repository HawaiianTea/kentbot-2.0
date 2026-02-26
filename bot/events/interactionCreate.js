// ─────────────────────────────────────────────────────────────────────────────
// bot/events/interactionCreate.js — Slash command router
//
// Discord fires an "interactionCreate" event every time a user does something
// interactive: uses a slash command, clicks a button, uses a context menu, etc.
//
// This file is the "front desk" of our bot — it receives all interactions,
// figures out which command was used, and routes it to the right handler.
//
// Think of it like a phone operator:
//   "Hi, you've reached KentBot. For music, press /play. For recipes, press /cook."
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// execute(interaction, commands)
//
// Called every time a user does something interactive in Discord.
//
// Parameters:
//   interaction — the Discord.js Interaction object (contains all details about
//                 what happened: who used the command, which command, in which
//                 server and channel, and what arguments were provided)
//   commands    — the Map of all loaded command handlers (from commands/index.js)
// ─────────────────────────────────────────────────────────────────────────────
async function execute(interaction, commands) {
  // We only care about slash commands (ChatInputCommand).
  // Discord also sends interactions for buttons, select menus, etc.
  // .isChatInputCommand() returns true only for slash commands like /play.
  if (!interaction.isChatInputCommand()) {
    return; // Ignore non-slash-command interactions
  }

  // Get the command name from the interaction.
  // interaction.commandName is whatever came after the / (e.g. "play", "cook", "skip").
  const commandName = interaction.commandName;

  // Look up the command in our Map of loaded handlers.
  // commands is a Map where the key is the command name.
  const command = commands.get(commandName);

  if (!command) {
    // This shouldn't happen if commands are properly registered, but just in case.
    // Someone might use a command that was registered but whose file was deleted.
    console.warn(`[INTERACTION] Unknown command: /${commandName}`);
    await interaction.reply({
      content: `❌ Unknown command: /${commandName}`,
      flags: 64  // Ephemeral — only the user sees this
    });
    return;
  }

  // Try to execute the command.
  // We wrap in try/catch so one command failing doesn't break all future commands.
  try {
    console.log(`[INTERACTION] ${interaction.user.tag} used /${commandName} in ${interaction.guild?.name || 'DM'}`);
    // interaction.user.tag = the user's Discord name (e.g. "SomePerson")
    // interaction.guild?.name = the server name (the ?. handles DM interactions safely)

    // Run the command's execute() function.
    // We pass the interaction object so the command can read arguments and send responses.
    await command.execute(interaction);

  } catch (err) {
    console.error(`[INTERACTION] Error in /${commandName}:`, err);

    // Try to send an error message to the user.
    // We need to handle two cases: the interaction hasn't been replied to yet,
    // or it's already been replied to / deferred.
    const errorContent = '❌ An error occurred while running that command.';

    try {
      if (interaction.replied || interaction.deferred) {
        // Already sent an initial response — follow up instead.
        await interaction.followUp({ content: errorContent, flags: 64 });
      } else {
        // Hasn't been replied to yet — send a fresh reply.
        await interaction.reply({ content: errorContent, flags: 64 });
      }
    } catch (replyErr) {
      // Even sending the error message failed — just log it.
      console.error('[INTERACTION] Could not send error response:', replyErr.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export the event name and handler function.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  name: 'interactionCreate',  // The Discord.js event name to listen for
  once: false,                 // false = fire every time (not just once)
  execute                      // The function to call when the event fires
};
