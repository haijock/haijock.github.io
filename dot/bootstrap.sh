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
# Cleanup
# ---------------------------------------------------------------------------
MISE_INSTALLER=""
cleanup() {
    [ -n "${MISE_INSTALLER:-}" ] && rm -f "$MISE_INSTALLER" || true
    rm -f "$LOCKFILE"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() { echo "[INFO] $*"; }
log_section() { echo ""; echo "==> $*"; echo ""; }
log_detail() { echo "    $*"; }
err() { echo "[ERROR] $*" >&2; }

# Dry-run mode: echo actions instead of executing
dry_run() {
    echo "[DRY-RUN] $*"
}

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "[ERROR] Missing required command: $1" >&2
        exit 1
    fi
}

for cmd in git curl ssh ssh-keygen grep sed timeout flock; do
    require_cmd "$cmd"
done

# ---------------------------------------------------------------------------
# Parse command-line arguments
# ---------------------------------------------------------------------------
LOCAL_REPO=""
ONLY_CHECKOUT=false
BRANCH=""
FORCE=false
DRY_RUN=false
REPO_URL=""

usage() {
    cat <<'EOF'
Usage: bootstrap.sh [OPTIONS]

Bootstrap a new machine with dot managed via a bare git repository.

The script is idempotent: each step checks whether it has already been
completed, and can be safely rerun at any time.

Phases:
  1. GitHub PAT     Configure MISE_GITHUB_TOKEN in ~/.env
  2. mise           Install mise package manager
  3. Clone          Clone bare repo to ~/.dot (SSH key generated only if clone fails)
  4. Checkout       Check out tracked files into $HOME
  5. Stage 2        Hand off to mise run dot:bootstrap

Options:
  --local-repo <path>   Clone from a local bare repo instead of GitHub.
                        Skips SSH key setup (Step 3).
  --only-checkout       Run only Step 4 (dot checkout). Skips mise,
                        Clone, PAT, and Stage 2.
  --branch <name>       Check out a specific branch. Without this flag,
                        the branch is auto-detected from the remote HEAD,
                        falling back to main or master.
  --force               Skip the interactive confirmation prompt. Implied
                        when stdin is not a TTY (e.g. curl | sh).
  --dry-run             Show what would happen without making any changes.
                        Useful for reviewing actions before running.
  --repo <url>          Override the default dot repository URL.
                        Can also be set via DOTFILES_REPO environment variable.
  --help                Show this help message and exit.

Environment variables:
  MISE_GITHUB_TOKEN     GitHub PAT for mise (avoids rate limits). Can also
                        be set in ~/.env.
  DOTFILES_REPO         Override the default dot repository URL.
                        Takes precedence over --repo when set.

Examples:
  # Full bootstrap (interactive)
  curl -fsSL https://haijock.github.io/dot/bootstrap.sh | sh

  # Test locally with Docker (see .config/mise/tasks/dot/sandbox)
  bash bootstrap.sh --local-repo /mnt/dot.git --branch wip --only-checkout

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
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --repo)
            require_arg "$1" "${2:-}"
            REPO_URL="$2"
            shift 2
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

log_section "Dotfiles Bootstrap"

DETECTED_OS=""
DETECTED_DISTRO=""

if uname -a | grep -qi darwin; then
    DETECTED_OS="macOS"
    DETECTED_DISTRO="$(uname -m)"
elif [ -f /proc/sys/fs/binfmt_misc/WSLInterop ] && command -v wslpath &>/dev/null; then
    # WSLInterop exists on WSL AND in Docker-on-WSL (shared kernel).
    # wslpath is a WSL userspace binary absent from containers.
    DETECTED_OS="WSL"
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DETECTED_DISTRO="$ID"
    fi
elif [ -f /etc/os-release ]; then
    . /etc/os-release
    DETECTED_OS="Linux"
    DETECTED_DISTRO="${ID:-unknown}"
elif uname -a | grep -qiE "linux"; then
    DETECTED_OS="Linux"
    DETECTED_DISTRO="unknown"
fi

log_detail "Detected OS: $DETECTED_OS"
echo ""

# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------
# Skip if: --force, --only-checkout, --dry-run, or non-interactive (piped) stdin.
if [ "$DRY_RUN" = false ] && [ "$FORCE" = false ] && [ "$ONLY_CHECKOUT" = false ] && [ -t 0 ]; then
    log_detail "This will modify files in your home directory:"
    log_detail "  - Install mise and configure shell integration"
    log_detail "  - Clone dot as a bare repo to ~/.dot"
    log_detail "  - Check out tracked files into \$HOME (with conflict backup)"
    echo ""
    printf "    Continue? [y/N] "
    read -r CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        log_detail "Aborted."
        exit 0
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
# Repo URL precedence: --repo flag > DOTFILES_REPO env var > --local-repo > hardcoded default
if [ -n "$REPO_URL" ]; then
    DOTFILES_REPO="$REPO_URL"
elif [ -n "${DOTFILES_REPO:-}" ]; then
    DOTFILES_REPO="$DOTFILES_REPO"
elif [ -n "$LOCAL_REPO" ]; then
    DOTFILES_REPO="$LOCAL_REPO"
else
    DOTFILES_REPO="git@github.com:haijock/dot.git"
fi
DOTFILES_DIR="$HOME/.dot"
SSH_KEY="$HOME/.ssh/id_ed25519_bootstrap"

# Dry-run: show what would happen
if [ "$DRY_RUN" = true ]; then
    log_section "Dry-Run Mode"
    log_detail "Detected OS: $DETECTED_OS"
    log_detail "Repo URL: $DOTFILES_REPO"
    log_detail "Only checkout: $ONLY_CHECKOUT"
    echo ""
    log_detail "This would execute the following phases:"
    if [ "$ONLY_CHECKOUT" = true ]; then
        log_detail "  - Step 4: Clone and checkout dot"
    else
        log_detail "  - Step 1: GitHub PAT setup"
        log_detail "  - Step 2: Install mise"
        log_detail "  - Step 3: Clone dot (SSH key only if needed)"
        log_detail "  - Step 4: Run mise bootstrap (Stage 2)"
    fi
    echo ""
    log_detail "No changes have been made. Remove --dry-run to proceed."
    echo ""
    exit 0
fi

# Load only MISE_GITHUB_TOKEN from .env
load_mise_token() {
    local file="$1"
    [ -f "$file" ] || return
    while IFS= read -r line; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        
        if [[ "$line" == MISE_GITHUB_TOKEN=* ]]; then
            local key="${line%%=*}"
            local value="${line#*=}"
            
            if [[ ! "$key" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
                echo "[ERROR] Invalid variable name in .env: $key" >&2
                continue
            fi
            
            declare -x "$key"="$value"
            return
        fi
    done < "$file"
}

# ---------------------------------------------------------------------------
# Instruction printers (exit after printing)
# ---------------------------------------------------------------------------
print_key_instructions() {
    log_section "Deploy Key Setup Required"
    log_detail "1. Go to: https://github.com/haijock/dot/settings/keys"
    log_detail "2. Click 'Add deploy key'"
    log_detail "3. Title: $(hostname) (bootstrap)"
    log_detail "4. Key: Copy the public key below"
    log_detail "5. Allow write access: NO (read-only)"
    echo ""
    log_detail "Public key:"
    echo "    ----------"
    cat "${SSH_KEY}.pub"
    echo "    ----------"
    echo ""
    log_detail "After adding the key to GitHub, rerun this script."
    echo ""
    exit 1
}

print_pat_instructions() {
    log_section "GitHub Personal Access Token Required"
    log_detail "To prevent mise from being rate-limited, a GitHub Personal Access Token"
    log_detail "(PAT) is required. A token with NO scopes is sufficient for public"
    log_detail "repos and provides the highest rate limit (5,000 requests/hr)."
    echo ""
    log_detail "1. Go to: https://github.com/settings/tokens/new?description=mise-$(hostname)&expiration=90"
    log_detail "2. Select token type: Tokens (classic)"
    log_detail "3. Do NOT select any scopes (not required)"
    log_detail "4. Click 'Generate token'"
    log_detail "5. Copy the token immediately (you won't see it again)"
    log_detail "6. Store it in 1Password: Private/GitHub/mise"
    log_detail "7. Open ~/.env and replace the placeholder with your token"
    log_detail "8. Rerun this script"
    echo ""
    exit 1
}

# ===========================================================================
# Step 1: GitHub Personal Access Token
# ===========================================================================
# What: Configures MISE_GITHUB_TOKEN in ~/.env for mise package manager.
# Why: Required to avoid GitHub API rate limits when mise installs tools from
#      GitHub. A PAT with NO scopes is sufficient for public repos and provides
#      5,000 requests/hr (vs. 60 unauthenticated).
# Safety: Idempotent - only adds placeholder if not already present. Never
#         overwrites existing tokens. User must manually replace placeholder.
# Note: This step does NOT handle 1Password CLI auth - that's a separate
#       post-bootstrap manual step.
if [ "$ONLY_CHECKOUT" = false ]; then
    log_section "Step 1: GitHub Personal Access Token Setup"
    touch "$HOME/.env"
    if ! grep -q '^MISE_GITHUB_TOKEN=' "$HOME/.env" 2>/dev/null; then
        # When using --local-repo, the token may already be in the
        # environment (e.g. passed via docker run -e). Check before
        # prompting.
        if [ -n "${MISE_GITHUB_TOKEN:-}" ]; then
            log_detail "MISE_GITHUB_TOKEN found in environment"
        else
            echo 'MISE_GITHUB_TOKEN=<ADD GITHUB PERSONAL ACCESS TOKEN HERE>' >> "$HOME/.env"
            log_detail "Added placeholder token to ~/.env"
            echo ""
            print_pat_instructions
        fi
    fi
    load_mise_token "$HOME/.env"
    log_detail "MISE_GITHUB_TOKEN is set"
else
    log_section "Step 1: GitHub Personal Access Token Setup [SKIPPED]"
fi

# ===========================================================================
# Step 2: Install mise
# ===========================================================================
# What: Installs mise version manager and configures shell integration.
# Why: mise is the primary tool for managing developer tools (node, python, go,
#      etc.) and running tasks defined in mise.toml. It's required for Stage 2.
# Safety: Idempotent - skips if ~/.local/bin/mise exists. Modifies .bashrc
#         only to add PATH and activation (both checks prevent duplicates).
# Warning: Does NOT install mise plugins or runtimes - those come from
#          mise.toml in the dot repo during Stage 2.
if [ "$ONLY_CHECKOUT" = false ]; then
    log_section "Step 2: Installing mise..."
    if [ ! -f "$HOME/.local/bin/mise" ]; then
        MISE_INSTALLER=$(mktemp)

        log_detail "Downloading mise installer..."
        if ! curl -sSLo "$MISE_INSTALLER" https://mise.run; then
            err "Failed to download mise installer"
            exit 1
        fi

        MISE_SIZE=$(wc -c < "$MISE_INSTALLER" | tr -d ' ')
        if [ "$MISE_SIZE" -lt 1000 ]; then
            err "Installer seems too small ($MISE_SIZE bytes)"
            exit 1
        fi

        MISE_VERSION="${MISE_VERSION:-v2025.3.1}"
        log_detail "Running mise installer (version: $MISE_VERSION)..."
        MISE_VERSION="$MISE_VERSION" sh "$MISE_INSTALLER"
    fi

    # Wire ~/.config/bash/config into ~/.bashrc (idempotent).
    # The config file is tracked in the dot repo and contains PATH,
    # mise activation, and the dot function — all in one sourced file.
    if ! grep -qF '.config/bash/config' "$HOME/.bashrc" 2>/dev/null; then
        echo 'source "$HOME/.config/bash/config"' >> ~/.bashrc
    fi

    export PATH="$HOME/.local/bin:$PATH"
    eval "$(~/.local/bin/mise activate bash)" || true
fi

# ===========================================================================
# Step 3: Clone dot (generates SSH key only if clone fails)
# ===========================================================================
# What: Attempts to clone the dot repo. If authentication fails, generates
#       a new deploy key and prompts user to add it to GitHub.
# Why: Most machines either have existing SSH access or don't need a new key.
#      Only generate complexity when actually needed.
# Safety: Idempotent - skips if repo already exists.
# Note: Skipped when using --local-repo (no GitHub auth needed).
# But if --local-repo is provided and repo doesn't exist, clone anyway.
if [ -z "$LOCAL_REPO" ] && [ "$ONLY_CHECKOUT" = false ] && [ ! -d "$DOTFILES_DIR" ]; then
    log_section "Step 3: Cloning dot..."
    mkdir -p "$HOME/.ssh"

    # Try to clone - will fail if no SSH access
    if git clone --bare "$DOTFILES_REPO" "$DOTFILES_DIR" 2>&1; then
        log_detail "Clone successful"
    else
        # Clone failed - likely no SSH access, generate key and retry
        log_detail "Clone failed, setting up SSH key..."

        if [ ! -f "$SSH_KEY" ]; then
            log_detail "Generating new deploy key..."
            ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "bootstrap-$(hostname)"
            echo ""
            print_key_instructions
        fi

        export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes"

        log_detail "Retrying clone with deploy key..."
        git clone --bare "$DOTFILES_REPO" "$DOTFILES_DIR" || {
            err "Failed to clone dot even with deploy key"
            exit 1
        }
    fi
elif [ -n "$LOCAL_REPO" ] && [ ! -d "$DOTFILES_DIR" ]; then
    log_section "Step 3: Cloning dot from local repo..."
    git clone --bare "$LOCAL_REPO" "$DOTFILES_DIR"
    log_detail "Clone successful"
else
    log_section "Step 3: Clone dot [SKIPPED]"
fi

# ===========================================================================
# Step 4: Checkout dot
# ===========================================================================
# What: Checks out the dot branch after clone.
# Why: Part of the dot setup process.
# Safety: Handles conflicts by backing up existing files.
log_section "Step 4: Checking out dot..."

# Ensure PATH includes local bin for dot wrapper
export PATH="$HOME/.local/bin:$PATH"

# dot function for managing dotfiles (sets GIT_DIR/GIT_WORK_TREE as env prefix)
dot() {
    GIT_DIR="$HOME/.dot" GIT_WORK_TREE="$HOME" "$@"
}

# Fetch latest if repo already exists
if [ -d "$DOTFILES_DIR" ]; then
    log_detail "Fetching latest..."
    dot git fetch origin || {
        err "Failed to fetch updates"
        exit 1
    }
fi

# Determine the branch to check out.
if [ -z "$BRANCH" ]; then
    # No --branch given; detect from remote HEAD, then try common defaults.
    REMOTE_HEAD=$(dot git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||') || true
    if [ -z "$REMOTE_HEAD" ]; then
        # Remote HEAD not set — try to resolve it
        dot git remote set-head origin --auto 2>/dev/null || true
        REMOTE_HEAD=$(dot git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||') || true
    fi

    if [ -n "$REMOTE_HEAD" ]; then
        BRANCH="$REMOTE_HEAD"
    else
        # Try common default branch names
        for candidate in main master; do
            if dot git rev-parse --verify "$candidate" &>/dev/null; then
                BRANCH="$candidate"
                break
            fi
        done
    fi

    if [ -z "$BRANCH" ]; then
        err "Could not determine which branch to check out."
        log_detail "Use --branch <name> to specify explicitly."
        exit 1
    fi
fi
log_detail "Target branch: $BRANCH"

# Attempt checkout
log_detail "Checking out dot..."
CHECKOUT_EXIT=0
set +e
CHECKOUT_OUTPUT=$(dot git checkout "$BRANCH" 2>&1)
CHECKOUT_EXIT=$?
set -e

# If checkout failed, handle conflicts
if [ "$CHECKOUT_EXIT" -ne 0 ]; then
    # Extract conflicting file paths from Git's error output.
    # Git reports files that would be overwritten as tab-indented lines
    # between the error header and the "Please move or remove" footer.
    # We detect this specific error message, then extract file paths
    # from lines that start with a tab character.
    CONFLICT_FILES=""
    if echo "$CHECKOUT_OUTPUT" | grep -q "would be overwritten by checkout"; then
        CONFLICT_FILES=$(echo "$CHECKOUT_OUTPUT" | sed -n '/would be overwritten/,/Please move or remove/{ /^\t/{ s/^\t//; p; } }')
    fi

    if [ -n "$CONFLICT_FILES" ]; then
        BACKUP_DIR="$HOME/.dot-backup/$(date +%Y%m%d-%H%M%S)"
        log_detail "Conflicts detected. Backing up existing files..."
        mkdir -p "$BACKUP_DIR"

        echo "$CONFLICT_FILES" | while IFS= read -r file; do
            if [ -e "$HOME/$file" ]; then
                mkdir -p "$BACKUP_DIR/$(dirname "$file")"
                mv "$HOME/$file" "$BACKUP_DIR/$file"
                echo "        Backed up: $file"
            fi
        done

        log_detail "Retrying checkout..."
        dot git checkout "$BRANCH" || {
            err "Checkout failed after backup"
            exit 1
        }

        # Restore backed-up files so they appear as local modifications.
        # The user can review them with "dot diff" and reconcile.
        log_detail "Restoring previous files as local changes..."
        echo "$CONFLICT_FILES" | while IFS= read -r file; do
            if [ -e "$BACKUP_DIR/$file" ]; then
                mkdir -p "$HOME/$(dirname "$file")"
                cp "$BACKUP_DIR/$file" "$HOME/$file"
                echo "        Restored: $file"
            fi
        done

        echo ""
        log_detail "Pre-existing files preserved as working tree changes."
        log_detail "Review with: dot git diff"
        log_detail "Backups at:  $BACKUP_DIR"
    else
        err "Checkout failed for an unexpected reason:"
        echo "$CHECKOUT_OUTPUT"
        exit 1
    fi
else
    log_detail "Checkout completed with no conflicts"
fi

# Hide untracked files — $HOME has thousands of them
dot git config status.showUntrackedFiles no

# ===========================================================================
# Step 5: Run mise bootstrap (Stage 2)
# ===========================================================================
# What: Delegates to mise to run the dot:bootstrap task defined in mise.toml.
# Why: Stage 1 (this script) sets up the environment; Stage 2 (mise tasks) handles
#      tool installation, shell configuration, and system setup.
# Safety: Fails if mise task fails - no rollback. Idempotent because each task
#         checks its own prerequisites.
# Note: Skipped when using --only-checkout (no mise available yet).
#       This step can be rerun independently: mise run dot:bootstrap
if [ "$ONLY_CHECKOUT" = false ]; then
    # Ensure bin/ tool stubs and local bin are in PATH for mise tasks
    export PATH="$HOME/bin:$HOME/.local/bin:$PATH"

    log_section "Step 5: Running mise bootstrap..."
    mise run dot:bootstrap 2>&1 || {
        echo ""
        err "Bootstrap task failed"
        exit 1
    }
else
    log_section "Step 5: Running mise bootstrap [SKIPPED]"
fi

# ===========================================================================
# Done
# ===========================================================================
log_section "Bootstrap complete!"

log_detail "Reload your shell, then continue setup:"
echo ""
log_detail "  1. exec bash                            # reload shell"
log_detail "  2. mise run dot:setup                   # install brew, fish, completions"
log_detail "  3. exec bash && exec fish               # switch to fish"
echo ""

log_detail "Managing your dotfiles:"
log_detail "  dot git status                          # see what changed"
log_detail "  dot git diff                            # review changes"
log_detail "  dot git add <file>                      # stage a file"
log_detail "  dot git commit -m \"message\"             # commit"
log_detail "  dot lefthook run pre-commit --all-files # run linters"
echo ""

if [ "$ONLY_CHECKOUT" = true ]; then
    log_detail "Steps skipped (--only-checkout mode):"
    log_detail "  Step 1: GitHub PAT setup             # run bootstrap.sh without flags"
    log_detail "  Step 2: mise install                 # curl https://mise.run | sh"
    log_detail "  Step 5: mise bootstrap               # mise run dot:bootstrap"
    echo ""
    log_detail "To complete a full bootstrap, rerun without --only-checkout."
    echo ""
fi
