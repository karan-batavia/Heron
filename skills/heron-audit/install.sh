#!/bin/bash
# Install the /heron-audit skill for Claude Code
#
# Usage:
#   bash skills/heron-audit/install.sh
#   # or from anywhere:
#   bash /path/to/Heron/skills/heron-audit/install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$HOME/.claude/skills/heron-audit"

echo "Installing /heron-audit skill for Claude Code..."

mkdir -p "$SKILL_DIR"

# Symlink so updates to the repo automatically apply
ln -sf "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"

echo "Installed: $SKILL_DIR/SKILL.md -> $SCRIPT_DIR/SKILL.md"
echo ""
echo "Usage: Type /heron-audit in any Claude Code session to run an access audit."
