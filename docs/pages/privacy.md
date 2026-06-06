---
layout: default
title: Privacy Policy
---

[Home](..) | [Innovation](innovation) | [Azul](azul) | [Crew](crew) | [Play time](time-tracking) | [Development](development) | [Privacy](privacy)

---

# Privacy Policy

**BGA Assistant** is a browser extension that helps players keep track of game state on [Board Game Arena](https://boardgamearena.com). This policy explains how the extension handles your data.

## Data collection

BGA Assistant does **not** collect, transmit, or store any personal data. There are no analytics, telemetry, or tracking of any kind. The extension does not make network requests to any servers other than `boardgamearena.com` (which your browser already connects to when playing).

## How the extension works

- The extension reads game log data from BGA pages you visit using host permissions (`boardgamearena.com`).
- All processing happens locally in your browser — game state is computed on your device and never sent anywhere.
- Display preferences (such as section visibility and toggle states) are saved in your browser's `localStorage` and never leave your device.

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Read the current BGA game page when you click the toolbar icon |
| `scripting` | Inject a content script to extract game log data from BGA pages |
| `sidePanel` | Display the game state summary in a Chrome side panel |
| `tabs` | Detect navigation to BGA game pages and update side panel content based on the table currently open |
| `host_permissions` (boardgamearena.com) | Access game log data on BGA pages |

## Third-party services

BGA Assistant does not communicate with any third-party services. All fonts and assets are bundled with the extension.

## Changes

If this policy changes, the updated version will be posted at this URL.

## Contact

For questions or concerns, please open an issue on the [GitHub repository](https://github.com/AnotherSava/bga-assistant).
