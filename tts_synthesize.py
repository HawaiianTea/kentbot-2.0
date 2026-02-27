#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# tts_synthesize.py — Text-to-Speech synthesis using Coqui XTTS v2
#
# This Python script is called by the AI service (services/ai/tts.js) to
# convert text into spoken audio using a cloned voice.
#
# XTTS v2 (Extended TTS version 2) is an AI model that can:
#   1. Listen to a short voice sample (at least 6 seconds)
#   2. Learn the unique characteristics of that voice
#   3. Speak any new text in that same cloned voice
#
# How this script is called:
#   python3 tts_synthesize.py "Text to speak" "path/to/voice.wav" "path/to/output.wav"
#
# Arguments (from sys.argv):
#   sys.argv[0] = this script's filename (automatic, always present)
#   sys.argv[1] = the text to synthesize into speech
#   sys.argv[2] = path to the voice sample .wav file to clone from
#   sys.argv[3] = path where the output .wav audio file should be saved
#
# Setup:
#   pip install TTS
#   (The TTS package includes the Coqui XTTS v2 model)
#   First run is slower because it downloads the XTTS v2 model (~1.8GB).
# ─────────────────────────────────────────────────────────────────────────────

# sys provides access to command-line arguments (sys.argv).
import sys

# os provides file system operations like checking if a file exists.
import os


def main():
    """
    Main function that runs the TTS synthesis.

    In Python, functions defined with 'def' contain reusable code.
    'main()' is a common convention for the primary entry point function.
    The triple-quoted string below the 'def' line is a "docstring" —
    it's documentation that explains what the function does.
    """

    # ── Validate command-line arguments ──────────────────────────────────────
    # sys.argv is a list of all command-line arguments passed to this script.
    # We expect exactly 3 arguments after the script name (total length = 4).
    if len(sys.argv) != 4:
        # len() returns the length (number of items) of a list.
        # If we don't have exactly the right number of arguments, explain the problem.
        print("ERROR: Wrong number of arguments.", file=sys.stderr)
        print("Usage: python3 tts_synthesize.py <text> <voice_sample> <output_path>", file=sys.stderr)
        # file=sys.stderr writes to the error output (separate from normal output).
        # The Node.js parent process captures stderr for error detection.
        sys.exit(1)
        # sys.exit(1) stops the script with exit code 1 (non-zero = error).
        # The Node.js process sees this exit code and knows something went wrong.

    # Extract the three arguments from the list.
    # sys.argv[1], [2], [3] are the first, second, and third arguments after the script name.
    text_to_speak = sys.argv[1]       # The text we want to say aloud
    voice_sample_path = sys.argv[2]   # Path to the voice sample to clone from
    output_wav_path = sys.argv[3]     # Where to save the generated speech

    # ── Validate that the voice sample file exists ───────────────────────────
    if not os.path.exists(voice_sample_path):
        # os.path.exists() returns True if the file or folder exists.
        # 'not' reverses it: True becomes False, False becomes True.
        print(f"ERROR: Voice sample file not found: {voice_sample_path}", file=sys.stderr)
        # f"..." is an f-string (formatted string literal) — it embeds variable values.
        sys.exit(1)

    # ── Ensure the output directory exists ───────────────────────────────────
    # os.path.dirname() gets just the folder part of a full file path.
    # e.g. "/tmp/kentbot-tts/tts-abc123.wav" → "/tmp/kentbot-tts"
    output_dir = os.path.dirname(output_wav_path)
    if output_dir:
        # os.makedirs() creates the folder and any needed parent folders.
        # exist_ok=True means "don't raise an error if the folder already exists".
        os.makedirs(output_dir, exist_ok=True)

    # ── Load XTTS v2 model and synthesize speech ─────────────────────────────
    print(f"[TTS] Synthesizing: {text_to_speak[:50]}...", flush=True)
    # [:50] slices the string to show only the first 50 characters in the log.
    # flush=True forces the message to print immediately (important for subprocess logging).

    # Import TTS here (inside the function) so startup is faster if we hit an error above.
    # 'from X import Y' imports just Y from the X package (more specific than 'import X').

    # PyTorch 2.6 changed torch.load to default weights_only=True, which breaks
    # Coqui TTS's model loading (it pickles custom classes that aren't on the allowlist).
    # We patch torch.load to restore the old default before TTS is imported.
    import torch
    _real_torch_load = torch.load
    def _patched_torch_load(*args, **kwargs):
        kwargs.setdefault('weights_only', False)
        return _real_torch_load(*args, **kwargs)
    torch.load = _patched_torch_load

    from TTS.api import TTS
    # TTS is the main class from the Coqui TTS library.

    # Create a TTS instance configured for the XTTS v2 model.
    # The model name "tts_models/multilingual/multi-dataset/xtts_v2" tells
    # Coqui exactly which model to use — this is their best voice-cloning model.
    # gpu=False forces CPU-only mode since we have limited VRAM (2GB GTX 660 Ti).
    # Set gpu=True if you upgrade to a card with more VRAM (6GB+).
    print("[TTS] Loading XTTS v2 model (first run downloads ~1.8GB)...", flush=True)
    tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=False)
    # TTS() loads the model into memory. This takes ~30 seconds the first time,
    # and ~10 seconds on subsequent calls (model cached locally after first download).

    # ── Synthesize the speech ─────────────────────────────────────────────────
    print("[TTS] Synthesizing audio...", flush=True)

    # tts_to_file() is the main synthesis function.
    # It generates speech from 'text', clones the voice from 'speaker_wav',
    # sets the language to English ("en"), and saves the audio to 'file_path'.
    tts.tts_to_file(
        text=text_to_speak,           # The text to convert to speech
        speaker_wav=voice_sample_path, # The voice sample to clone from (must be .wav)
        language="en",                 # Language code: "en" = English
        file_path=output_wav_path      # Where to save the output audio
    )

    # ── Verify the output was created ────────────────────────────────────────
    if os.path.exists(output_wav_path):
        # Get the file size to confirm it's not empty.
        file_size = os.path.getsize(output_wav_path)
        # os.path.getsize() returns the file size in bytes.
        print(f"[TTS] Success! Output: {output_wav_path} ({file_size} bytes)", flush=True)
        sys.exit(0)
        # sys.exit(0) exits with code 0 = success. Node.js sees this and resolves the Promise.
    else:
        print(f"ERROR: Output file was not created: {output_wav_path}", file=sys.stderr)
        sys.exit(1)


# ── Script entry point ────────────────────────────────────────────────────────
# In Python, when a file is run directly (not imported), __name__ equals "__main__".
# This pattern ensures main() only runs when the script is executed directly,
# not when it's imported by another Python file.
if __name__ == "__main__":
    main()
