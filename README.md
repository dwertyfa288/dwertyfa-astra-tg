# TG for Astra

TG for Astra connects a personal Telegram account to Astra. The plugin monitors selected chats, announces new messages with Astra's voice, plays voice messages, and sends replies dictated by the user.

## Features

- Login with a phone number, Telegram verification code, and two-step verification password.
- Support for private chats, groups, and channels.
- Monitoring of up to 10 chats at the same time.
- Customizable notification and reply-confirmation messages.
- Playback of Telegram voice messages in their original audio.
- Automatic transport selection: Telegram WSS first, followed by a fallback WSS relay.
- Text replies after a command word, for example `Astra, write I will be there soon`.

The two-step verification password is not stored after login.

## Development

Requirements: Node.js 20+ and the `astra-plugin` CLI.

```bash
npm install
npm run typecheck
npm run build
astra-plugin check --strict .
```

To run the plugin in development mode:

```bash
astra-plugin dev .
```

## License

MIT
