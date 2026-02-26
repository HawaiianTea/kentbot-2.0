// ─────────────────────────────────────────────────────────────────────────────
// ecosystem.config.cjs — PM2 Process Manager Configuration
//
// This file tells PM2 (Process Manager 2) how to run all three bot processes.
// PM2 keeps your processes running 24/7 and automatically restarts them if
// they crash — essential for a production Discord bot.
//
// How to use:
//   Install PM2:      npm install -g pm2
//   Start all three: pm2 start ecosystem.config.cjs
//   Stop all:        pm2 stop all
//   View logs:       pm2 logs
//   View status:     pm2 status
//   Restart one:     pm2 restart kentbot-ai
//   Save to autostart: pm2 save && pm2 startup
//
// The three processes:
//   1. kentbot-music  — Music service (YouTube lookups, queue management)
//   2. kentbot-ai     — AI service (Ollama, DALL-E, XTTS)
//   3. kentbot-bot    — The Discord bot (commands, events, voice, playback)
//
// Startup order matters:
//   The music service and AI service should start before the bot,
//   because the bot immediately calls them when commands are used.
//   PM2 handles this with the 'wait_ready' and 'listen_timeout' settings.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // 'apps' is an array of process configurations.
  // Each object in the array defines one process.
  apps: [

    // ────────────────────────────────────────────────────────────────────────
    // Process 1: Music Service
    // Handles YouTube lookups and song queue management.
    // This should start first because the bot calls it immediately.
    // ────────────────────────────────────────────────────────────────────────
    {
      name: 'kentbot-music',          // The name shown in `pm2 status`
      script: 'services/music/index.js', // The file to run
      cwd: __dirname,                 // Run from the project root folder

      // Restart behavior: restart the process if it crashes.
      autorestart: true,

      // How many times to try restarting before giving up.
      max_restarts: 10,

      // Wait this many milliseconds before attempting a restart after a crash.
      // 5000ms = 5 seconds — gives time for network issues to clear.
      restart_delay: 5000,

      // Environment variables available to this process.
      // These are READ from your .env file — don't put secrets directly here.
      env: {
        NODE_ENV: 'production'  // Tells Node.js we're running in production mode
      },

      // Log file paths for this process.
      // PM2 saves stdout and stderr to these files for debugging.
      out_file: './logs/music-out.log',   // Normal output goes here
      error_file: './logs/music-err.log', // Error output goes here

      // How to merge log entries when the process restarts.
      merge_logs: true,    // Combine old and new logs instead of overwriting

      // PM2 watches this folder for file changes and restarts automatically.
      // Useful during development. Disable in production for performance.
      watch: false,

      // Timeout for PM2 to consider the process "ready" after startup.
      listen_timeout: 15000  // 15 seconds
    },

    // ────────────────────────────────────────────────────────────────────────
    // Process 2: AI Service
    // Handles Ollama text generation, DALL-E image generation, and XTTS TTS.
    // This can take longer to start because XTTS model loading is slow.
    // ────────────────────────────────────────────────────────────────────────
    {
      name: 'kentbot-ai',
      script: 'services/ai/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,   // 10 seconds — AI service might need longer to restart
      env: {
        NODE_ENV: 'production'
      },
      out_file: './logs/ai-out.log',
      error_file: './logs/ai-err.log',
      merge_logs: true,
      watch: false,
      listen_timeout: 30000   // 30 seconds — XTTS model loading takes time
    },

    // ────────────────────────────────────────────────────────────────────────
    // Process 3: Discord Bot
    // The main bot — handles Discord events, commands, voice connections.
    // Should start last (after services are ready) to avoid 503 errors on startup.
    // ────────────────────────────────────────────────────────────────────────
    {
      name: 'kentbot-bot',
      script: 'bot/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production'
      },
      out_file: './logs/bot-out.log',
      error_file: './logs/bot-err.log',
      merge_logs: true,
      watch: false,
      listen_timeout: 15000
    }
  ]
};
