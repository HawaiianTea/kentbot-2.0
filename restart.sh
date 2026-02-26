#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restart.sh — Stop and restart Kentbot (all 3 PM2 processes)
#
# Run this any time you want a clean restart:
#   ./restart.sh
#
# What it does:
#   1. Stops all three running bot processes via PM2
#   2. Starts them fresh from the ecosystem config
#   3. Prints status so you can confirm everything came up
# ─────────────────────────────────────────────────────────────────────────────

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET} $1"; }
success() { echo -e "${GREEN}[OK]${RESET}   $1"; }

# ── Make sure we run from the project root ────────────────────────────────────
# This ensures PM2 finds the ecosystem.config.cjs regardless of where you call
# the script from (e.g. ./restart.sh from another directory works fine).
SCRIPT_DIR="$(realpath "$(dirname "$0")")"
cd "$SCRIPT_DIR"

# ── Check PM2 is installed ────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo -e "${YELLOW}[WARN]${RESET} PM2 is not installed. Run setup.sh first."
  exit 1
fi

# ── Stop any currently running bot processes ──────────────────────────────────
# 'pm2 stop' sends SIGINT to each process and waits for it to exit cleanly.
# We check if the processes exist first — 'pm2 stop' errors if nothing is running.
info "Stopping bot processes..."
if pm2 list 2>/dev/null | grep -q 'kentbot'; then
  # At least one kentbot process is registered with PM2 — stop them all.
  pm2 stop kentbot-music kentbot-ai kentbot-bot 2>/dev/null || true
  # 'delete' removes them from PM2's process list entirely, so the fresh start
  # below is truly clean (no leftover state, restart counters, etc.).
  pm2 delete kentbot-music kentbot-ai kentbot-bot 2>/dev/null || true
  success "Bot processes stopped and cleared"
else
  info "No running bot processes found — starting fresh"
fi

# ── Start all three processes fresh ──────────────────────────────────────────
# PM2 reads ecosystem.config.cjs and starts all three processes in order:
#   1. kentbot-music  (port 3001)
#   2. kentbot-ai     (port 3002)
#   3. kentbot-bot    (Discord connection)
info "Starting bot processes..."
pm2 start ecosystem.config.cjs

echo ""
success "Bot started. Current status:"
echo ""

# Print the PM2 process table so you can confirm all three are 'online'.
pm2 status

echo ""
echo -e "${CYAN}Useful follow-up commands:${RESET}"
echo -e "  pm2 logs              — tail all output"
echo -e "  pm2 logs kentbot-bot  — tail just the Discord bot"
echo -e "  pm2 stop all          — stop everything"
echo ""
