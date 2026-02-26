// ─────────────────────────────────────────────────────────────────────────────
// services/music/queue.js — Song queue manager for the music service
//
// This file acts like a librarian for songs. It keeps track of all the songs
// waiting to be played for every Discord server (guild) separately.
//
// Each Discord server gets its own independent queue, stored in a Map (a
// key-value store where the key is the server's unique ID and the value is
// the list of songs waiting to play).
//
// Think of it like a jukebox that remembers separate playlists for every
// room in a building.
// ─────────────────────────────────────────────────────────────────────────────

// A Map is like a dictionary or address book.
// Each entry maps a guildId (Discord server ID string) → array of song objects.
// Example: { "123456789" → [song1, song2, song3], "987654321" → [song4] }
const queues = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// getOrCreateQueue(guildId)
//
// Looks up the queue for a specific server. If that server doesn't have a queue
// yet (first time they use music), it creates an empty one automatically.
//
// This is a helper used by all the other functions in this file.
// ─────────────────────────────────────────────────────────────────────────────
function getOrCreateQueue(guildId) {
  // Check if a queue already exists for this server.
  // .has() returns true if the Map has an entry with this key.
  if (!queues.has(guildId)) {
    // No queue exists yet — create an empty array for this server.
    // [] is an empty array, which will hold song objects.
    queues.set(guildId, []);
    // .set(key, value) adds a new entry to the Map, or replaces an existing one.
  }

  // Return the queue array for this server.
  return queues.get(guildId);
  // .get(key) retrieves the value associated with that key in the Map.
}

// ─────────────────────────────────────────────────────────────────────────────
// enqueue(guildId, song)
//
// Adds a song to the back of the queue for a specific server.
// Returns the song's position in the queue (1 = next to play, 2 = after that, etc.)
//
// Parameters:
//   guildId — the Discord server ID (string like "123456789012345678")
//   song — an object with: { title, url, duration, thumbnail }
//            title: the song's display name (e.g. "Never Gonna Give You Up")
//            url: the YouTube URL for this song
//            duration: length in seconds (e.g. 213 for 3:33)
//            thumbnail: URL of the video's thumbnail image
// ─────────────────────────────────────────────────────────────────────────────
function enqueue(guildId, song) {
  // Get (or create) the queue for this server.
  const queue = getOrCreateQueue(guildId);

  // .push() adds the song to the END of the array (back of the line).
  queue.push(song);

  // Return the song's position — this is the queue length after adding it.
  // If the queue has 3 songs, the new one is position 3.
  return queue.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// dequeue(guildId)
//
// Removes and returns the FIRST song from the queue (the next one to play).
// Returns null if the queue is empty (nothing to play).
//
// This is called when the bot finishes a song and needs to know what's next.
// ─────────────────────────────────────────────────────────────────────────────
function dequeue(guildId) {
  const queue = getOrCreateQueue(guildId);

  // If the array is empty, there's nothing to return.
  if (queue.length === 0) {
    return null; // null means "nothing here"
  }

  // .shift() removes and returns the FIRST element of an array.
  // This is the opposite of .push() which adds to the end.
  // Think of it like the front of a line moving forward.
  return queue.shift();
}

// ─────────────────────────────────────────────────────────────────────────────
// peek(guildId)
//
// Looks at the first song in the queue WITHOUT removing it.
// Returns null if the queue is empty.
//
// Useful for checking "what's playing next" without actually advancing the queue.
// ─────────────────────────────────────────────────────────────────────────────
function peek(guildId) {
  const queue = getOrCreateQueue(guildId);

  // queue[0] accesses the first element (index 0) of the array.
  // If the array is empty, queue[0] is undefined, so we return null instead.
  return queue[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// getQueue(guildId)
//
// Returns the entire queue as an array so the bot can show "Up Next" lists.
// Returns an empty array [] if nothing is queued.
//
// This is a READ-ONLY view — it doesn't remove anything from the queue.
// ─────────────────────────────────────────────────────────────────────────────
function getQueue(guildId) {
  return getOrCreateQueue(guildId);
  // We return the actual array. Since arrays are objects in JavaScript,
  // the caller gets a reference to the same array (not a copy).
}

// ─────────────────────────────────────────────────────────────────────────────
// clearQueue(guildId)
//
// Empties the entire queue for a server, removing all queued songs.
// Called when someone uses /stop.
// ─────────────────────────────────────────────────────────────────────────────
function clearQueue(guildId) {
  // Setting the queue to an empty array [] removes all songs.
  queues.set(guildId, []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export all functions so other files can use them
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  enqueue,    // Add a song to the queue
  dequeue,    // Remove and return the next song
  peek,       // Look at the next song without removing it
  getQueue,   // Get the full list of queued songs
  clearQueue  // Empty the queue completely
};
