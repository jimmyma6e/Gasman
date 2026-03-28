#!/usr/bin/env bash
# ============================================================
# revert-mac-cli-setup.sh
# Reverts the macOS CLI color/tool setup back to defaults.
# Run: bash revert-mac-cli-setup.sh
# ============================================================

set -e

echo "=============================="
echo "  Mac CLI Setup - REVERT"
echo "=============================="

# ── 1. Remove Homebrew packages ──
echo ""
echo "[1/4] Uninstalling Homebrew packages..."

packages=(starship lsd bat ripgrep tree coreutils util-linux wget curl gnu-sed gawk findutils)

for pkg in "${packages[@]}"; do
  if brew list "$pkg" &>/dev/null; then
    brew uninstall "$pkg" && echo "  removed: $pkg"
  else
    echo "  skip (not installed): $pkg"
  fi
done

# ── 2. Remove Nerd Font ──
echo ""
echo "[2/4] Removing Nerd Font..."
if brew list --cask font-fira-code-nerd-font &>/dev/null; then
  brew uninstall --cask font-fira-code-nerd-font && echo "  removed: font-fira-code-nerd-font"
else
  echo "  skip (not installed): font-fira-code-nerd-font"
fi

# ── 3. Clean up ~/.zshrc entries ──
echo ""
echo "[3/4] Cleaning ~/.zshrc..."

ZSHRC="$HOME/.zshrc"

if [ -f "$ZSHRC" ]; then
  # Backup first
  cp "$ZSHRC" "${ZSHRC}.backup-$(date +%Y%m%d%H%M%S)"
  echo "  backed up to ${ZSHRC}.backup-*"

  # Remove blocks added by setup
  sed -i '' '/# GNU coreutils aliases/,/^$/d' "$ZSHRC"
  sed -i '' '/# Color tools/,/^$/d' "$ZSHRC"
  sed -i '' '/eval "\$(starship init zsh)"/d' "$ZSHRC"
  sed -i '' '/eval "\$.*brew shellenv.*"/d' "$ZSHRC"
  sed -i '' '/opt\/coreutils\/libexec\/gnubin/d' "$ZSHRC"
  sed -i '' '/opt\/coreutils\/share\/man/d' "$ZSHRC"

  echo "  cleaned ~/.zshrc"
else
  echo "  ~/.zshrc not found, skipping"
fi

# ── 4. Remove starship config ──
echo ""
echo "[4/4] Removing starship config..."
STARSHIP_CFG="$HOME/.config/starship.toml"
if [ -f "$STARSHIP_CFG" ]; then
  rm "$STARSHIP_CFG" && echo "  removed: $STARSHIP_CFG"
else
  echo "  skip (not found): $STARSHIP_CFG"
fi

# ── Done ──
echo ""
echo "=============================="
echo "  Revert complete!"
echo "  Restart your terminal or run: source ~/.zshrc"
echo "=============================="
