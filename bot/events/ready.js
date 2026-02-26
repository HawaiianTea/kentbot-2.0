// ─────────────────────────────────────────────────────────────────────────────
// bot/events/ready.js — The "ready" event handler
//
// This event fires exactly ONCE when the bot successfully connects to Discord
// and is ready to start receiving events and commands.
//
// It's the Discord equivalent of "the store is open for business."
// Before this event fires, the bot can't receive commands or messages.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// execute(client)
//
// Called once when the bot logs in successfully.
//
// Parameters:
//   client — the Discord.js Client object (the bot itself)
//             client.user is the bot's own user account object
//             client.user.tag is something like "KentBot#1234"
// ─────────────────────────────────────────────────────────────────────────────
function execute(client) {
  // client.user.tag is the bot's Discord username and discriminator.
  // Example: "KentBot#1234" or "KentBot" (new username system).
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  console.log(`[BOT] Serving ${client.guilds.cache.size} server(s)`);
  // client.guilds.cache is a Map of all servers this bot is in.
  // .size gives the number of entries in the Map.

  // Set the bot's "Activity" status — the text shown under its name in Discord.
  // Activities tell users what the bot is doing.
  client.user.setActivity('/play • /cook • /dj', {
    // ActivityType.Watching = "Watching ..." — makes the status read:
    // "Watching /play • /cook • /dj"
    // We import the enum at the top of the file using Discord.js.
    type: 3  // 3 = Watching (ActivityType.Watching numeric value)
    // Using the number directly avoids an extra import.
    // ActivityType values: 0=Playing, 1=Streaming, 2=Listening, 3=Watching, 5=Competing
  });

  console.log(`[BOT] Ready! Status set.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export the event name and handler function.
// The bot entry point (bot/index.js) reads these exports to register events.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  name: 'ready',   // The Discord.js event name to listen for
  once: true,       // true = only fire this event handler once (not on reconnects)
  execute           // The function to call when the event fires
};
