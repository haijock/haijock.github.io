#!/usr/bin/env bash
set -e

echo "DEBUG: Line 4" >&2
if [ ! -t 0 ]; then
    echo "DEBUG: Inside if, redirecting stdin" >&2
    set +e
    exec </dev/null
    set -e
    echo "DEBUG: Past stdin redirect" >&2
fi

echo "DEBUG: Line 10, about to print header"
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

print_pat_instructions() {
    echo "==> GitHub Personal Access Token Required"
    echo ""
    echo "    To prevent mise from being rate-limited, a GitHub Personal Access Token"
    echo "    (PAT) is required. A token with NO scopes is sufficient for public"
    echo "    repos and provides the highest rate limit (5,000 requests/hr)."
    echo ""
    echo "    1. Go to: https://github.com/settings/tokens/new?description=mise-$(hostname)&expiration=90"
    echo "    2. Select token type: Tokens (classic)"
    echo "    3. Do NOT select any scopes (not required)"
    echo "    4. Click 'Generate token'"
    echo "    5. Copy the token immediately (you won't see it again)"
    echo "    6. Store it in 1Password: Private/GitHub/mise"
    echo "    7. Open ~/.env and replace the placeholder with your token"
    echo "    8. Rerun this script"
    echo ""
    exit 1
}

SSH_KEY="$HOME/.ssh/id_ed25519_bootstrap"

echo "==> Step 1: GitHub Personal Access Token Setup"
touch "$HOME/.env"
if ! grep -q '^MISE_GITHUB_TOKEN=' "$HOME/.env" 2>/dev/null; then
    echo 'MISE_GITHUB_TOKEN=<ADD GITHUB PERSONAL ACCESS TOKEN HERE>' >> "$HOME/.env"
    echo "    Added placeholder token to ~/.env"
    echo ""
    print_pat_instructions
fi
echo "    MISE_GITHUB_TOKEN is set"
echo ""

echo "==> Step 2: Installing mise..."
if [ ! -f "$HOME/.local/bin/mise" ]; then
    curl https://mise.run | sh
    echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
fi

export PATH="$HOME/.local/bin:$PATH"
eval "$(~/.local/bin/mise activate bash)" || true
echo "    mise installed"
echo ""

echo "==> Step 3: SSH Key Setup"
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
SSH_TEST=$(ssh -T -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o ConnectTimeout=10 -i "$SSH_KEY" git@github.com 2>&1) || true
if echo "$SSH_TEST" | grep -q "successfully authenticated"; then
    echo "    SSH key accepted by GitHub"
else
    echo "    SSH key NOT accepted by GitHub"
    echo "    $SSH_TEST"
    echo ""
    print_key_instructions
fi
echo ""

echo "==> Step 4: Cloning dotfiles to home directory..."
cd "$HOME"

(
    export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes"

    if [ -d "$HOME/.git" ]; then
        echo "    Git already initialized, fetching updates..."
        git fetch origin || {
            echo "    ERROR: Failed to fetch from origin"
            exit 1
        }
    else
        echo "    Initializing git repository..."
        git init || {
            echo "    ERROR: Failed to initialize git repository"
            exit 1
        }
        git remote add origin git@github.com:haijock/dotfiles.git || {
            echo "    ERROR: Failed to add remote origin"
            exit 1
        }
        git fetch origin || {
            echo "    ERROR: Failed to fetch from origin"
            exit 1
        }
    fi

    echo "    Checking out dotfiles (branch: wip)..."
    git reset --hard origin/wip || {
        echo "    ERROR: Failed to checkout dotfiles"
        exit 1
    }
)

echo ""

echo "==> Step 5: Running mise bootstrap..."
echo ""
mise run dotfiles:bootstrap 2>&1 || {
    echo ""
    echo "    Bootstrap task failed"
    exit 1
}

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
