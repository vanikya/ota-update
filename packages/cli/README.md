# @vanikya/ota-cli

> **Beta Notice**: This package is currently in beta. Testing is in progress and APIs may change. Use in production at your own discretion. We welcome feedback and bug reports via [GitHub Issues](https://github.com/vanikya/ota-update/issues).

CLI tool for managing OTA (Over-The-Air) updates for React Native and Expo apps. A self-hosted alternative to CodePush and EAS Updates.

## Installation

```bash
npm install -g @vanikya/ota-cli
```

## Quick Start

### 1. Login to your OTA server

```bash
ota login
```

You'll be prompted for:
- Server URL (your Cloudflare Workers deployment)
- API Key

### 2. Create an app

```bash
ota apps create --name "My App" --slug my-app --platform both
```

### 3. Create a release channel

```bash
ota channels create --app my-app --name production
```

### 4. Generate signing keys

```bash
ota keys generate --app my-app
```

### 5. Publish an update

```bash
ota release --app my-app --channel production --version 1.0.0
```

## Commands

### Authentication

```bash
ota login              # Login to OTA server
ota logout             # Clear stored credentials
```

### App Management

```bash
ota apps list                                    # List all apps
ota apps create --name <name> --slug <slug>      # Create new app
ota apps delete --app <slug>                     # Delete an app
```

### Channel Management

```bash
ota channels list --app <slug>                   # List channels
ota channels create <name> --app <slug>          # Create channel
ota channels delete <name> --app <slug>          # Delete channel
```

### Releases

```bash
ota release --app <slug> --channel <channel> --version <version>   # Publish update
ota releases list --app <slug>                                      # List releases
ota rollback --app <slug> --channel <channel>                       # Rollback to previous
```

### Signing Keys

```bash
ota keys generate --app <slug>   # Generate Ed25519 key pair
ota keys export --app <slug>     # Export public key
```

### Analytics

```bash
ota analytics --app <slug>                    # View update statistics
ota analytics --app <slug> --days 30          # Last 30 days
```

## Configuration

Configuration is stored in `~/.ota-update/config.json`:

```json
{
  "serverUrl": "https://your-server.workers.dev",
  "apiKey": "ota_xxx..."
}
```

Signing keys are stored in `~/.ota-update/keys/<app-slug>.json`.

## Server Setup

This CLI requires a backend server. See [@ota-update/server](https://github.com/vanikya/ota-update) for deployment instructions.

## License

MIT
