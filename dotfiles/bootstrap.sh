#!/usr/bin/env bash
set -e

echo "==> Dotfiles Bootstrap"
echo ""

DETECTED_OS=""
if uname -a | grep -qi darwin; then
    DETECTED_OS="macOS"
elif uname -a | grep -qi wsl; then
    DETECTED_OS="WSL"
elif uname -a | grep -qiE "linux|buntu|debian|fedora|arch"; then
    DETECTED_OS="Linux"
fi

echo "    Detected OS: $DETECTED_OS"
echo ""

print_key_instructions() {
    echo "==> Deploy Key Setup Required"
    echo ""
    echo "    1. Go to: https://github.com/haijock/dotfiles/settings/keys"
    echo "    2. Click 'Add deploy key'"
    echo "    3. Title: $(hostname) (bootstrap)"
    echo "    4. Key: Copy the public key below"
    echo "    5. Allow write access: NO (read-only)"
    echo ""
    echo "    Public key:"
    echo "    ----------"
    cat "${SSH_KEY}.pub"
    echo "    ----------"
    echo ""
    echo "    After adding the key to GitHub, rerun this script."
    echo ""
    exit 1
}

SSH_KEY="$HOME/.ssh/id_ed25519_bootstrap"

echo "==> Step 1: Installing mise..."
if [ -f "$HOME/.local/bin/mise" ]; then
    echo "    mise already installed"
else
    curl https://mise.run | sh
fi

export PATH="$HOME/.local/bin:$PATH"
echo "    mise installed"
echo ""

echo "==> Step 2: SSH Key Setup"
mkdir -p "$HOME/.ssh"

if [ ! -f "$SSH_KEY" ]; then
    echo "    Generating new machine-specific SSH key..."
    ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "bootstrap-$(hostname)"
    echo ""
    print_key_instructions
fi

echo "    Bootstrap key exists: $SSH_KEY"
echo ""

echo "    Testing SSH connection to GitHub..."
if ssh -T -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i "$SSH_KEY" git@github.com 2>&1 | grep -q "successfully authenticated"; then
    echo "    SSH key accepted by GitHub"
else
    echo "    SSH key NOT accepted by GitHub"
    echo ""
    print_key_instructions
fi
echo ""

echo "==> Step 3: Cloning dotfiles to home directory..."
cd "$HOME"

if [ -d "$HOME/.git" ]; then
    echo "    Git already initialized, fetching updates..."
    git fetch origin
else
    echo "    Initializing git repository..."
    git init
    git remote add origin git@github.com:haijock/dotfiles.git
    git fetch origin
fi

echo "    Checking out dotfiles (branch: wip)..."
git reset --hard origin/wip
echo ""

echo "==> Step 4: Running mise bootstrap..."
echo ""
mise run dotfiles:bootstrap

echo ""
echo "==> Bootstrap complete!"
echo ""
echo "    Next steps:"
echo "    1. Sign in to 1Password: op signin"
echo "    2. Configure SSH agent (machine-specific):"
if [ "$DETECTED_OS" = "macOS" ]; then
    echo "       macOS: ~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
elif [ "$DETECTED_OS" = "WSL" ]; then
    echo "       WSL: ~/.1password/agent.sock"
else
    echo "       Linux: ~/.1password/agent.sock"
fi
echo "    3. Restart shell: exec fish"
