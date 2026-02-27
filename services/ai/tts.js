// ─────────────────────────────────────────────────────────────────────────────
// services/ai/tts.js — Local text-to-speech via Coqui XTTS v2
//
// This file converts text into speech audio using XTTS v2, a local AI model
// that can clone a voice from a short audio sample.
//
// How it works:
//   1. We spawn a Python script (tts_synthesize.py) as a subprocess
//   2. The Python script loads XTTS v2, clones the voice from the sample file,
//      and synthesizes the text into a .wav audio file
//   3. We return the path to that audio file
//   4. The bot then reads that file and plays it in the Discord voice channel
//
// Why Python instead of JavaScript?
//   Coqui TTS / XTTS v2 only has a Python library. We bridge the gap by
//   running Python from Node.js using child_process.spawn().
//
// Setup required:
//   pip install TTS
//   And place a voice sample .wav file at the path set in TTS_VOICE_SAMPLE.
//
// Performance note:
//   The first call loads the XTTS model (~30 seconds). We keep the Python
//   process alive between calls so subsequent calls are faster (~5-10 seconds).
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
// Converts text to speech using XTTS v2 and the configured voice sample.
//
// Parameters:
//   text — the text to speak aloud (e.g. "Well howdy, partners!")
//
// Returns: the file path to the generated .wav audio file (string)
//          Throws an error if synthesis fails.
// ─────────────────────────────────────────────────────────────────────────────
async function synthesize(text) {
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

  console.log(`[TTS] Synthesizing text: "${text.slice(0, 60)}..."`);
  // .slice(0, 60) shows just the first 60 characters in the log to keep it readable.

  // Run the Python TTS script as a subprocess.
  // We pass the text, voice sample path, and output path as command-line arguments.
  await runTTSScript(text, voiceSamplePath, outputPath);

  // Verify the output file was actually created.
  if (!fs.existsSync(outputPath)) {
    throw new Error('TTS script ran but no output file was created');
  }

  console.log(`[TTS] Synthesis complete: ${outputPath}`);
  return outputPath;  // Return the path so the bot can play this file
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
