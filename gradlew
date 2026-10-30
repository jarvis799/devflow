#!/usr/bin/env sh
# Uses a locally installed Gradle distribution; GitHub Actions invokes `gradle` directly.
exec gradle "$@"
