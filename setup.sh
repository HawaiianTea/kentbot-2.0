#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — Kentbot 2.0 one-time setup script for Arch Linux
#
# Run this once after dropping the project folder on a new machine.
# It installs all system dependencies, sets up Python TTS, installs Ollama,
# pulls the AI model, and installs Node.js packages.
#
# What it does NOT touch:
#   • Your .env file (you fill that in yourself)
#   • Your voice sample (drop a .wav in voice-samples/ yourself)
#
# How to run:
#   chmod +x setup.sh
#   ./setup.sh
# ─────────────────────────────────────────────────────────────────────────────

# 'set -e' makes the script stop immediately if any command fails.
# Without it, errors are silently ignored and the script keeps going.
set -e

# ── Colors for prettier output ────────────────────────────────────────────────
# ANSI escape codes for colored terminal text.
# \033[ starts the code, the number sets the color, m ends it.
# 0m resets back to normal.
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Helper functions for printing colored status messages.
info()    { echo -e "${CYAN}[INFO]${RESET} $1"; }
success() { echo -e "${GREEN}[OK]${RESET}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET} $1"; }
header()  { echo -e "\n${BOLD}${GREEN}══ $1 ══${RESET}"; }

# ── Make sure we're in the right directory ────────────────────────────────────
# SCRIPT_DIR is the folder this script lives in (the project root).
# $( ) runs a command and captures its output.
# dirname "$0" = the directory of the script being run.
# realpath converts it to an absolute path (handles relative paths safely).
SCRIPT_DIR="$(realpath "$(dirname "$0")")"

# Determine the real (non-root) user who invoked this script.
# When run as 'sudo bash setup.sh', sudo sets $SUDO_USER to the original username.
# This is needed because makepkg refuses to run as root — we drop back down to
# this user for that specific step.
# If $SUDO_USER is empty (script was run directly as root with no sudo), fall back
# to $USER. In that case makepkg will still fail, but we warn clearly below.
REAL_USER="${SUDO_USER:-$USER}"

# Change into the project directory so all relative paths work correctly.
cd "$SCRIPT_DIR"
info "Working directory: $SCRIPT_DIR"
info "Running as: $(whoami) (real user: $REAL_USER)"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: System packages via pacman
# ─────────────────────────────────────────────────────────────────────────────
header "Step 1: System packages"

# Check if a command exists before trying to install it.
# 'command -v foo' returns 0 (success) if foo is installed, 1 if not.
# '&> /dev/null' silences all output (both stdout and stderr).

install_if_missing() {
  # $1 = command to check, $2 = pacman package name (if different)
  local cmd="$1"
  local pkg="${2:-$1}"   # If $2 not given, use $1 as the package name
  if ! command -v "$cmd" &>/dev/null; then
    info "Installing $pkg..."
    sudo pacman -S --noconfirm "$pkg"
    # --noconfirm skips the "Are you sure?" prompt for automated installs.
    success "$pkg installed"
  else
    success "$pkg already installed"
  fi
}

# node and npm — required to run the bot
install_if_missing node nodejs
install_if_missing npm npm

# ffmpeg — required for audio encoding/decoding in Discord voice
install_if_missing ffmpeg ffmpeg

# python — required for XTTS voice synthesis
install_if_missing python3 python

# python-pip — required to install the TTS Python package
# pip might be available as 'pip' or 'pip3' — check both
if ! command -v pip3 &>/dev/null && ! command -v pip &>/dev/null; then
  info "Installing python-pip..."
  sudo pacman -S --noconfirm python-pip
  success "python-pip installed"
else
  success "pip already installed"
fi

# yt-dlp — YouTube downloader (also available as npm package, system install is more reliable)
install_if_missing yt-dlp yt-dlp

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: Node.js packages
# ─────────────────────────────────────────────────────────────────────────────
header "Step 2: Node.js packages"

info "Running npm install..."
npm install
success "Node.js packages installed"

# Install PM2 globally — the process manager that keeps the bot running 24/7.
# '-g' means install globally so 'pm2' is available as a command anywhere.
if ! command -v pm2 &>/dev/null; then
  info "Installing PM2 globally..."
  sudo npm install -g pm2
  success "PM2 installed"
else
  success "PM2 already installed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: Python virtual environment + Coqui TTS
# ─────────────────────────────────────────────────────────────────────────────
header "Step 3: Python TTS environment"

# Coqui TTS (the 'TTS' pip package) requires Python >= 3.9 and < 3.12.
# Arch Linux ships Python 3.12+ which is incompatible, so we need to find
# a compatible version before creating the venv.

# Try specific version binaries first (most likely to be compatible),
# then fall back to the generic python3 if it happens to be in range.
PYTHON_BIN=""
for py_cmd in python3.11 python3.10 python3.9 python3; do
  # Skip if this binary doesn't exist on the system.
  if ! command -v "$py_cmd" &>/dev/null; then
    continue
  fi
  # Read the minor version number (e.g. 11 for Python 3.11).
  PY_MINOR=$("$py_cmd" -c "import sys; print(sys.version_info.minor)" 2>/dev/null)
  PY_MAJOR=$("$py_cmd" -c "import sys; print(sys.version_info.major)" 2>/dev/null)
  # Accept any 3.9, 3.10, or 3.11 — those are what Coqui TTS supports.
  if [ "$PY_MAJOR" = "3" ] && [ "$PY_MINOR" -ge 9 ] && [ "$PY_MINOR" -le 11 ]; then
    PYTHON_BIN="$py_cmd"
    break
  fi
done

# If no compatible Python found, install python311 from the AUR manually.
# python311 is an AUR package that installs Python 3.11 alongside the system Python.
# We don't need yay — we can use git + makepkg, which is available on any Arch system
# with base-devel installed (git is a step-1 dependency we can install with pacman).
if [ -z "$PYTHON_BIN" ]; then
  warn "No compatible Python (3.9–3.11) found on this system."
  info "Installing python311 from AUR via git + makepkg (may take 10–15 min to compile)..."

  # Ensure git and base-devel are present — makepkg needs them to build AUR packages.
  sudo pacman -S --noconfirm git base-devel

  # Clone the AUR package into a temporary directory, build it, and install.
  # mktemp -d creates a unique temp directory that gets cleaned up after.
  TMP_AUR=$(mktemp -d)
  git clone https://aur.archlinux.org/python311.git "$TMP_AUR/python311"

  # makepkg refuses to run as root — give ownership of the build dir to the real user.
  chown -R "$REAL_USER" "$TMP_AUR"

  # Drop back down to the real user just for the makepkg step.
  # sudo -u runs the following command as the specified user.
  # -s = install missing build dependencies via pacman automatically
  # -i = install the finished package automatically
  # --noconfirm = skip interactive prompts
  sudo -u "$REAL_USER" bash -c "cd '$TMP_AUR/python311' && makepkg -si --noconfirm" || true
  # '|| true' prevents set -e from stopping the script if the build fails.

  # Clean up the temp build directory.
  rm -rf "$TMP_AUR"

  # Check if the install worked.
  if command -v python3.11 &>/dev/null; then
    PYTHON_BIN="python3.11"
    success "python311 installed from AUR"
  else
    warn "AUR build of python311 failed or did not produce python3.11."
  fi
fi

# If we still don't have a compatible Python, skip TTS gracefully.
# The bot works fine without TTS — /play still works, just no DJ intro voice.
if [ -z "$PYTHON_BIN" ]; then
  echo ""
  echo -e "${RED}[SKIP] Could not find or install Python 3.9–3.11.${RESET}"
  echo -e "${YELLOW}       Coqui TTS requires Python < 3.12. Automatic AUR install failed.${RESET}"
  echo -e "${YELLOW}       To fix manually, install python311 from the AUR:${RESET}"
  echo -e "${YELLOW}         git clone https://aur.archlinux.org/python311.git${RESET}"
  echo -e "${YELLOW}         cd python311 && makepkg -si${RESET}"
  echo -e "${YELLOW}       Then re-run this script. The bot works without TTS (no DJ intro voice).${RESET}"
  echo ""
  # Don't exit — let the rest of setup continue (Ollama, Node, etc. still work).
else
  PY_VER=$("$PYTHON_BIN" --version 2>&1)
  success "Using $PYTHON_BIN ($PY_VER) for TTS venv"

  # We create a Python virtual environment (venv) inside the project folder.
  # A venv is an isolated Python installation — packages installed here don't
  # interfere with the system Python or other projects.
  VENV_DIR="$SCRIPT_DIR/tts_venv"

  # If a venv already exists, check that it was built with a compatible Python.
  # A previous failed setup attempt may have created a venv with Python 3.12+,
  # which will still fail even though we now have python3.11 available.
  if [ -d "$VENV_DIR" ]; then
    VENV_MINOR=$("$VENV_DIR/bin/python3" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo "0")
    VENV_MAJOR=$("$VENV_DIR/bin/python3" -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo "0")
    if [ "$VENV_MAJOR" != "3" ] || [ "$VENV_MINOR" -lt 9 ] || [ "$VENV_MINOR" -gt 11 ]; then
      warn "Existing venv uses Python $VENV_MAJOR.$VENV_MINOR (incompatible). Recreating with $PYTHON_BIN..."
      rm -rf "$VENV_DIR"
    fi
  fi

  if [ ! -d "$VENV_DIR" ]; then
    info "Creating Python virtual environment at tts_venv/..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    # Use the compatible Python binary (not just 'python3') to create the venv.
    success "Virtual environment created"
  else
    success "Virtual environment already exists (Python $VENV_MAJOR.$VENV_MINOR)"
  fi

  # Install or update the TTS package inside the venv.
  # We use the venv's pip directly to ensure it installs into the venv, not globally.
  VENV_PIP="$VENV_DIR/bin/pip"
  VENV_PYTHON="$VENV_DIR/bin/python3"

  # Check if TTS is already installed in the venv.
  if ! "$VENV_PYTHON" -c "import TTS" &>/dev/null; then
    info "Installing Coqui TTS (this may take a few minutes)..."
    # Upgrade pip first — old pip versions sometimes fail on complex packages.
    "$VENV_PIP" install --upgrade pip --quiet
    # Install TTS. This downloads ~500MB of dependencies.
    "$VENV_PIP" install TTS
    success "Coqui TTS installed in venv"
  else
    success "Coqui TTS already installed in venv"
  fi

  info "Note: The XTTS v2 model (~1.8GB) downloads on first use, not during setup."
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: Ollama (local LLM server)
# ─────────────────────────────────────────────────────────────────────────────
header "Step 4: Ollama (local LLM)"

if ! command -v ollama &>/dev/null; then
  info "Installing Ollama..."
  # On Arch Linux, ollama is in the official 'extra' repository.
  # This is more reliable than the upstream curl install script, which can fail
  # due to TLS/firewall issues on some servers.
  if pacman -Si ollama &>/dev/null 2>&1; then
    pacman -S --noconfirm ollama
    success "Ollama installed via pacman"
  else
    # Fallback: ollama not in pacman repos — try the curl install script.
    # This should rarely be needed on Arch, but handles edge cases.
    warn "ollama not found in pacman repos — falling back to curl install script"
    curl -fsSL https://ollama.com/install.sh | sh
    success "Ollama installed via install script"
  fi
else
  success "Ollama already installed"
fi

# Start the Ollama service if it's not already running.
# systemctl is the service manager on systemd-based systems (including Arch).
if ! systemctl is-active --quiet ollama 2>/dev/null; then
  info "Starting Ollama service..."
  # Try systemctl first (if Ollama registered a systemd service).
  if systemctl start ollama 2>/dev/null; then
    success "Ollama service started"
  else
    # If there's no systemd service, start it in the background manually.
    warn "Could not start via systemctl — starting Ollama in background..."
    ollama serve &>/dev/null &
    # & runs the command in the background (detached from this script).
    # Give it a moment to start up before we try to pull a model.
    sleep 3
    success "Ollama started in background"
  fi
else
  success "Ollama is already running"
fi

# Pull the AI model if it's not already downloaded.
# 'ollama list' shows installed models. We grep for our model name.
if ! ollama list 2>/dev/null | grep -q 'llama3.2:3b'; then
  info "Downloading llama3.2:3b model (this may take a few minutes — ~2GB)..."
  ollama pull llama3.2:3b
  success "llama3.2:3b model downloaded"
else
  success "llama3.2:3b model already downloaded"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: Create required directories
# ─────────────────────────────────────────────────────────────────────────────
header "Step 5: Directories"

# Create the logs directory (PM2 writes logs here).
mkdir -p logs
success "logs/ directory ready"

# Create the TTS output directory (where generated speech files are saved).
mkdir -p /tmp/kentbot-tts
success "/tmp/kentbot-tts/ directory ready"

# ─────────────────────────────────────────────────────────────────────────────
# Done! Print next steps.
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}  Setup complete!${RESET}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════${RESET}"
echo ""
echo -e "${BOLD}Remaining steps (manual):${RESET}"
echo ""
echo -e "  ${CYAN}1.${RESET} Copy and fill in your .env file:"
echo -e "     ${YELLOW}cp .env.example .env${RESET}"
echo -e "     Then edit .env and set: DISCORD_TOKEN, CLIENT_ID, OPENAI_API_KEY"
echo ""
echo -e "  ${CYAN}2.${RESET} Add a voice sample for TTS:"
echo -e "     Drop a .wav file into ${YELLOW}voice-samples/${RESET}"
echo -e "     Set ${YELLOW}TTS_VOICE_SAMPLE=voice-samples/yourfile.wav${RESET} in .env"
echo -e "     (See voice-samples/README.md for details)"
echo ""
echo -e "  ${CYAN}3.${RESET} Register slash commands with Discord (once):"
echo -e "     ${YELLOW}node deploy-commands.js${RESET}"
echo ""
echo -e "  ${CYAN}4.${RESET} Start the bot:"
echo -e "     ${YELLOW}pm2 start ecosystem.config.cjs${RESET}"
echo ""
echo -e "  ${CYAN}5.${RESET} (Optional) Auto-start on boot:"
echo -e "     ${YELLOW}pm2 save && pm2 startup${RESET}"
echo -e "     Then run the command it prints."
echo ""
echo -e "${CYAN}Useful commands:${RESET}"
echo -e "  pm2 status          — see if all 3 processes are running"
echo -e "  pm2 logs            — tail all log output"
echo -e "  pm2 logs kentbot-bot — tail just the Discord bot logs"
echo -e "  pm2 restart all     — restart everything"
echo ""
