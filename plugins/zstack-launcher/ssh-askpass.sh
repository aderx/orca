#!/bin/sh
# The credential belongs to this SSH process, not the project's environment file.
printf '%s\n' "$ORCA_ZSTACK_SSH_PASSWORD"
