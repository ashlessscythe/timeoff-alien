#!/bin/bash

# Update and install necessary packages
sudo apt-get update
sudo apt-get install -y tmux ranger tig cargo mycli postgresql-client postgresql-client-common libpq-dev

# Remove pgcli if installed via apt
sudo apt-get remove -y pgcli

# Ensure Python pip is installed
sudo apt-get install -y python3-pip

# Install pgcli via pip
pip3 install pgcli

# Clone the GitHub repository into a directory named "tmux" if it doesn't already exist
if [ ! -d "$HOME/tmux" ]; then
  git clone https://github.com/gpakosz/.tmux.git "$HOME/tmux"
fi

# Create a symbolic link for the .tmux.conf file from the cloned repo to the home directory if it doesn't exist
if [ ! -L "$HOME/.tmux.conf" ]; then
  ln -s "$HOME/tmux/.tmux.conf" "$HOME/"
fi

# Neovim installation and setup
NVIM_VERSION="v0.9.5"
DOWNLOAD_URL="https://github.com/neovim/neovim/releases/download/${NVIM_VERSION}/nvim-linux64.tar.gz"
DOWNLOAD_DIR="$HOME/Downloads"
NVIM_TAR="$DOWNLOAD_DIR/nvim.tar.gz"
EXTRACT_DIR="$HOME/nvim"
NVIM_BIN="$EXTRACT_DIR/bin"

# Step 1: Download Neovim only if it doesn't exist or version is different
if [ ! -d "$NVIM_BIN" ] || [ ! -f "$NVIM_BIN/nvim" ] || [ "$($NVIM_BIN/nvim --version | grep -o "$NVIM_VERSION")" != "$NVIM_VERSION" ]; then
  mkdir -p "$DOWNLOAD_DIR"
  curl -L -o "$NVIM_TAR" "$DOWNLOAD_URL"

  # Step 2: Extract Neovim
  mkdir -p "$EXTRACT_DIR"
  tar -xzf "$NVIM_TAR" -C "$EXTRACT_DIR" --strip-components 1
fi

# Step 3: Add Neovim bin to PATH if not already added
if ! grep -q "$NVIM_BIN" "$HOME/.bashrc"; then
  echo "export PATH=\$PATH:$NVIM_BIN" >>"$HOME/.bashrc"
fi

# Reload .bashrc to apply changes immediately
source "$HOME/.bashrc"

# Step 4: Install Neovim plugins if not already installed
if [ ! -d "$HOME/.config/nvim" ]; then
  git clone https://github.com/LazyVim/starter "$HOME/.config/nvim"
  rm -rf "$HOME/.config/nvim/.git"
fi

echo "Neovim has been installed and added to PATH. Please restart your terminal or source your .bashrc to apply changes."

# Function to check and install Cargo packages
check_and_install() {
  if ! cargo install --list | grep -q "^$1 "; then
    echo "Installing $1..."
    if [ -z "$2" ]; then
      cargo install --locked --force "$1"
    else
      cargo install --locked --force "$1" --version "$2"
    fi
  else
    echo "$1 is already installed."
  fi
}

# Utilizing the function for each package
# check_and_install cargo-binstall
# check_and_install cargo-shuttle

# Add aliases if they don't exist
declare -a aliases=(
  'alias dcu="docker compose up -d"'
  'alias dcd="docker compose down"'
  'alias dlf="docker logs -f"'
  'alias dls="watch docker ps -a"'
  'alias up="cd ../"'
  'alias dreset="dcd && yes | docker system prune -a && dcu --build"'
  'alias glg="git log --oneline --decorate --graph --all"'
)

for alias_cmd in "${aliases[@]}"; do
  alias_name=$(echo "$alias_cmd" | awk -F'=' '{print $1}' | awk '{print $2}')

  if ! grep -q "^alias $alias_name=" "$HOME/.bashrc"; then
    echo "$alias_cmd" >>"$HOME/.bashrc"
    echo "Added $alias_name to ~/.bashrc"
  else
    echo "$alias_name already exists in ~/.bashrc"
  fi
done

# Set EDITOR to nvim if not already set
if ! grep -q "EDITOR=nvim" "$HOME/.bashrc"; then
  echo 'export EDITOR=nvim' >>"$HOME/.bashrc"
fi

# Reload .bashrc to apply changes immediately
source "$HOME/.bashrc"
