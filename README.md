# TG for Astra

TG for Astra connects a personal Telegram account to Astra. The plugin monitors selected chats, announces new messages with Astra's voice, plays voice messages, and sends replies dictated by the user.

## Features

- Login with a phone number, Telegram verification code, and two-step verification password.
- Support for private chats, groups, and channels.
- Monitoring of up to 1000 chats at the same time, with a one-click "monitor every chat" action.
- A privacy toggle that masks the account name and phone number; the state is kept in the plugin's own state file.
- A panel that lists the chats currently being monitored.
- A button that writes the ready-made Astra announcement command out as an `astra-commands` file to import.
- Customizable notification and reply-confirmation messages.
- Playback of Telegram voice messages in their original audio.
- Automatic transport selection: Telegram WSS first, followed by a fallback WSS relay.
- Immediate replies to incoming messages through an AI tool, for example `Astra, tell him I will be there soon`. No separate reply command or send confirmation is needed. The reply phrase and reply window are configurable in the plugin.
- AI chooses recipients from real Telegram contacts, using names and usernames to interpret inflections, nicknames, Russian/English spellings and speech recognition errors. Ambiguous recipients are clarified; selected chats are addressed by ID.
- Recent incoming messages have individual reply IDs, so another incoming message cannot redirect a reply that is already being sent.
- New Telegram messages through Astra AI tools: say, for example, `Astra, write to Andrey that I will be there soon`; Astra shows the resolved chat and draft first, then sends only after a separate confirmation.
- A customizable phrase for tool-based sending, such as `write` or `write in Telegram`. No Astra command-editor nodes are required for this feature.
- A separate AI-tool flow for sending one identical message to several existing chats, `@usernames`, Telegram folders, or a mixture of them.
- One confirmation for the entire broadcast, automatic folder expansion and duplicate removal, with a hard limit of 10 final recipients.
- A customizable broadcast phrase and a random delay range between individual sends. Ordinary per-chat errors do not stop the remaining queue, while Telegram flood-wait responses pause and retry it.
- An optional campaign auto-responder for private recipients of the latest confirmed broadcast. It stays active until disabled and each saved rule can answer each recipient only once per campaign.
- Unlimited auto-reply rule cards with editable trigger chips. Triggers may be full phrases and are committed with a comma or Enter; every rule sends one saved response verbatim.
- If one rule matches, it is selected locally. If several match, Astra silently receives the full incoming message and chooses one matching rule ID; the plugin never sends generated or rewritten model text.
- A short Astra voice confirmation after a successful background auto-reply, without speaking the recipient's message or the saved response.
- Concise tool responses: Astra asks only for the final send confirmation and reports only the final result, without narrating tool lookup or intermediate steps.

The two-step verification password is not stored after login.

Neural selection between several matching auto-reply rules uses Astra's `send_chat_message` permission. Astra may restrict this permission for an unsigned file import; test that branch through Developer Mode/source sideload or install a verified catalog release. Single-rule auto-replies do not need neural selection.

## Updating from command-based replies

Disable or delete the old `тг ответ` command in Astra. Import the updated command file if needed; it contains only `тг` for announcements and voice playback. Replying, sending new messages and broadcasts use AI tools. Ordinary speech is never automatically captured as reply text.

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
