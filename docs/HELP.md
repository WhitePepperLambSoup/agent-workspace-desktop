# Help

[简体中文](HELP.zh-CN.md)

## Getting started

The first time it opens, the app asks for two things.

1. **A model.** Choose a provider, paste its API key and click Connect and save. The key is tried once, and the provider becomes the default only if that works. DeepSeek, Qwen, Kimi and GLM can be reached directly from mainland China; OpenAI, Claude, Gemini and Grok need a network that can reach them. For a model on this computer, choose Ollama, LM Studio, llama.cpp or vLLM; no key is needed.
2. **A folder to work in.** The agent reads and writes files in this folder and asks before changing anything. If unsure, use the default folder (under Documents\Agent Workspace). You can add other folders at any time.

The key is kept in Windows Credential Manager, not in any file.

## Windows says it protected your PC

The app has no code-signing certificate yet, so SmartScreen warns about it. Choose More info, then Run anyway. You can compare the installer's SHA-256 with the one on the release page:

```powershell
Get-FileHash .\AgentWorkspace-Setup-1.0.0.exe -Algorithm SHA256
```

## The model will not connect

| Message | What to do |
| --- | --- |
| The provider rejected this key | Check that it is complete, not expired, and from this provider. |
| No balance or quota left | Top up on the provider's site. |
| The provider is limiting requests | Try again shortly, or choose another model in Settings. |
| Could not reach the provider | Check the network. If you use a proxy, turn on the system proxy; the app follows it. PAC scripts are not supported yet. |
| The provider does not know this model | Check the model's name, and change it in Settings → Provider and runtime if the provider renamed it. |

When a task stops on one of these, the conversation says why and offers Open Settings or Try again.

## Does it keep running after the window closes?

If a task is running, a task is scheduled or the phone connection is on, closing the window asks whether to keep running in the background or quit. In the background the app stays in the notification area of the taskbar; click its icon to open the window again.

Settings → Running in the background changes:

- what closing the window does;
- starting with Windows, in the background;
- keeping the computer from sleeping while a task runs (on by default; this stops idle sleep only, and closing a laptop's lid still sleeps).

Scheduled tasks run only while the app is running.

## Cost

Settings has a monthly bill, and limits per task and per month. The composer estimates a task from your recent ones. Amounts use list prices; the provider's bill is what counts.

## Very long tasks

A task can run for up to a day without a break. When the network or a connection drops, the app waits and tries again by itself, for about seven minutes; a connection that sends nothing for five minutes is reconnected too. Models on this computer have no such time limit. You get a notice when a task goes quiet for five minutes or fails.

The default cost limit per task is 50 US dollars. A task that reaches it stops, and sending "continue" goes on. Settings can change the limit.

## Orders in outside content

If a web page, a document or a command's output has text that looks like orders to the AI ("ignore your previous instructions"), the conversation says so: every further step of that turn asks you first, what was allowed for the conversation is withdrawn, and nothing is written to memory or the knowledge base. The next message goes back to normal. This looks for common wording and cannot catch everything.

## Phone connection

This needs the Android app 2.5.0 or later. Turn on Settings → Phone connection and scan the QR code with the phone. Both need to be on the same network, or both on Tailscale. If Windows Firewall blocks phones, the page says so and offers to allow them, and Windows asks you to confirm.

## Data and backups

Everything stays on this computer:

| What | Where |
| --- | --- |
| Conversations, knowledge base, memory, backups | `%LOCALAPPDATA%\AgentWorkspace` |
| Window settings, logs, crash dumps | `%APPDATA%\agent-workspace-desktop` |
| API keys | Windows Credential Manager |

The database is backed up once a day and the last ten backups are kept. Settings → Data and backups shows the space used, backs up on request and restores a backup. A restore restarts the app; the database it replaces stays in the data folder, with `before-restore` in its name.

If the database is damaged, the conversation page offers the latest backup or an empty database. Neither deletes the damaged file.

Uninstalling leaves these folders in place. To remove everything, delete them after uninstalling.

## Updates

The app looks for a new version once a day, reading the releases page only. It says so in the corner of the window, and downloads only when you click. Settings → About & Updates turns the check off. The portable folder cannot update itself.

## The window feels slow

- Turn off the 3D backdrop: Settings → Appearance → Backdrop → Colour field.
- Check that 3D graphics is on Standard. High is meant for computers with a discrete graphics card.
- Turn off Refraction in Settings → Appearance.

Without GPU acceleration the app uses the colour field by itself.

## Security

The sandbox is a review boundary, not operating-system isolation: commands in it keep the current user's access to other files and the network. Do not use YOLO or Full access in a repository you do not trust. See [SECURITY.md](../SECURITY.md).

## Reporting a problem

In Settings → About & Updates:

- Export diagnostics writes a report with keys masked and no conversation text;
- Report a problem opens a new issue on GitHub. Attaching the report helps.

Do not put API keys, private code or personal data in a report. Report security problems privately with Report a vulnerability on the repository's Security tab.
