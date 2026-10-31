#!/bin/bash
# Let the data/ checkout push with the gh CLI's GitHub login (Mac/Pi with `gh auth login` done).
# Local to that checkout only; the global git config is untouched.
set -euo pipefail
DIR="${1:-data}"
git -C "$DIR" config --local --unset-all credential.helper || true
# The empty entry stops global helpers (e.g. osxkeychain) prompting; then use gh.
git -C "$DIR" config --local --add credential.helper ''
git -C "$DIR" config --local --add credential.helper '!gh auth git-credential'
echo "data push will use gh credentials for $DIR"
