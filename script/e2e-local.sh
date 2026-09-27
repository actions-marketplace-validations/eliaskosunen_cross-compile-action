#!/bin/bash
# Runs the End-to-end workflow locally with act (https://github.com/nektos/act).
# Arguments are passed to act, and UBUNTU selects the hosts, e.g.:
#   UBUNTU=24.04 script/e2e-local.sh --matrix target:hppa-linux-gnu
set -euo pipefail

read -ra releases <<< "${UBUNTU:-24.04 26.04}"

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$root"

for release in "${releases[@]}"; do
    docker build --quiet --build-arg "UBUNTU=$release" \
        --tag "cross-compile-action-runner:$release" test/runner
done

temp=$(mktemp -d)
cleanup() {
    # The jobs run as root, so their files can't be removed by the current user
    docker run --rm --volume "$temp:/temp" ubuntu:26.04 \
        find /temp -mindepth 1 -delete
    rmdir "$temp"
}
trap cleanup EXIT

# A snapshot of the repository, including uncommitted changes. act fails jobs
# outside a git repository, so it's committed to a repository of its own.
mkdir "$temp/snapshot"
git ls-files --cached --others --exclude-standard -z \
    | rsync --archive --from0 --files-from=- . "$temp/snapshot"
git -C "$temp/snapshot" init --quiet
git -C "$temp/snapshot" add --all
git -C "$temp/snapshot" -c user.name=e2e -c user.email=e2e@localhost \
    -c commit.gpgsign=false commit --quiet --message 'Local end-to-end test'

status=0

# Runs act in a fresh copy of the snapshot, so that jobs can't see each other's
# build directories
run_act() {
    local workspace
    workspace=$(mktemp -d -p "$temp")
    cp -a "$temp/snapshot/." "$workspace"
    (cd "$workspace" && act "$@") || status=1
}

# act doesn't resolve `runs-on: ubuntu-${{ matrix.ubuntu }}` per matrix
# combination, so run each host separately, with every runner label mapped to
# its image
for release in "${releases[@]}"; do
    image="cross-compile-action-runner:$release"
    act_args=(
        --workflows .github/workflows/e2e.yml
        --platform "ubuntu-24.04=$image"
        --platform "ubuntu-26.04=$image"
        --matrix "ubuntu:$release"
        --pull=false
        # The action mounts binfmt_misc in the job container to check the handlers
        --privileged
    )
    for job in targets setup-only versions; do
        run_act "${act_args[@]}" --job "$job" "$@"
    done
    # Container mode mounts the workspace into a sibling container, so the job
    # container must use the host path (--bind). The jobs share it, so they
    # run one at a time.
    run_act "${act_args[@]}" --job container --bind --concurrent-jobs 1 "$@"
done
exit $status
