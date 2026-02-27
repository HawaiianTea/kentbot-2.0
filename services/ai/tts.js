// ─────────────────────────────────────────────────────────────────────────────
// services/ai/tts.js — Text-to-speech synthesis (local XTTS v2 or ElevenLabs)
//
// Supports two TTS providers, selected by TTS_PROVIDER in your .env file:
//
//   'local' (default) — Coqui XTTS v2
//     Runs entirely on your machine. Clones a custom voice from a .wav sample.
//     Slow on weak hardware (~10-60 seconds per clip depending on CPU/GPU).
//     Setup: pip install TTS, add a voice-samples/kent.wav file.
//
//   'elevenlabs' — ElevenLabs cloud API
//     Fast cloud synthesis (~1-2 seconds). Requires an API key and chosen voice.
//     Setup: set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.
//     Returns an .mp3 file (Discord plays it fine via ffmpeg).
//
// Both providers return a local file path the bot can play in voice chat.
// ─────────────────────────────────────────────────────────────────────────────

// child_process is built into Node.js for running other programs.
const { spawn } = require('child_process');

// path and fs help us work with file paths and check file existence.
const path = require('path');
const fs = require('fs');

// crypto generates unique random IDs for output file names.
const crypto = require('crypto');

// Import TTS config (voice sample path, output directory).
const { TTS } = require('../../shared/config');

// ── Ensure the TTS output directory exists ───────────────────────────────────
// mkdirSync creates the directory if it doesn't exist.
// { recursive: true } means it also creates any parent folders needed.
// This is called once when this module loads (not inside a function).
try {
  fs.mkdirSync(TTS.OUTPUT_DIR, { recursive: true });
} catch (err) {
  // Only log if it's not an "already exists" error.
  if (err.code !== 'EEXIST') {
    console.error('[TTS] Could not create output dir:', err.message);
  }
}

// ── Path to the Python script that runs XTTS ─────────────────────────────────
// This Python script lives in the root of the project.
const TTS_SCRIPT_PATH = path.join(__dirname, '../../tts_synthesize.py');
// __dirname = the folder this file (tts.js) is in: services/ai/
// ../../ = go up two levels to the project root
// tts_synthesize.py = the script file

// ── Python executable path ────────────────────────────────────────────────────
// The setup.sh script creates a Python virtual environment at tts_venv/ and
// installs the TTS package inside it. We prefer that venv's Python because it
// has all the required packages. If the venv doesn't exist yet, fall back to
// the system python3 (which may or may not have TTS installed).
const VENV_PYTHON = path.join(__dirname, '../../tts_venv/bin/python3');
// VENV_PYTHON = the absolute path to the venv's Python executable.
// If the setup script ran, this file exists and has TTS installed.

const PYTHON_BIN = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
// fs.existsSync() returns true if the file exists.
// If the venv Python exists, use it. Otherwise fall back to system python3.

// ─────────────────────────────────────────────────────────────────────────────
// synthesize(text)
//
// Converts text to speech using whichever provider is configured.
// Dispatches to synthesizeLocal() or synthesizeElevenLabs() based on TTS_PROVIDER.
//
// Parameters:
//   text — the text to speak aloud (e.g. "Well howdy, partners!")
//
// Returns: the file path to the generated audio file (string)
//          Throws an error if synthesis fails.
// ─────────────────────────────────────────────────────────────────────────────
async function synthesize(text) {
  if (TTS.PROVIDER === 'elevenlabs') {
    return synthesizeElevenLabs(text);
  }
  // Default to local XTTS v2.
  return synthesizeLocal(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// synthesizeLocal(text)
//
// Synthesizes speech using the local Coqui XTTS v2 model via a Python subprocess.
// Clones the voice from the configured voice sample .wav file.
// ─────────────────────────────────────────────────────────────────────────────
async function synthesizeLocal(text) {
  // Validate that the voice sample file exists before trying to use it.
  const voiceSamplePath = path.resolve(TTS.VOICE_SAMPLE);
  // path.resolve() converts a relative path like "voice-samples/kent.wav"
  // to an absolute path like "/home/nelly/scripts/kentbot/voice-samples/kent.wav"

  if (!fs.existsSync(voiceSamplePath)) {
    // fs.existsSync() returns true if the file exists, false if not.
    throw new Error(
      `Voice sample not found at: ${voiceSamplePath}\n` +
      `Please add a .wav voice file and set TTS_VOICE_SAMPLE in your .env file.`
    );
  }

  // Generate a unique filename for this TTS output.
  // crypto.randomBytes(8) generates 8 random bytes.
  // .toString('hex') converts them to a 16-character hex string like "a3f9c12b7e004d1a".
  // This prevents file name collisions if multiple TTS requests happen at once.
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const outputPath = path.join(TTS.OUTPUT_DIR, `tts-${uniqueId}.wav`);
  // Example result: "/tmp/kentbot-tts/tts-a3f9c12b7e004d1a.wav"

  console.log(`[TTS/local] Synthesizing: "${text.slice(0, 60)}..."`);

  // Run the Python TTS script as a subprocess.
  // We pass the text, voice sample path, and output path as command-line arguments.
  await runTTSScript(text, voiceSamplePath, outputPath);

  // Verify the output file was actually created.
  if (!fs.existsSync(outputPath)) {
    throw new Error('TTS script ran but no output file was created');
  }

  console.log(`[TTS/local] Synthesis complete: ${outputPath}`);
  return outputPath;  // Return the path so the bot can play this file
}

// ─────────────────────────────────────────────────────────────────────────────
// synthesizeElevenLabs(text)
//
// Synthesizes speech by calling the ElevenLabs REST API.
// Returns a path to the downloaded .mp3 file in the TTS output directory.
//
// API docs: https://elevenlabs.io/docs/api-reference/text-to-speech
// The API returns raw MP3 bytes in the response body.
// ─────────────────────────────────────────────────────────────────────────────
async function synthesizeElevenLabs(text) {
  // Validate required config.
  if (!TTS.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not set in your .env file.');
  }
  if (!TTS.ELEVENLABS_VOICE_ID) {
    throw new Error('ELEVENLABS_VOICE_ID is not set in your .env file.');
  }

  console.log(`[TTS/elevenlabs] Synthesizing: "${text.slice(0, 60)}..."`);

  // Call the ElevenLabs text-to-speech API.
  // POST /v1/text-to-speech/{voice_id} — returns raw MP3 audio bytes.
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${TTS.ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': TTS.ELEVENLABS_API_KEY,  // Auth header ElevenLabs requires
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'                 // Ask for MP3 format
      },
      body: JSON.stringify({
        text: text,
        model_id: TTS.ELEVENLABS_MODEL,
        // voice_settings are optional — these are the API defaults, good for DJ speech.
        voice_settings: {
          stability: 0.5,         // 0–1: higher = more consistent, lower = more expressive
          similarity_boost: 0.75  // 0–1: how closely to match the voice clone
        }
      })
    }
  );

  if (!response.ok) {
    // Try to extract an error message from the response body.
    const errText = await response.text().catch(() => '');
    throw new Error(`ElevenLabs API error ${response.status}: ${errText}`);
  }

  // The response body IS the audio — read it as a binary buffer.
  // response.arrayBuffer() reads the whole response as raw bytes.
  // Buffer.from() converts it to a Node.js Buffer we can write to disk.
  const audioBuffer = Buffer.from(await response.arrayBuffer());

  // Save the MP3 to disk so the bot can play it from a file path.
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const outputPath = path.join(TTS.OUTPUT_DIR, `tts-${uniqueId}.mp3`);
  // Note: .mp3 extension — ElevenLabs returns MP3. Discord plays it fine via ffmpeg.

  fs.writeFileSync(outputPath, audioBuffer);
  // writeFileSync() writes the buffer to disk synchronously.
  // Synchronous is fine here since we just got the bytes and the file is small.

  console.log(`[TTS/elevenlabs] Synthesis complete: ${outputPath} (${audioBuffer.length} bytes)`);
  return outputPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// runTTSScript(text, voiceSamplePath, outputPath)
//
// Runs the tts_synthesize.py Python script as a subprocess.
// Returns a Promise that resolves when synthesis is complete, or rejects on error.
//
// This is wrapped in a Promise because spawn() uses callbacks, but we want
// to use await so the rest of the code reads clearly top to bottom.
// ─────────────────────────────────────────────────────────────────────────────
function runTTSScript(text, voiceSamplePath, outputPath) {
  // Return a Promise — this is what allows 'await runTTSScript(...)' to work.
  // A Promise represents work that will complete in the future.
  // The executor function (the callback to 'new Promise') runs immediately.
  return new Promise((resolve, reject) => {
    // resolve = call this when the work succeeds (like returning from a function)
    // reject  = call this when the work fails (like throwing an error)

    // Spawn the Python process with three command-line arguments:
    //   argv[1] = text to synthesize
    //   argv[2] = path to the voice sample file
    //   argv[3] = path where the output .wav should be saved
    const pythonProcess = spawn(PYTHON_BIN, [
      TTS_SCRIPT_PATH,  // The script to run
      text,             // argv[1] in the Python script
      voiceSamplePath,  // argv[2] in the Python script
      outputPath        // argv[3] in the Python script
    ], {
      // COQUI_TOS_AGREED=1 bypasses the interactive Terms of Service prompt that
      // XTTS v2 shows when downloading the model for the first time. Without this,
      // the script hangs waiting for y/n input that never comes (no terminal = EOFError).
      env: { ...process.env, COQUI_TOS_AGREED: '1' }
    });

    // Capture any output Python prints to stdout (normal messages).
    let stdoutData = '';
    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
      // Accumulate all stdout output as a string for debugging.
    });

    // Capture any output Python prints to stderr (error messages, warnings).
    let stderrData = '';
    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      // Model loading messages and progress bars print to stderr.
    });

    // This event fires when the Python process exits.
    // 'code' is the exit code — 0 means success, anything else means failure.
    pythonProcess.on('close', (code) => {
      if (code === 0) {
        // Exit code 0 = success. The .wav file should now exist.
        if (stdoutData.trim()) {
          console.log('[TTS] Python output:', stdoutData.trim());
        }
        resolve(); // Tell the caller the work is done successfully
      } else {
        // Non-zero exit code = something went wrong.
        const errorMsg = stderrData.trim() || stdoutData.trim() || `Exit code ${code}`;
        console.error('[TTS] Python process failed:', errorMsg);
        reject(new Error(`TTS synthesis failed: ${errorMsg}`));
        // reject() causes the awaiting code to throw an error
      }
    });

    // Handle cases where the Python process couldn't even start.
    pythonProcess.on('error', (err) => {
      console.error('[TTS] Failed to start Python process:', err.message);
      reject(new Error(
        `Could not start Python for TTS. Is python3 installed?\n` +
        `Error: ${err.message}\n` +
        `Also ensure TTS is installed: pip install TTS`
      ));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// cleanupOldFiles()
//
// Deletes TTS output files older than 1 hour to prevent /tmp from filling up.
// Called periodically to keep disk usage low.
//
// Each TTS synthesis creates a temporary .wav file. Without cleanup, these
// accumulate over time. Since they're only needed while playing, we can safely
// delete them after an hour.
// ─────────────────────────────────────────────────────────────────────────────
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(TTS.OUTPUT_DIR);
    // readdirSync() returns an array of all filenames in the directory.

    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    // Date.now() is the current time in milliseconds.
    // 60 * 60 * 1000 = 3,600,000 ms = 1 hour.
    // So oneHourAgo is the timestamp for "1 hour before right now".

    for (const file of files) {
      // Process each file in the directory.
      const filePath = path.join(TTS.OUTPUT_DIR, file);
      const stats = fs.statSync(filePath);
      // statSync() returns file metadata including creation/modification times.

      if (stats.mtimeMs < oneHourAgo) {
        // mtimeMs = modification time in milliseconds.
        // If the file was last modified more than 1 hour ago, delete it.
        fs.unlinkSync(filePath);
        // unlinkSync() deletes a file. ("unlink" is the Unix term for deleting.)
      }
    }
  } catch (err) {
    // Cleanup failure is not critical — just log it.
    console.warn('[TTS] Cleanup error:', err.message);
  }
}

// Run cleanup every 30 minutes.
// setInterval() calls a function repeatedly at a set interval (in milliseconds).
// 30 * 60 * 1000 = 1,800,000 ms = 30 minutes.
setInterval(cleanupOldFiles, 30 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Export for use by the AI service HTTP server
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  synthesize  // Convert text to speech → returns path to .wav file
};
