// ─────────────────────────────────────────────────────────────────────────────
// services/music/youtube.js — YouTube search and audio stream helper
//
// This file handles all communication with YouTube via yt-dlp, a command-line
// tool that can search YouTube, get video metadata, and extract audio streams.
//
// Think of yt-dlp like a very smart assistant that knows how to talk to
// YouTube. We give it a song name or URL and it comes back with everything
// we need: the title, length, thumbnail image, and a direct audio link.
//
// Why yt-dlp and not the YouTube API?
//   The YouTube API requires API keys, has strict quotas, and doesn't give
//   us direct audio streams. yt-dlp is free, open-source, and purpose-built
//   for exactly this. It's the same tool used by most open-source music bots.
// ─────────────────────────────────────────────────────────────────────────────

// yt-dlp-exec is a Node.js wrapper around the yt-dlp command-line tool.
// It lets us call yt-dlp from JavaScript as if it were a function.
const ytdlp = require('yt-dlp-exec');

// ─────────────────────────────────────────────────────────────────────────────
// isYouTubeUrl(str)
//
// Checks whether a string looks like a YouTube URL.
// Returns true if it looks like a YouTube link, false if it's just a search term.
//
// Examples:
//   isYouTubeUrl("https://youtube.com/watch?v=abc123") → true
//   isYouTubeUrl("never gonna give you up")            → false
// ─────────────────────────────────────────────────────────────────────────────
function isYouTubeUrl(str) {
  // A regular expression (regex) is a pattern-matching formula.
  // This regex checks if the string starts with http:// or https://,
  // followed by optional "www.", followed by "youtube.com" or "youtu.be".
  // The /.../ delimiters mark it as a regex in JavaScript.
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(str);
  // .test(str) runs the regex pattern against str, returning true or false.
}

// ─────────────────────────────────────────────────────────────────────────────
// searchAndResolve(query)
//
// This is the main function. Given a search term or YouTube URL, it:
//   1. Searches YouTube (if it's a search term) or fetches video info (if URL)
//   2. Returns a song object with: { title, url, duration, thumbnail }
//
// This function is "async" because it has to wait for yt-dlp to finish
// talking to YouTube — that takes time and we don't want to freeze everything.
// ─────────────────────────────────────────────────────────────────────────────
async function searchAndResolve(query) {
  // Clean up the search query:
  // .trim() removes whitespace from the start and end of the string.
  // The regex replaces punctuation like periods, commas, etc. at the END of the
  // query with nothing "" — cleans up accidental trailing punctuation.
  const cleanQuery = query.trim().replace(/[.,!?;:]+$/, '');

  // Decide whether to search YouTube or fetch by URL directly.
  if (isYouTubeUrl(cleanQuery)) {
    // ── Case 1: The user gave us a direct YouTube URL ──────────────────────
    return await resolveUrl(cleanQuery);
  } else {
    // ── Case 2: The user gave us a search term like "cotton eyed joe" ──────
    return await searchYouTube(cleanQuery);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// searchYouTube(query)
//
// Uses yt-dlp to search YouTube for the top result matching the search term.
// Returns a song object or throws an error if nothing is found.
//
// This is like typing something into the YouTube search bar and taking the
// first result.
// ─────────────────────────────────────────────────────────────────────────────
async function searchYouTube(query) {
  // Call yt-dlp with these options:
  //   dumpSingleJson: true  → "give me all the info as JSON, don't download anything"
  //   defaultSearch: 'ytsearch1'  → "search YouTube and take the top 1 result"
  //   flatPlaylist: true  → "don't dig into playlists, just list the top entry"
  const results = await ytdlp(`ytsearch1:${query}`, {
    // ytsearch1: prefix tells yt-dlp to search and return exactly 1 result
    dumpSingleJson: true,  // Output metadata as JSON text, no actual download
    flatPlaylist: true,    // For search results (which act like a playlist of 1), stay flat
    noWarnings: true,      // Suppress warning messages we don't need
    noCallHome: true       // Don't send usage stats to yt-dlp developers
  });

  // results is a JavaScript object parsed from yt-dlp's JSON output.

  // yt-dlp search returns an object with an "entries" array.
  // Each entry is one video result. We want entries[0] = the first (best) result.
  if (!results || !results.entries || results.entries.length === 0) {
    // No results were found for this search query.
    throw new Error(`No YouTube results found for: ${query}`);
  }

  // Get the first (top) search result.
  const entry = results.entries[0];

  // Build the YouTube URL from the video ID.
  // yt-dlp's flat playlist entries have an 'id' field (the video ID like "dQw4w9WgXcQ")
  // but sometimes also a 'url' field. We prefer the full URL if available.
  const videoUrl = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;

  // Get the best thumbnail URL.
  // 'thumbnails' is an array of thumbnail images at different resolutions.
  // We want the last one, which is usually the highest quality.
  // If 'thumbnails' doesn't exist or is empty, fall back to 'thumbnail' (single URL).
  const thumbnail = (Array.isArray(entry.thumbnails) && entry.thumbnails.length > 0)
    ? entry.thumbnails[entry.thumbnails.length - 1].url  // Last = highest quality
    : (entry.thumbnail || '');  // Fallback to single thumbnail field

  // Return a clean, consistent song object.
  return {
    title: entry.title || 'Unknown Title',         // Song display name
    url: videoUrl,                                  // Full YouTube URL
    duration: entry.duration || 0,                 // Length in seconds (0 if unknown)
    thumbnail: thumbnail                            // Thumbnail image URL
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveUrl(url)
//
// Fetches full metadata for a specific YouTube URL.
// Used when the user pastes a YouTube link directly instead of searching.
// ─────────────────────────────────────────────────────────────────────────────
async function resolveUrl(url) {
  // Call yt-dlp on the specific URL with these options:
  //   dumpSingleJson: true  → get metadata as JSON, don't download
  //   noPlaylist: true  → if it's a playlist URL, only process the first video
  //   extractorRetries: 1  → if YouTube is tricky, only retry once
  //   socketTimeout: 10  → give up if YouTube doesn't respond within 10 seconds
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noPlaylist: true,
    extractorRetries: 1,
    socketTimeout: 10,
    noWarnings: true,
    noCallHome: true
  });

  if (!info || !info.title) {
    // yt-dlp returned something we can't use.
    throw new Error(`Could not get video info for URL: ${url}`);
  }

  // Get the best thumbnail URL (same logic as searchYouTube above).
  const thumbnail = (Array.isArray(info.thumbnails) && info.thumbnails.length > 0)
    ? info.thumbnails[info.thumbnails.length - 1].url
    : (info.thumbnail || '');

  return {
    title: info.title || 'Unknown Title',
    url: url,          // Use the original URL (yt-dlp's 'url' field is a stream URL, not the page)
    duration: info.duration || 0,
    thumbnail: thumbnail
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getAudioStream(url)
//
// Creates a live audio stream from a YouTube URL using yt-dlp as a subprocess.
// Returns a Node.js readable stream of raw audio data.
//
// This is what actually plays music — it pipes yt-dlp's output directly into
// Discord's audio player without downloading the file to disk.
//
// Why stream instead of download?
//   Streaming is instant (music starts immediately) and saves disk space.
//   Downloading would make the user wait and fill up your drive.
// ─────────────────────────────────────────────────────────────────────────────
function getAudioStream(url) {
  // child_process is a built-in Node.js module for running other programs.
  const { spawn } = require('child_process');

  // spawn() starts the 'yt-dlp' program as a child process with these arguments:
  //   url                     → the YouTube video to stream
  //   -f bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio
  //                           → pick the best audio-only format
  //                             (prefer m4a, then webm, then whatever's best)
  //   -o -                    → output (-o) to stdout (-) instead of a file
  const ytdlpProcess = spawn('yt-dlp', [
    url,
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '-o', '-'  // "-" as the output file means "write to stdout (the terminal/pipe)"
  ], {
    // stdio config: what to do with standard input, output, and error
    //   'ignore'  → don't connect stdin (we don't send yt-dlp any input)
    //   'pipe'    → connect stdout as a Node.js stream we can read from
    //   'pipe'    → connect stderr as a Node.js stream (for error messages)
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Log any errors yt-dlp prints to stderr (for debugging).
  // yt-dlp often prints warnings here that we can safely ignore.
  ytdlpProcess.stderr.on('data', (data) => {
    // Only log if it looks like an actual error, not an info message.
    const msg = data.toString();
    if (msg.toLowerCase().includes('error')) {
      console.error('[YOUTUBE] yt-dlp stderr:', msg.trim());
    }
  });

  // Return the stdout stream — this is the actual audio data.
  // The Discord audio player will read bytes from this stream to produce sound.
  return ytdlpProcess.stdout;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export functions for use by the music service and bot
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  searchAndResolve, // Search YouTube or resolve a URL → returns song metadata
  getAudioStream,   // Get a live audio byte stream from a YouTube URL
  isYouTubeUrl      // Check if a string is a YouTube URL
};
