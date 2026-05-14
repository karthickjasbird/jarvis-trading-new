# Changelog

All notable changes to Jarvis Trading Platform will be documented in this file.

## [1.0.0] - 2026-05-14

### Added
- Multi-tenant OWNER_USER_ID scoping across all background engines
- Auto-detect owner middleware (captures UID on first sign-in)
- Onboarding Wizard — floating setup checklist for new users
- Version Update Banner — checks GitHub for updates, shows notification
- Firestore security rules for per-user data isolation
- Copy User ID button in Broker Settings
- Jarvis Self-Awareness System — auto-generated app manifest injected into AI context
- `inspectSystem` tool — Jarvis can query his own capabilities mid-conversation

### Fixed
- Logout confirmation modal (replaced broken `window.confirm` with React modal)
- Firestore composite index for `sentryConfigs` collection

### Security
- Deployed strict Firestore rules preventing cross-user data access
- Background engines now filter all queries by OWNER_USER_ID
