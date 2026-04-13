#!/bin/bash
# Install the /heron-audit skill for Claude Code
#
# Usage (from the repo root):
#   cd Heron && bash skills/heron-audit/install.sh
#
# Or install via npx (no clone needed):
#   npx heron-ai install-skill

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$HOME/.claude/skills/heron-audit"

echo "Installing /heron-audit skill for Claude Code..."

mkdir -p "$SKILL_DIR/bin"
mkdir -p "$HOME/.heron"

# Symlink SKILL.md so updates to the repo automatically apply
ln -sf "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"

# Symlink update checker
ln -sf "$SCRIPT_DIR/bin/heron-update-check" "$SKILL_DIR/bin/heron-update-check"

echo "Installed: $SKILL_DIR/SKILL.md -> $SCRIPT_DIR/SKILL.md"
echo "Installed: $SKILL_DIR/bin/heron-update-check -> $SCRIPT_DIR/bin/heron-update-check"
echo ""
echo "Usage: Type /heron-audit in any Claude Code session to run an access audit."
