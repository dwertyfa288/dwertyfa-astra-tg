# TG for Astra

TG for Astra connects a personal Telegram account to Astra. The plugin monitors selected chats, announces new messages with Astra's voice, plays voice messages, and sends replies dictated by the user.

## Features

- Login with a phone number, Telegram verification code, and two-step verification password.
- Support for private chats, groups, and channels.
- Monitoring of up to 1000 chats at the same time, with a one-click "monitor every chat" action.
- A privacy toggle that masks the account name and phone number; the state is kept in the plugin's own state file.
- A panel that lists the chats currently being monitored.
- A button that writes the two ready-made Astra commands out as an `astra-commands` file to import.
- Customizable notification and reply-confirmation messages.
- Playback of Telegram voice messages in their original audio.
- Automatic transport selection: Telegram WSS first, followed by a fallback WSS relay.
- Text replies after a command word, for example `Astra, write I will be there soon`.
- New Telegram messages through Astra AI tools: say, for example, `Astra, write to Andrey that I will be there soon`; Astra shows the resolved chat and draft first, then sends only after a separate confirmation.
- A customizable phrase for tool-based sending, such as `write` or `write in Telegram`. No Astra command-editor nodes are required for this feature.

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
