# Agent Cursor

Herdr plugin: floating overlay near the cursor showing which agent panes are working, blocked or done. Native window adapted from [Glimpse](https://github.com/HazAT/glimpse) (MIT).

- Idle panes hidden; only working → single pill (names the agents)
- Blocked or done → expands to rows; blocked shows what the agent is asking (`Bash: npm test`)
- Done rows stay until you move the mouse or focus the pane, then fade after 4s
- Same-named panes disambiguated by tab (`lekey/2`); `herdr agent rename` wins
- Hidden while herdr's terminal is frontmost (herdr already shows state there)
- **⌃⌥J** jumps to the next blocked/done agent: focuses its pane and brings the terminal forward; press again to cycle

## Requirements

macOS 12+, [herdr](https://herdr.dev) ≥ 0.8, Node 20+. The overlay ships prebuilt (`native/bin`, universal arm64/x86_64, ad-hoc signed); Xcode CLT only needed to rebuild (`sh native/build.sh`).

## Install

From a clone:

```sh
sh bin/install.sh        # herdr plugin link + start
```

From GitHub:

```sh
herdr plugin install <owner>/<repo>
```

Starts automatically with the herdr server.

## Use

```sh
herdr plugin action invoke local.agent-cursor.toggle
sh bin/run.sh status     # daemon + current view
npm test
```

Log: `~/.local/state/herdr/plugins/local.agent-cursor/daemon.log`

## Actions from Raycast / launchers

URL scheme (registered by `bin/install.sh`):

| URL | Does |
|---|---|
| `agent-cursor://jump` | focus next blocked/done agent, bring terminal forward |
| `agent-cursor://focus/w6:p4` | focus that pane (ids from `run.sh status`) |
| `agent-cursor://toggle` · `start` · `stop` | overlay on/off |

leky: `action = "core.open-url"`, `args = { url = "agent-cursor://jump" }`; test with `leky action run core.open-url --args '{"url":"agent-cursor://jump"}'`.

```sh
open agent-cursor://jump            # any launcher, leky, Raycast quicklink
sh <plugin>/bin/run.sh jump         # same, skips LaunchServices (faster)
```

Only these actions are accepted; anything else is rejected and logged.

## Config

Optional `~/.config/herdr/plugins/config/local.agent-cursor/config.json`:

```json
{ "hotkey": "ctrl+opt+j", "hideWhenFrontmost": true, "terminalBundleId": "com.mitchellh.ghostty" }
```

`hotkey: null` disables it. Terminal defaults to the app that launched herdr. Restart the daemon after editing (toggle twice).

## Layout

- `herdr-plugin.toml` — startup hook, toggle/status actions
- `src/daemon.mjs` — herdr event streams + poll → state → overlay; hotkey jump
- `native/urlhandler.swift` — `AgentCursor.app`, forwards `agent-cursor://` URLs to `run.sh url`
- `native/overlay.swift` — window, cursor follow, cursor-moved, frontmost hide, global hotkey (`src/overlay.mjs` wraps it)
- `src/state.mjs` — pure reducer/view (visibility, done/seen, names)
- `src/prompt.mjs` — blocked-screen → reason heuristic
- `src/ui.mjs` — overlay HTML
- `src/herdr.mjs` — socket client
