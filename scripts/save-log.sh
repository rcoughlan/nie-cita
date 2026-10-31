#!/bin/bash
# Commit and push checks.csv in the given data-branch checkout. No-op if nothing changed.
set -e
cd "$1"
git add checks.csv
git diff --cached --quiet && exit 0
git -c user.name="nie-cita bot" -c user.email="nie-cita@users.noreply.github.com" commit -q -m "Log checks"
for i in 1 2 3; do
  git pull -q --rebase && git push -q && exit 0
  sleep 5
done
echo "push failed after retries"
