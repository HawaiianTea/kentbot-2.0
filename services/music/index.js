// ─────────────────────────────────────────────────────────────────────────────
// services/music/index.js — The Music Service HTTP Server
//
// This file is Process 2 in our three-process bot architecture.
// It runs as a completely separate program from the main Discord bot.
//
// What it does:
//   It starts a small web server on port 3001 that the bot can call with HTTP
//   requests (like fetch() calls). It handles all queue management and YouTube
//   lookups so the bot doesn't have to deal with that complexity.
//
// Why separate?
//   If yt-dlp crashes or YouTube returns weird data, only THIS process fails.
//   The main bot keeps running and can show a friendly error message instead
//   of crashing completely.
//
// Think of it like a record store the DJ calls on the phone:
//   "Do you have 'Cotton Eyed Joe'?" → "Yes! Here's the title and stream URL"
//   The record store might be closed/broken, but the DJ (bot) stays at work.
// ─────────────────────────────────────────────────────────────────────────────

// Express is a popular Node.js framework for building HTTP servers.
// It makes it easy to define "routes" — what to do when someone calls a URL.
const express = require('express');

// Import our queue manager and YouTube helper from the same folder.
const { enqueue, dequeue, peek, getQueue, clearQueue } = require('./queue');
const { searchAndResolve } = require('./youtube');

// Import shared config to know which port to listen on.
const { MUSIC_SERVICE_PORT } = require('../../shared/config');

// Create the Express app — this is the actual HTTP server object.
const app = express();

// Tell Express to automatically parse incoming JSON request bodies.
// Without this, req.body would be undefined when the bot sends JSON data.
// "JSON" stands for JavaScript Object Notation — it's how data is sent over HTTP.
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// GET /health
//
// A simple health check endpoint.
// The bot can call this to see if the music service is running.
// Returns: { status: "ok" }
//
// PM2 (our process manager) and the bot can ping this to detect crashes.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  // req = the incoming HTTP request object (what the caller sent)
  // res = the response object (what we send back)

  // .json() sends a JSON response and automatically sets the content-type header.
  res.json({ status: 'ok' });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /enqueue
//
// Looks up a song on YouTube and adds it to the guild's queue.
//
// Request body (JSON): { guildId: "123...", query: "never gonna give you up" }
//   guildId — which Discord server this queue belongs to
//   query   — search term OR a YouTube URL
//
// Returns (JSON): { title, url, duration, thumbnail, position }
//   position — where in the queue the song landed (1 = next up)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/enqueue', async (req, res) => {
  try {
    // Destructure the request body — pull out the fields we expect.
    // This is shorthand for: const guildId = req.body.guildId; etc.
    const { guildId, query } = req.body;

    // Validate that we received the required fields.
    if (!guildId || !query) {
      // .status(400) sets the HTTP status code to 400 = "Bad Request"
      // This tells the caller "you sent bad/missing data"
      return res.status(400).json({ error: 'guildId and query are required' });
    }

    console.log(`[MUSIC] Enqueueing for guild ${guildId}: "${query}"`);

    // Ask youtube.js to search YouTube and return song metadata.
    // await pauses execution here until searchAndResolve() finishes.
    const song = await searchAndResolve(query);
    // song is now an object like: { title, url, duration, thumbnail }

    // Add the song to the back of this guild's queue.
    const position = enqueue(guildId, song);
    // position is the queue length after adding (1 = only song, 3 = third in line)

    console.log(`[MUSIC] Queued "${song.title}" at position ${position} for guild ${guildId}`);

    // Send back all the song info plus its queue position.
    res.json({
      title: song.title,
      url: song.url,
      duration: song.duration,
      thumbnail: song.thumbnail,
      position: position
    });

  } catch (err) {
    // If anything went wrong (YouTube returned an error, network issue, etc.),
    // log it and send a 500 "Internal Server Error" response.
    console.error('[MUSIC] Error enqueueing song:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /queue/:guildId
//
// Returns the full list of queued songs for a guild (for "Up Next" display).
//
// :guildId is a URL parameter — the actual guild ID goes in the URL.
// Example: GET /queue/123456789012345678
//
// Returns (JSON): [ { title, url, duration, thumbnail }, ... ]
//   An array of song objects. Empty array [] if nothing is queued.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/queue/:guildId', (req, res) => {
  // req.params.guildId extracts the :guildId part from the URL.
  const { guildId } = req.params;

  const queue = getQueue(guildId);
  // Returns the array of song objects for this guild.

  res.json(queue);
  // Sends the array as JSON. [] if nothing is queued.
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /next
//
// Removes and returns the next song from the queue.
// Called by the bot when a song finishes playing and it needs the next one.
//
// Request body (JSON): { guildId: "123..." }
//
// Returns (JSON): { title, url, duration, thumbnail }
//   OR null if the queue is empty (no more songs to play).
// ─────────────────────────────────────────────────────────────────────────────
app.post('/next', (req, res) => {
  const { guildId } = req.body;

  if (!guildId) {
    return res.status(400).json({ error: 'guildId is required' });
  }

  // Remove and return the first song from the queue.
  const nextSong = dequeue(guildId);
  // nextSong is either a song object, or null if the queue was empty.

  // Send back the song (or null).
  // The bot checks: if (nextSong) { play it } else { stop playing }
  res.json(nextSong);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /peek
//
// Returns the next song WITHOUT removing it from the queue.
// Used for showing "Now Playing" info or checking what's up next.
//
// Request body (JSON): { guildId: "123..." }
//
// Returns (JSON): { title, url, duration, thumbnail } or null
// ─────────────────────────────────────────────────────────────────────────────
app.post('/peek', (req, res) => {
  const { guildId } = req.body;

  if (!guildId) {
    return res.status(400).json({ error: 'guildId is required' });
  }

  const nextSong = peek(guildId);
  res.json(nextSong);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /queue/:guildId
//
// Clears (empties) the entire queue for a guild.
// Called when someone uses /stop.
//
// Returns (JSON): { cleared: true }
// ─────────────────────────────────────────────────────────────────────────────
app.delete('/queue/:guildId', (req, res) => {
  const { guildId } = req.params;

  clearQueue(guildId);
  console.log(`[MUSIC] Cleared queue for guild ${guildId}`);

  res.json({ cleared: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start the server
//
// .listen() tells Express to start accepting connections on the given port.
// The callback function runs once the server is ready.
// ─────────────────────────────────────────────────────────────────────────────
app.listen(MUSIC_SERVICE_PORT, () => {
  // Template literal: builds a string with the port number embedded.
  console.log(`[MUSIC SERVICE] Running on port ${MUSIC_SERVICE_PORT}`);
  console.log(`[MUSIC SERVICE] Health check: http://localhost:${MUSIC_SERVICE_PORT}/health`);
});
