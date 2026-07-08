#!/bin/bash
set -e

# Forward signals for graceful shutdown
trap 'exit 143' SIGTERM
trap 'exit 130' SIGINT

# Execute Python with all arguments passed from Docker CMD
exec python3 "$@"
