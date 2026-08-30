# Handoff: CB friends inside the game (boiii et al.)

The launcher already streams the player's friends to a connected fork over the named-pipe IPC as a
`{"type":"friends", ...}` message (built in `src/launcher/ipc/ipc_server.cpp` → `build_friends_line`).
As of the CB-social work it now emits **two kinds** of friends in the same `friends` array:

- **Discord friends** — the existing Discord-linked friends, unchanged, now tagged `source:"discord"`.
- **CB friends** — the launcher-native CB social graph (profile + friends that work without Discord),
  tagged `source:"cb"`.

Everything below is the launcher → fork contract. **The fork side (rendering the list in-game) is
not in this repo** and is what this document hands off.

## Wire format

One JSON object per line (newline-delimited), pushed on connect and whenever the set changes:

```json
{
  "type": "friends",
  "friends": [ /* entries, mixed sources */ ]
}
```

### Discord entry (`source: "discord"`)

```json
{
  "id": "196185157840011264",      // Discord user id
  "name": "Divity",
  "status": "online",              // "online" | "idle" | "offline"
  "inLauncher": true,
  "source": "discord",
  "game": {                          // present only when they're in a fork match
    "id": "boiii", "mode": "zm", "map": "zm_nuketown_x", "gametype": "tdm",
    "joinable": true, "directJoin": false, "openable": false, "sameMatch": false
  }
}
```

The `game.joinable`/`directJoin`/`openable`/`sameMatch` flags are what drive the in-game **Join / Ask
to Join** buttons today — unchanged.

### CB entry (`source: "cb"`)

```json
{
  "id": "cb_bceb6404193f402d864777d444280e2d",   // opaque CB account id
  "name": "k",
  "handle": "divity",              // CB @handle (unique); Discord entries have no handle
  "status": "online",              // online+in-game => "online"; online in launcher => "idle"; else "offline"
  "inLauncher": true,
  "source": "cb",
  "game": { "id": "boiii", "mode": "zm" }   // present only when online in a game; NO join fields
}
```

**CB entries never carry `joinable`/`directJoin`/`openable`/`sameMatch`** — CB presence has no join
secret yet, so CB friends are **display-only in-game** (show who's online and what they're playing,
no Join button). If/when CB gains game-session join, those fields get added here and the fork lights
up the button automatically.

## What the fork should do

1. **Read `source`** and render both kinds. Recommended: mirror the launcher UI and present two
   groups/tabs — "Discord" and "CB" — rather than one blended list.
2. **Gate Join on the join fields, not on source.** A CB entry simply has no `game.joinable`, so the
   existing "show Join iff joinable/openable" logic already yields no button for CB — no special-case
   needed if the check is field-based.
3. **Show the `@handle`** for CB entries (Discord entries won't have one).
4. **Ignore unknown fields** for forward-compat (the launcher may add more later).

## Dedup

There is intentionally **no cross-source dedup key**: CB entries do not expose the linked Discord id
(kept private on the backend), so a person who is both a Discord friend and a CB friend appears once
per source. Grouping by `source` (two tabs) sidesteps this cleanly; a blended list would show them
twice.

## Backward compatibility

The only change to existing Discord entries is the added `source:"discord"` field. A fork build that
predates this change ignores it and behaves exactly as before; CB entries it doesn't understand are
skipped as long as it keys its Join logic on the `game.*` fields rather than assuming every entry is
Discord.
