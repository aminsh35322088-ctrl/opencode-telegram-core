# OpenCode Telegram Core

A Telegram-oriented runtime distribution derived from OpenCode.

> This project is independent and is not affiliated with or maintained by the OpenCode team.

## Purpose

opencode-telegram-core produces a reproducible, version-pinned OpenCode runtime for opencode-telegram-bot while keeping Telegram-specific changes deliberately small.

The repository tracks an exact upstream OpenCode release and commit, applies a reviewed patch series, builds a standalone Linux runtime, verifies runtime/SDK compatibility, and publishes versioned artifacts that the bot can pin or roll back.

## Initial baseline

- Upstream repository: anomalyco/opencode
- Upstream release: v1.18.31
- Upstream commit: 014614d35b397775e5d397a490fc72368c894ec2
- Upstream package manager: bun 1.3.14
- Delivery model: versioned GitHub Release artifacts
- Production consumer: opencode-telegram-bot

Architecture: docs/superpowers/specs/2026-09-20-opencode-telegram-core-design.md
