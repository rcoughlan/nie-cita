#!/bin/bash
# Commit and push checks.csv in the given data-branch checkout. Also pushes commits left over
# from an earlier failed push. No-op if there's nothing new.
set -e
cd "$1"
git add checks.csv
if ! git diff --cached --quiet; then
  git -c user.name="nie-cita bot" -c user.email="nie-cita@users.noreply.github.com" commit -q -m "Log checks"
fi
git fetch -q origin data || true
[ -z "$(git rev-list origin/data..HEAD 2>/dev/null)" ] && exit 0
for i in 1 2 3; do
  git pull -q --rebase && git push -q && exit 0
  sleep 5
done
echo "push failed after retries"
