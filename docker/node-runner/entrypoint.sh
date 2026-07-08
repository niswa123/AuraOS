#!/bin/sh
set -e

# Forward signals for graceful shutdown
trap 'exit 143' TERM
trap 'exit 130' INT

# Execute Node.js with all arguments passed from Docker CMD
exec node "$@"
