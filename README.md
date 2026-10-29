# TG for Astra

Reads messages from selected Telegram chats with Astra's voice and plays voice messages. Lets you reply and message contacts by voice, find recipients by name, send one message to several chats or a Telegram folder, and set up rule-based auto-replies. Announcement templates and reply phrases are customizable. Works without a VPN through the built-in proxy.

## Features

- QR login through the official Telegram app on your phone, without entering a phone number or waiting for a login code. Select the intended account on your phone before scanning; there is no country-code restriction. QR codes refresh automatically and 2FA passwords remain supported.
- Login with an international phone number, Telegram verification code, and two-step verification password. Use `+` followed by the country code and number, such as `+1`, `+44`, `+49`, `+380`, `+91` or any other country code; `00` can replace `+`. Spaces, parentheses, hyphens and dots are accepted. Numbers in the +7 numbering plan may also start with domestic 8 or bare 7. For other international numbers, use an explicit `+` or `00` to avoid ambiguity.
- Support for private chats, groups, and channels.
- Monitoring of up to 1000 chats at the same time, with a one-click "monitor every chat" action.
- A privacy toggle that masks the account name and phone number; the state is kept in the plugin's own state file.
- A panel that lists the chats currently being monitored.
- A button that writes the ready-made Astra announcement command out as an `astra-commands` file to import.
- Customizable notification and reply-confirmation messages.
- Playback of Telegram voice messages in their original audio.
- All Telegram connections use the configured authenticated WSS relay, including login, reconnections and media downloads. The plugin never tries a direct Telegram connection.
- Immediate replies to incoming messages through an AI tool, for example `Astra, reply: I will be there soon`. A short reply uses the latest incoming automatically; a reply to another sender can use its individual incoming ID. No separate reply command or send confirmation is needed. The reply phrase and reply window are configurable in the plugin.
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

Telegram chooses where login codes are delivered. An accepted code request does not prove delivery. If a code does not arrive, the retry button waits for Telegram’s cooldown and uses its offered next delivery method within the same login attempt. When Telegram offers no retry, the button shows elapsed waiting time instead of a fictional countdown. You can switch to QR login: Telegram on your phone → Settings → Devices → Link Desktop Device, then scan and approve. The plugin never restarts login just to resend a code; diagnostics record delivery types and delays, without recording codes or login hashes.

Neural selection between several matching auto-reply rules uses Astra's `send_chat_message` permission. Astra may restrict this permission for an unsigned file import; test that branch through Developer Mode/source sideload or install a verified catalog release. Single-rule auto-replies do not need neural selection.

## Setting up announcements and replies

1. Connect your Telegram account and select the chats to monitor.
2. In **Команды Astra**, prepare and import the command file, then enable the single **тг** command.
3. To set it up manually, create **тг** and connect these nodes: **Новое сообщение Telegram → Произнести → Проиграть голосовое Telegram**. Set the spoken text to `{announcement}` and use the voice from Astra settings.
4. Configure announcement templates, the reply phrase and the reply window in **Озвучивание и быстрый ответ** below the command instructions.
5. Ask Astra to reply to an incoming message, for example **«Астра, ответь: буду через час»**. The `reply_to_telegram` AI tool needs only the reply text for the latest incoming. It sends immediately without confirmation. For a different sender, Astra obtains the incoming context and selects that message. No reply command or text trigger is required.
6. For a new message, say **«Напиши Андрюхе, что скоро буду»**. AI chooses from actual Telegram contacts and clarifies ambiguous names. New messages and broadcasts still require draft confirmation.

## Updating from command-based replies

Disable or delete the old `тг ответ` command in Astra. Import the updated command file if needed; it contains only `тг` for announcements and voice playback. Replying, sending new messages and broadcasts use AI tools. Ordinary speech is never automatically captured as reply text.

Replies and new messages use different tools. A short reply accidentally routed into the draft tool is handled as a reply to the latest incoming, without creating a draft. If that request needs more context, the tool redirects Astra to `reply_to_telegram` instead of asking for send confirmation. Tool discovery and whether the model calls a tool are controlled by Astra; the plugin cannot intercept an ordinary model answer when no tool is called.

All model-facing tool and parameter instructions are in English, with Russian utterance examples and configurable phrase hints. They specify the lookup/reply/draft flows and Astra's wrapper format: the tool ID belongs in `tool_call.id`, while `tool_call.arguments` contains only fields from the selected tool's schema. For contacts, use `{}` or `{"offset":0}`. Schema errors and permission denials must be reported accurately; they do not indicate a Telegram connection failure. User-facing replies and dictated messages keep their original language.

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
