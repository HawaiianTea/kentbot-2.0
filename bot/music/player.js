// ─────────────────────────────────────────────────────────────────────────────
// bot/music/player.js — The Music Player
//
// This is the heart of the music system. It manages:
//   • Connecting the bot to voice channels
//   • Fetching the next song from the music service
//   • Creating audio streams from YouTube URLs
//   • Playing audio through Discord's voice connection
//   • Handling the DJ intro TTS before songs
//   • Updating the "Now Playing" embed
//   • Auto-advancing to the next song when the current one ends
//
// This file lives in the main bot process (Process 1) because it needs the
// Discord voice connection, which requires the Discord.js client to be running.
//
// Think of this file as the DJ booth — it's where music actually gets played.
// ─────────────────────────────────────────────────────────────────────────────

// @discordjs/voice provides everything needed to connect to and play audio
// in Discord voice channels.
const {
  joinVoiceChannel,         // Connects the bot to a voice channel
  createAudioPlayer,        // Creates a player that can play audio resources
  createAudioResource,      // Wraps an audio stream in a Discord-compatible format
  AudioPlayerStatus,        // Enum with states: Idle, Playing, Paused, Buffering, AutoPaused
  VoiceConnectionStatus,    // Enum with states: Ready, Connecting, Disconnected, etc.
  entersState,              // Waits for a connection/player to reach a specific state
  StreamType                // Tells Discord what audio format we're sending
} = require('@discordjs/voice');

// Import state management — this is how we track what's happening per guild.
const {
  getGuildState,
  setGuildState,
  resetGuildState,
  getTextChannel,
  getDJMode
} = require('../state');

// Import the embed builder to update the "Now Playing" message.
const { updateNowPlayingMessage, clearNowPlayingMessage } = require('./embed');

// Import shared config for the service URLs.
const { MUSIC_SERVICE_URL, AI_SERVICE_URL } = require('../../shared/config');

// getAudioStream from youtube.js — gets a live audio byte stream from yt-dlp.
const { getAudioStream } = require('../../services/music/youtube');

// ─────────────────────────────────────────────────────────────────────────────
// callMusicService(path, method, body)
//
// Helper function for making HTTP requests to the music service.
// If the service is down, it throws an error with a helpful message.
//
// Parameters:
//   path   — the API endpoint path (e.g. '/next' or '/queue/123')
//   method — HTTP method: 'GET', 'POST', or 'DELETE'
//   body   — optional JavaScript object to send as JSON (for POST requests)
// ─────────────────────────────────────────────────────────────────────────────
async function callMusicService(path, method = 'GET', body = null) {
  try {
    // Build the full URL: base URL + path (e.g. "http://localhost:3001/next")
    const url = `${MUSIC_SERVICE_URL}${path}`;

    // Build the options object for fetch().
    const options = {
      method: method,  // 'GET', 'POST', or 'DELETE'
      headers: { 'Content-Type': 'application/json' }
      // Headers tell the server what format the request body is in.
    };

    // If there's a body to send (POST requests), convert it to a JSON string.
    if (body) {
      options.body = JSON.stringify(body);
      // JSON.stringify() converts a JavaScript object to a JSON text string.
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`Music service returned HTTP ${response.status}`);
    }

    // Parse and return the JSON response.
    return await response.json();

  } catch (err) {
    // If the music service is completely unreachable (connection refused),
    // fetch() throws a TypeError. We wrap it with a better message.
    if (err.code === 'ECONNREFUSED' || err.message.includes('fetch')) {
      throw new Error('Music service is not running. Start it with: node services/music/index.js');
    }
    throw err; // Re-throw other errors unchanged
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// callAIService(path, body)
//
// Helper function for making POST requests to the AI service.
// Returns null instead of throwing if the service is offline (AI is optional).
// ─────────────────────────────────────────────────────────────────────────────
async function callAIService(path, body) {
  try {
    const response = await fetch(`${AI_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) return null; // AI service error — return null gracefully
    return await response.json();

  } catch {
    // AI service is offline or unreachable — not a fatal error, music can still play.
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ensureVoiceConnection(voiceChannel)
//
// Makes sure the bot is connected to the given voice channel.
// If already connected to the same channel, returns the existing connection.
// If not connected, creates a new connection and waits for it to be ready.
//
// Parameters:
//   voiceChannel — a Discord VoiceChannel object (from interaction.member.voice.channel)
//
// Returns: a VoiceConnection object ready for audio playback
// ─────────────────────────────────────────────────────────────────────────────
async function ensureVoiceConnection(voiceChannel) {
  const guildId = voiceChannel.guild.id;
  // voiceChannel.guild is the Discord Guild (server) object.
  // .id is its unique string ID like "123456789012345678".

  const state = getGuildState(guildId);

  // Check if we already have a working connection to this guild.
  if (state.currentConnection &&
      state.currentConnection.state.status !== VoiceConnectionStatus.Destroyed) {
    // .state.status is the current status of the voice connection.
    // Destroyed means the connection was closed and can't be reused.
    return state.currentConnection; // Reuse the existing connection
  }

  // Create a new voice connection.
  // joinVoiceChannel() tells Discord the bot wants to join a voice channel.
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,      // The specific channel to join
    guildId: voiceChannel.guild.id,  // The server this channel belongs to
    // adapterCreator is the bridge between Discord.js and @discordjs/voice.
    // It's provided by the guild object and handles the low-level connection details.
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true   // The bot deafens itself (it doesn't need to hear users)
  });

  // Wait up to 10 seconds for the voice connection to become ready.
  // entersState() is like waiting at a red light — it pauses until the status changes.
  // If it takes more than 10,000ms, it throws a timeout error.
  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  // 10_000 is the same as 10000 — JavaScript allows underscores in numbers for readability.

  // Save the connection to state so we can reuse it.
  setGuildState(guildId, { currentConnection: connection });

  console.log(`[PLAYER] Joined voice channel: ${voiceChannel.name} in ${voiceChannel.guild.name}`);
  return connection;
}

// ─────────────────────────────────────────────────────────────────────────────
// startPlayback(guildId, voiceChannel)
//
// Starts the playback loop for a guild. Checks for the next song in the queue
// and plays it. When it finishes, automatically calls itself again for the
// next song, creating a continuous playback chain.
//
// This is the main "engine" that keeps music playing.
// ─────────────────────────────────────────────────────────────────────────────
async function startPlayback(guildId, voiceChannel) {
  // Wrap everything in try/catch so errors don't crash the whole bot.
  try {
    const state = getGuildState(guildId);

    // Don't start if already playing — prevents double-playing.
    if (state.isPlaying) {
      console.log(`[PLAYER] Already playing in guild ${guildId}, not starting again`);
      return;
    }

    // Get the next song from the music service's queue.
    // POST /next removes and returns the first song in the queue.
    const nextSong = await callMusicService('/next', 'POST', { guildId });

    if (!nextSong || !nextSong.url) {
      // No more songs in queue — stop playing.
      console.log(`[PLAYER] Queue is empty for guild ${guildId}, stopping`);
      resetGuildState(guildId);
      await clearNowPlayingMessage(guildId);
      return;
    }

    console.log(`[PLAYER] Starting: "${nextSong.title}"`);

    // Ensure we're connected to the voice channel.
    const connection = await ensureVoiceConnection(voiceChannel);

    // Get or create the AudioPlayer for this guild.
    // An AudioPlayer is like a CD player — it can play one thing at a time.
    let player = state.currentPlayer;
    if (!player) {
      player = createAudioPlayer();
      // createAudioPlayer() makes a new player that's not connected to anything yet.
    }

    // ── Handle DJ Mode: Play an intro before the song ─────────────────────
    const djEnabled = getDJMode(guildId);

    if (djEnabled) {
      // Mark that we're in the intro phase (affects embed display).
      setGuildState(guildId, {
        currentSong: nextSong,
        currentPlayer: player,
        currentConnection: connection,
        isPlaying: true,
        isIntroPlaying: true,
        isPaused: false,
        songStartTime: null
      });

      // Get the current queue (for the "Up Next" display in the embed).
      const queueList = await callMusicService(`/queue/${guildId}`, 'GET');
      await updateNowPlayingMessage(guildId, queueList || []);

      // Ask the AI service to generate a DJ intro text.
      const djResult = await callAIService('/dj-intro', { title: nextSong.title });
      const introText = djResult?.text;

      if (introText) {
        // Ask the AI service to synthesize the intro to speech.
        const ttsResult = await callAIService('/tts', { text: introText });
        const audioFilePath = ttsResult?.audioFilePath;

        if (audioFilePath) {
          // Play the TTS audio first, then play the actual song after.
          await playTTSThenSong(guildId, connection, player, audioFilePath, nextSong, voiceChannel);
          return; // playTTSThenSong handles the rest, including starting the next song
        }
      }

      // If DJ intro failed (AI service down, TTS failed, etc.), just play the song directly.
      console.log('[PLAYER] DJ intro unavailable, playing song directly');
    }

    // ── Play the song directly (no intro, or intro failed) ────────────────
    await playSong(guildId, connection, player, nextSong, voiceChannel);

  } catch (err) {
    console.error(`[PLAYER] Error in startPlayback for guild ${guildId}:`, err.message);
    // Reset state so the guild doesn't get stuck in a broken "playing" state.
    resetGuildState(guildId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// playTTSThenSong(guildId, connection, player, ttsFilePath, song, voiceChannel)
//
// Plays a TTS audio file, then automatically plays the actual song after.
// Used for DJ intros — this creates the seamless "intro → song" flow.
// ─────────────────────────────────────────────────────────────────────────────
async function playTTSThenSong(guildId, connection, player, ttsFilePath, song, voiceChannel) {
  try {
    // Create an AudioResource from the TTS file.
    // AudioResource is Discord's wrapper for audio data.
    // createAudioResource() reads the file and prepares it for playback.
    const ttsResource = createAudioResource(ttsFilePath, {
      // StreamType.Arbitrary means we're sending raw audio and Discord should
      // figure out the format itself. Works well for .wav files.
      inputType: StreamType.Arbitrary
    });

    // Connect the player to the voice connection.
    // connection.subscribe(player) says "this player's audio goes to this voice channel".
    connection.subscribe(player);

    // Start playing the TTS file.
    player.play(ttsResource);

    // When the TTS finishes, automatically play the song.
    // player.once() listens for an event exactly one time, then removes itself.
    // AudioPlayerStatus.Idle = "the player just finished playing something"
    player.once(AudioPlayerStatus.Idle, async () => {
      console.log('[PLAYER] DJ intro finished, starting song');

      // Mark that the intro is done.
      setGuildState(guildId, { isIntroPlaying: false });

      // Now play the actual song.
      await playSong(guildId, connection, player, song, voiceChannel);
    });

    // Handle player errors — if the TTS file fails to play, just play the song.
    player.once('error', async (err) => {
      console.error('[PLAYER] TTS playback error, skipping to song:', err.message);
      setGuildState(guildId, { isIntroPlaying: false });
      await playSong(guildId, connection, player, song, voiceChannel);
    });

  } catch (err) {
    console.error('[PLAYER] Error playing TTS intro:', err.message);
    // Fall back to playing the song without an intro.
    await playSong(guildId, connection, player, song, voiceChannel);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// playSong(guildId, connection, player, song, voiceChannel)
//
// Plays a single song through the voice connection.
// When the song finishes, automatically calls startPlayback() for the next song.
// ─────────────────────────────────────────────────────────────────────────────
async function playSong(guildId, connection, player, song, voiceChannel) {
  try {
    // Get a live audio stream from yt-dlp for this YouTube URL.
    // This starts downloading audio from YouTube and pipes it directly to Discord.
    const audioStream = getAudioStream(song.url);

    // Create an AudioResource from the stream.
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.Arbitrary  // Let Discord handle the format detection
    });

    // Connect the player to voice and start playing.
    connection.subscribe(player);
    player.play(resource);

    // Record when this song started (for progress bar calculation).
    const songStartTime = Date.now();
    // Date.now() returns the current time in milliseconds since Jan 1, 1970.

    // Update state: mark as playing, not intro, set start time.
    setGuildState(guildId, {
      isPlaying: true,
      isPaused: false,
      isIntroPlaying: false,
      currentSong: song,
      currentPlayer: player,
      currentConnection: connection,
      songStartTime: songStartTime
    });

    // Get the queue for the "Up Next" display.
    const queueList = await callMusicService(`/queue/${guildId}`, 'GET').catch(() => []);
    await updateNowPlayingMessage(guildId, queueList || []);

    // Start a timer that updates the progress bar every 10 seconds.
    // setInterval() repeatedly calls a function at a fixed time interval.
    const progressTimer = setInterval(async () => {
      // Get fresh queue data on each update.
      const freshQueue = await callMusicService(`/queue/${guildId}`, 'GET').catch(() => []);
      await updateNowPlayingMessage(guildId, freshQueue || []);
    }, 10_000); // 10,000ms = 10 seconds

    // Save the timer ID so we can stop it when the song ends.
    setGuildState(guildId, { progressTimer });

    console.log(`[PLAYER] Now playing: "${song.title}"`);

    // ── When the song finishes, play the next one ────────────────────────
    // player.once() fires once when the player goes idle (song finished).
    player.once(AudioPlayerStatus.Idle, async () => {
      console.log(`[PLAYER] Finished: "${song.title}"`);

      // Stop the progress bar timer.
      const currentState = getGuildState(guildId);
      if (currentState.progressTimer) {
        clearInterval(currentState.progressTimer);
      }

      // Mark as not playing anymore.
      setGuildState(guildId, {
        isPlaying: false,
        progressTimer: null,
        songStartTime: null
      });

      // Wait 500ms before starting the next song.
      // This small delay prevents race conditions between audio finishing and
      // the next song starting. Think of it as giving the record player a moment.
      await new Promise(resolve => setTimeout(resolve, 500));
      // new Promise() creates a deferred operation.
      // setTimeout(resolve, 500) calls resolve (completing the promise) after 500ms.
      // await pauses execution until resolve is called.

      // Start the next song (or stop if queue is empty).
      await startPlayback(guildId, voiceChannel);
    });

    // ── Handle player errors ────────────────────────────────────────────
    player.once('error', async (err) => {
      console.error(`[PLAYER] Audio player error for "${song.title}":`, err.message);

      const currentState = getGuildState(guildId);
      if (currentState.progressTimer) {
        clearInterval(currentState.progressTimer);
      }

      setGuildState(guildId, { isPlaying: false, progressTimer: null });

      // Try to continue with the next song even after an error.
      await startPlayback(guildId, voiceChannel);
    });

  } catch (err) {
    console.error(`[PLAYER] Error playing song "${song.title}":`, err.message);
    setGuildState(guildId, { isPlaying: false });
    // Try the next song in the queue.
    await startPlayback(guildId, voiceChannel);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// skip(guildId)
//
// Skips the currently playing song by forcing the player to stop.
// The AudioPlayerStatus.Idle event fires, which triggers startPlayback() for
// the next song automatically.
// ─────────────────────────────────────────────────────────────────────────────
function skip(guildId) {
  const state = getGuildState(guildId);

  if (!state.currentPlayer || !state.isPlaying) {
    return false; // Nothing to skip — return false to signal "skip failed"
  }

  // .stop() stops the player, which triggers the AudioPlayerStatus.Idle event,
  // which then calls startPlayback() for the next song.
  state.currentPlayer.stop();
  return true; // Skip succeeded
}

// ─────────────────────────────────────────────────────────────────────────────
// pause(guildId)
//
// Pauses audio playback. The player freezes at the current position.
// ─────────────────────────────────────────────────────────────────────────────
function pause(guildId) {
  const state = getGuildState(guildId);

  if (!state.currentPlayer || !state.isPlaying || state.isPaused) {
    return false; // Nothing to pause
  }

  state.currentPlayer.pause();
  // .pause() freezes the audio player in place.

  setGuildState(guildId, { isPaused: true });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// resume(guildId)
//
// Resumes paused playback.
// ─────────────────────────────────────────────────────────────────────────────
function resume(guildId) {
  const state = getGuildState(guildId);

  if (!state.currentPlayer || !state.isPaused) {
    return false; // Nothing to resume
  }

  state.currentPlayer.unpause();
  // .unpause() resumes playing from where it was paused.

  setGuildState(guildId, { isPaused: false });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// stop(guildId)
//
// Stops all playback, clears the queue, and disconnects the bot from voice.
// ─────────────────────────────────────────────────────────────────────────────
async function stop(guildId) {
  const state = getGuildState(guildId);

  // Stop the audio player if one is running.
  if (state.currentPlayer) {
    // Remove the 'Idle' listener first to prevent startPlayback() from firing.
    state.currentPlayer.removeAllListeners(AudioPlayerStatus.Idle);
    state.currentPlayer.stop();
    // .removeAllListeners() removes all event listeners for the given event.
    // Without this, stopping the player would trigger the "song finished → play next" logic.
  }

  // Disconnect from the voice channel.
  if (state.currentConnection &&
      state.currentConnection.state.status !== VoiceConnectionStatus.Destroyed) {
    state.currentConnection.destroy();
    // .destroy() disconnects the bot from the voice channel and frees the connection.
  }

  // Clear the queue in the music service.
  try {
    await callMusicService(`/queue/${guildId}`, 'DELETE');
  } catch { /* Ignore if music service is down */ }

  // Clear the "Now Playing" embed.
  await clearNowPlayingMessage(guildId);

  // Reset all state for this guild back to defaults.
  resetGuildState(guildId);

  console.log(`[PLAYER] Stopped and cleared guild ${guildId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export all player functions
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  startPlayback,          // Start playing the next song in queue
  ensureVoiceConnection,  // Connect to a voice channel (or reuse existing connection)
  skip,                   // Skip the current song
  pause,                  // Pause playback
  resume,                 // Resume paused playback
  stop                    // Stop everything, clear queue, disconnect
};
