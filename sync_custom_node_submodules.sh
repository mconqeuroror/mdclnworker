#!/bin/bash
set -euo pipefail

checkout="${1:-}"
if [ -z "${checkout}" ] || [ ! -d "${checkout}/.git" ]; then
    echo "ERROR: custom-node submodule checkout is missing or not a Git worktree" >&2
    exit 1
fi
gitlink_paths=()
gitlink_commits=()
while IFS=$' \t' read -r mode type commit relative; do
    [ "${mode}" = "160000" ] || continue
    gitlink_paths+=("${relative}")
    gitlink_commits+=("${commit}")
done < <(git -C "${checkout}" ls-tree -r HEAD)

# Some custom-node commits retain stale .gitmodules entries after removing the
# corresponding gitlink. Only mode-160000 entries in the committed tree are
# executable source dependencies.
if [ "${#gitlink_paths[@]}" -eq 0 ]; then
    exit 0
fi
if [ ! -f "${checkout}/.gitmodules" ]; then
    echo "ERROR: committed custom-node gitlink has no .gitmodules metadata" >&2
    exit 1
fi

mapfile -t declared_paths < <(
    git -C "${checkout}" config -f .gitmodules --get-regexp '^submodule\..*\.path$' \
        | awk '{ print $2 }'
)
for relative in "${gitlink_paths[@]}"; do
    declared=0
    for candidate in "${declared_paths[@]}"; do
        if [ "${candidate}" = "${relative}" ]; then
            declared=1
            break
        fi
    done
    if [ "${declared}" -ne 1 ]; then
        echo "ERROR: committed custom-node gitlink has no matching metadata" >&2
        exit 1
    fi
done

GIT_TERMINAL_PROMPT=0 git -C "${checkout}" submodule sync --recursive
GIT_TERMINAL_PROMPT=0 git -C "${checkout}" submodule update \
    --init --recursive --depth 1

status="$(git -C "${checkout}" submodule status --recursive)"
if [ -z "${status}" ]; then
    echo "ERROR: custom-node submodules produced no locked status" >&2
    exit 1
fi
while IFS= read -r line; do
    if [ "${line:0:1}" != " " ]; then
        echo "ERROR: custom-node submodule is not at its recorded commit" >&2
        exit 1
    fi
done <<< "${status}"

for index in "${!gitlink_paths[@]}"; do
    relative="${gitlink_paths[${index}]}"
    expected_commit="${gitlink_commits[${index}]}"
    if [ ! -d "${checkout}/${relative}" ]; then
        echo "ERROR: declared custom-node submodule was not populated" >&2
        exit 1
    fi
    actual_commit="$(git -C "${checkout}/${relative}" rev-parse HEAD)"
    if [ "${actual_commit}" != "${expected_commit}" ]; then
        echo "ERROR: custom-node submodule differs from its committed gitlink" >&2
        exit 1
    fi
done
