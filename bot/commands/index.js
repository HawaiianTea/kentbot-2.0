// ─────────────────────────────────────────────────────────────────────────────
// bot/commands/index.js — Dynamic command loader
//
// This file scans the commands/ folder, loads every command file, and returns
// them all as a Map (a key-value store) so the event handler can quickly look
// up which handler to run when a slash command is used.
//
// Why dynamic loading?
//   Instead of manually importing every command file, we use the file system
//   to find and load all .js files in this folder automatically. This means
//   adding a new command is as simple as creating a new file — no need to
//   change this file or any other file.
// ─────────────────────────────────────────────────────────────────────────────

// fs = File System module (built into Node.js) for reading files and directories.
const fs = require('fs');

// path helps build file paths that work on all operating systems.
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// loadCommands()
//
// Reads all .js files in the commands/ folder (except this file),
// requires each one, and returns a Map of command name → command module.
//
// Returns: Map<string, { data, execute }>
//   Key   = command name (e.g. "play", "skip", "cook")
//   Value = the command module { data: SlashCommandBuilder, execute: Function }
// ─────────────────────────────────────────────────────────────────────────────
function loadCommands() {
  // Create an empty Map to store our commands.
  // A Map is like an object but designed for dynamic key-value storage.
  const commands = new Map();

  // __dirname = the absolute path to the folder this file is in (commands/).
  // fs.readdirSync() reads the directory and returns an array of file names.
  const files = fs.readdirSync(__dirname);
  // Example result: ['index.js', 'play.js', 'skip.js', 'pause.js', ...]

  for (const file of files) {
    // Loop over each file in the folder.

    // Skip this file itself (index.js) — it's not a command, it's the loader.
    if (file === 'index.js') continue;
    // 'continue' skips to the next iteration of the loop.

    // Skip any files that aren't JavaScript files.
    if (!file.endsWith('.js')) continue;
    // .endsWith() checks if a string ends with the given substring.

    // Build the full absolute path to the command file.
    const filePath = path.join(__dirname, file);
    // path.join() combines folder and file name with the correct separator (/ or \).

    // Load the command module.
    // require() with a file path loads and executes that JavaScript file.
    const command = require(filePath);
    // command should be: { data: SlashCommandBuilder, execute: Function }

    // Validate that the file has the expected structure.
    if (!command.data || !command.execute) {
      console.warn(`[COMMANDS] Warning: ${file} is missing 'data' or 'execute' export`);
      continue; // Skip malformed command files
    }

    // Add the command to our Map using its name as the key.
    // command.data.name is the command name set in SlashCommandBuilder (e.g. "play").
    commands.set(command.data.name, command);

    console.log(`[COMMANDS] Loaded: /${command.data.name}`);
  }

  return commands;
  // Returns the Map with all loaded commands, ready for the event handler to use.
}

// ─────────────────────────────────────────────────────────────────────────────
// Export the loadCommands function
// ─────────────────────────────────────────────────────────────────────────────
module.exports = { loadCommands };
