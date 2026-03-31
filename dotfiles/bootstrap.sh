#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

if [ ! -t 0 ]; then
    set +e
    (true) < /dev/null
    set -e
fi

# ---------------------------------------------------------------------------
# Locking (prevent concurrent runs)
# ---------------------------------------------------------------------------
LOCKFILE="/tmp/bootstrap.lock"
exec 9>"$LOCKFILE"
if ! flock -n 9; then
    echo "[ERROR] Another bootstrap process is running" >&2
    exit 1
fi

trap 'echo "[ERROR] Failed at line $LINENO" >&2' ERR

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() { echo "[INFO] $*"; }
err() { echo "[ERROR] $*" >&2; }

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "[ERROR] Missing required command: $1" >&2
        exit 1
    fi
}

for cmd in git curl ssh ssh-keygen grep sed timeout; do
    require_cmd "$cmd"
done

# ---------------------------------------------------------------------------
# Parse command-line arguments
# ---------------------------------------------------------------------------
LOCAL_REPO=""
ONLY_CHECKOUT=false
BRANCH=""
FORCE=false

usage() {
    cat <<'EOF'
Usage: bootstrap.sh [OPTIONS]

Bootstrap a new machine with dotfiles managed via a bare git repository.

The script is idempotent: each step checks whether it has already been
completed, and can be safely rerun at any time.

Phases:
  1. GitHub PAT     Configure MISE_GITHUB_TOKEN in ~/.env
  2. mise           Install mise package manager
  3. SSH key        Generate a deploy key for GitHub access
  4. Dotfiles       Clone bare repo to ~/.dotfiles, checkout into $HOME
  5. Stage 2        Hand off to mise run dotfiles:bootstrap

Options:
  --local-repo <path>   Clone from a local bare repo instead of GitHub.
                        Skips SSH key setup (Step 3).
  --only-checkout       Run only Step 4 (dotfiles checkout). Skips mise,
                        SSH, PAT, and Stage 2.
  --branch <name>       Check out a specific branch. Without this flag,
                        the branch is auto-detected from the remote HEAD,
                        falling back to main or master.
  --force               Skip the interactive confirmation prompt. Implied
                        when stdin is not a TTY (e.g. curl | sh).
  --help                Show this help message and exit.

Environment variables:
  MISE_GITHUB_TOKEN     GitHub PAT for mise (avoids rate limits). Can also
                        be set in ~/.env.

Examples:
  # Full bootstrap (interactive)
  curl -fsSL https://haijock.github.io/dotfiles/bootstrap.sh | sh

  # Test locally with Docker (see test/bootstrap-sandbox.sh)
  bash bootstrap.sh --local-repo /mnt/dotfiles.git --branch wip --only-checkout

  # CI / automated usage
  bash bootstrap.sh --force
EOF
    exit 0
}

require_arg() {
    if [ $# -lt 2 ] || [[ "$2" == --* ]]; then
        echo "ERROR: $1 requires a value" >&2
        echo "Run 'bootstrap.sh --help' for usage." >&2
        exit 1
    fi
}

while [ $# -gt 0 ]; do
    case "$1" in
        --local-repo)
            require_arg "$1" "${2:-}"
            LOCAL_REPO="$2"
            shift 2
            ;;
        --only-checkout)
            ONLY_CHECKOUT=true
            shift
            ;;
        --branch)
            require_arg "$1" "${2:-}"
            BRANCH="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --help|-h)
            usage
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Run 'bootstrap.sh --help' for usage." >&2
            exit 1
            ;;
    esac
done

echo "==> Dotfiles Bootstrap"
echo ""

DETECTED_OS=""
if uname -a | grep -qi darwin; then
    DETECTED_OS="macOS"
elif uname -a | grep -qi wsl && [ -f /proc/sys/fs/binfmt_misc/WSLInterop ]; then
    DETECTED_OS="WSL"
elif uname -a | grep -qiE "linux|buntu|debian|fedora|arch"; then
    DETECTED_OS="Linux"
fi

echo "    Detected OS: $DETECTED_OS"
echo ""

# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------
# Skip if: --force, --only-checkout, or non-interactive (piped) stdin.
if [ "$FORCE" = false ] && [ "$ONLY_CHECKOUT" = false ] && [ -t 0 ]; then
    echo "    This will modify files in your home directory:"
    echo "      - Install mise and configure shell integration"
    echo "      - Generate an SSH key at ~/.ssh/id_ed25519_bootstrap"
    echo "      - Clone dotfiles as a bare repo at ~/.dotfiles"
    echo "      - Check out tracked files into \$HOME (with conflict backup)"
    echo ""
    printf "    Continue? [y/N] "
    read -r CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "    Aborted."
        exit 0
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
if [ "$FORCE" = true ]; then
    export MISE_FORCE=true
fi

DOTFILES_REPO="${LOCAL_REPO:-git@github.com:haijock/dotfiles.git}"
DOTFILES_DIR="$HOME/.dotfiles"
SSH_KEY="$HOME/.ssh/id_ed25519_bootstrap"

# Load only MISE_GITHUB_TOKEN from .env
load_mise_token() {
    local file="$1"
    [ -f "$file" ] || return
    while IFS= read -r line; do
        if [[ "$line" == MISE_GITHUB_TOKEN=* ]]; then
            export "$line"
            return
        fi
    done < "$file"
}

# ---------------------------------------------------------------------------
# Instruction printers (exit after printing)
# ---------------------------------------------------------------------------
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

# ===========================================================================
# Step 1: GitHub Personal Access Token
# ===========================================================================
if [ "$ONLY_CHECKOUT" = false ]; then
    echo "==> Step 1: GitHub Personal Access Token Setup"
    touch "$HOME/.env"
    if ! grep -q '^MISE_GITHUB_TOKEN=' "$HOME/.env" 2>/dev/null; then
        # When using --local-repo, the token may already be in the
        # environment (e.g. passed via docker run -e). Check before
        # prompting.
        if [ -n "$MISE_GITHUB_TOKEN" ]; then
            echo "    MISE_GITHUB_TOKEN found in environment"
        else
            echo 'MISE_GITHUB_TOKEN=<ADD GITHUB PERSONAL ACCESS TOKEN HERE>' >> "$HOME/.env"
            echo "    Added placeholder token to ~/.env"
            echo ""
            print_pat_instructions
        fi
    fi
    load_mise_token "$HOME/.env"
    echo "    MISE_GITHUB_TOKEN is set"
    echo ""
else
    echo "==> Step 1: GitHub Personal Access Token Setup [SKIPPED]"
    echo ""
fi

# ===========================================================================
# Step 2: Install mise
# ===========================================================================
if [ "$ONLY_CHECKOUT" = false ]; then
    echo "==> Step 2: Installing mise..."
    if [ ! -f "$HOME/.local/bin/mise" ]; then
        curl https://mise.run | sh
    fi

    # Ensure .bashrc has PATH and mise activation (idempotent)
    if ! grep -qF '.local/bin' "$HOME/.bashrc" 2>/dev/null; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
    fi
    if ! grep -qF 'mise activate' "$HOME/.bashrc" 2>/dev/null; then
        echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
    fi

    export PATH="$HOME/.local/bin:$PATH"
    eval "$(~/.local/bin/mise activate bash)" || true

# Or commit .local/bin/dotfiles to the repo (also add dotfiles-prek, or dot(-prek))
    mkdir -p "$HOME/.local/bin"
    cat > "$HOME/.local/bin/dotfiles" <<'EOF'
#!/usr/bin/env bash
exec /usr/bin/git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" "$@"
EOF
    chmod +x "$HOME/.local/bin/dotfiles"

    echo "    mise installed"
    echo ""
else
    echo "==> Step 2: Installing mise [SKIPPED]"
    echo ""
fi

# ===========================================================================
# Step 3: SSH key for private repo access
# ===========================================================================
if [ -z "$LOCAL_REPO" ] && [ "$ONLY_CHECKOUT" = false ]; then
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
    set +e
    SSH_TEST=$(timeout 15 ssh -n -T -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -o ConnectTimeout=10 -i "$SSH_KEY" git@github.com 2>&1)
    set -e
    if echo "$SSH_TEST" | grep -q "successfully authenticated"; then
        echo "    SSH key accepted by GitHub"
    else
        echo "    SSH key NOT accepted by GitHub"
        echo "    $SSH_TEST"
        echo ""
        print_key_instructions
    fi
    echo ""
else
    echo "==> Step 3: SSH Key Setup [SKIPPED]"
    echo ""
fi

# ===========================================================================
# Step 4: Clone dotfiles as bare repository
# ===========================================================================
echo "==> Step 4: Setting up dotfiles (bare repo)..."

# Only set SSH command when cloning from remote
if [ -z "$LOCAL_REPO" ]; then
    export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes"
fi

# Clone or fetch
if [ ! -d "$DOTFILES_DIR" ]; then
    echo "    Cloning dotfiles as bare repository..."
    git clone --bare "$DOTFILES_REPO" "$DOTFILES_DIR" || {
        echo "    ERROR: Failed to clone dotfiles"
        exit 1
    }
else
    echo "    Bare repo already exists, fetching latest..."
    dotfiles fetch origin || {
        echo "    ERROR: Failed to fetch updates"
        exit 1
    }
fi

# Determine the branch to check out.
if [ -z "$BRANCH" ]; then
    # No --branch given; detect from remote HEAD, then try common defaults.
    REMOTE_HEAD=$(dotfiles symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||') || true
    if [ -z "$REMOTE_HEAD" ]; then
        # Remote HEAD not set — try to resolve it
        dotfiles remote set-head origin --auto 2>/dev/null || true
        REMOTE_HEAD=$(dotfiles symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||') || true
    fi

    if [ -n "$REMOTE_HEAD" ]; then
        BRANCH="$REMOTE_HEAD"
    else
        # Try common default branch names
        for candidate in main master; do
            if dotfiles rev-parse --verify "$candidate" &>/dev/null; then
                BRANCH="$candidate"
                break
            fi
        done
    fi

    if [ -z "$BRANCH" ]; then
        echo "    ERROR: Could not determine which branch to check out."
        echo "    Use --branch <name> to specify explicitly."
        exit 1
    fi
fi
echo "    Target branch: $BRANCH"

# Attempt checkout
echo "    Checking out dotfiles..."
CHECKOUT_EXIT=0
CHECKOUT_OUTPUT=$(dotfiles checkout "$BRANCH" 2>&1) || CHECKOUT_EXIT=$?

# If checkout failed, handle conflicts
if [ "$CHECKOUT_EXIT" -ne 0 ]; then
    # Extract conflicting file paths from the error output.
    # Git prints lines like "	.bashrc" (tab-indented) for each conflict.
    # Note: grep -E '\t' is not portable — use a literal tab via $'\t'.
    CONFLICT_FILES=$(echo "$CHECKOUT_OUTPUT" | grep "^$(printf '\t')" | sed "s/^$(printf '\t')//")

    if [ -n "$CONFLICT_FILES" ]; then
        BACKUP_DIR="$HOME/.dotfiles-backup/$(date +%Y%m%d-%H%M%S)"
        echo "    Conflicts detected. Backing up existing files..."
        mkdir -p "$BACKUP_DIR"

        echo "$CONFLICT_FILES" | while IFS= read -r file; do
            if [ -e "$HOME/$file" ]; then
                mkdir -p "$BACKUP_DIR/$(dirname "$file")"
                mv "$HOME/$file" "$BACKUP_DIR/$file"
                echo "        Backed up: $file"
            fi
        done

        echo "    Retrying checkout..."
        dotfiles checkout "$BRANCH" || {
            echo "    ERROR: Checkout failed after backup"
            exit 1
        }

        # Restore backed-up files so they appear as local modifications.
        # The user can review them with "dotfiles diff" and reconcile.
        echo "    Restoring previous files as local changes..."
        echo "$CONFLICT_FILES" | while IFS= read -r file; do
            if [ -e "$BACKUP_DIR/$file" ]; then
                mkdir -p "$HOME/$(dirname "$file")"
                cp "$BACKUP_DIR/$file" "$HOME/$file"
                echo "        Restored: $file"
            fi
        done

        echo ""
        echo "    Pre-existing files preserved as working tree changes."
        echo "    Review with: dotfiles diff"
        echo "    Backups at:  $BACKUP_DIR"
    else
        echo "    ERROR: Checkout failed for an unexpected reason:"
        echo "$CHECKOUT_OUTPUT"
        exit 1
    fi
else
    echo "    Checkout completed with no conflicts"
fi

# Hide untracked files — $HOME has thousands of them
dotfiles config status.showUntrackedFiles no

# ===========================================================================
# Step 5: Run mise bootstrap (Stage 2)
# ===========================================================================
if [ "$ONLY_CHECKOUT" = false ]; then
    echo "==> Step 5: Running mise bootstrap..."
    echo ""
    mise run dotfiles:bootstrap 2>&1 || {
        echo ""
        echo "    Bootstrap task failed"
        exit 1
    }
else
    echo "==> Step 5: Running mise bootstrap [SKIPPED]"
fi

# ===========================================================================
# Done
# ===========================================================================
echo ""
echo "==> Bootstrap complete!"
echo ""
echo "    The dotfiles command is available for managing your configuration:"
echo "      dotfiles status    — see what changed"
echo "      dotfiles diff      — review changes"
echo "      dotfiles add <file> && dotfiles commit -m \"message\""
echo ""

echo "    Reload your shell to pick up changes:"
echo "      exec bash"
echo "      # Or test login shell:"
echo "      sudo su -l $(whoami)"
echo ""

if [ "$ONLY_CHECKOUT" = true ]; then
    echo "    Steps skipped (--only-checkout mode):"
    echo "      Step 1: GitHub PAT setup      — run bootstrap.sh without flags"
    echo "      Step 2: mise install           — curl https://mise.run | sh"
    echo "      Step 3: SSH key setup          — run bootstrap.sh without flags"
    echo "      Step 5: mise bootstrap         — mise run dotfiles:bootstrap"
    echo ""
    echo "    To complete a full bootstrap, rerun without --only-checkout."
    echo ""
else
    echo "    Next steps:"
    echo "    1. Restart shell: exec bash"
    echo "       Or test login shell: sudo su -l $(whoami)"
    echo "    2. Sign in to 1Password: op signin"
    echo "    3. Configure SSH agent (machine-specific):"
    if [ "$DETECTED_OS" = "macOS" ]; then
        echo "       macOS: ~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
    elif [ "$DETECTED_OS" = "WSL" ]; then
        echo "       WSL: ~/.1password/agent.sock"
    else
        echo "       Linux: ~/.1password/agent.sock"
    fi
fi
