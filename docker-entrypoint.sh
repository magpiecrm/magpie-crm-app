#!/bin/sh
set -e

# Any volume mounted at $HOME (production mounts one at /data) predates the
# non-root appuser and is root-owned; fix that up before dropping privileges.
if [ -d "$HOME" ]; then
  chown -R appuser:appuser "$HOME"
fi

exec gosu appuser "$@"
