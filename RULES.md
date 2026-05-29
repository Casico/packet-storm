# PACKET STORM (working title)

*A real-time, remote-play, co-op network defense party game for 4–10 engineers. ~10-minute rounds. Voice chat (Discord etc.) assumed.*

## The Pitch
Your team runs a network under attack. Threats fire on a shared topology. Every player has a role, a token on the map, and a personal task list — but your tasks always need *someone else's* role to complete. So you shout. A lot. New devices keep spawning. The network keeps growing. Eventually something gets pwned.

## Setup
- Host opens the game URL, gets a room code.
- Players join the room from anywhere in their browser.
- Pick roles (auto-assigned if not enough/too many players — see scaling below).
- Pick a map (start with **Small Office**, ~8 nodes) and difficulty.
- Voice chat is on you — Discord, Zoom, whatever your group uses.

## What's On Screen
Every player sees the same single-screen view:
- **Center:** the topology — nodes (devices), edges (links), all player tokens, active threats overlaid on affected nodes.
- **Right panel:** your role's actions and your current task list.
- **Top bar:** round timer, alert queue, Customer DB health.
- **Bottom:** voice chat is external; in-game chat is intentionally absent (forces voice).

## Roles
Each role has exclusive actions. Tasks fire to specific players within a role; any player in that role pool can take it over if closer.

- **NetEng** — configure interfaces, assign VLANs, push routes, **build new links**, connect new nodes as they spawn.
- **SecOps** — write ACLs, block ports, quarantine VLANs, kill sessions.
- **SysAdmin** — patch hosts, restart services, isolate VMs.
- **NOC** — run packet captures (reveals hidden threat details for everyone), triage the alert queue, dismiss false positives.

### Player Count Scaling
| Players | NetEng | SecOps | SysAdmin | NOC |
|---|---|---|---|---|
| 4 | 1 | 1 | 1 | 1 |
| 5 | 2 | 1 | 1 | 1 |
| 6 | 2 | 2 | 1 | 1 |
| 7 | 2 | 2 | 2 | 1 |
| 8 | 3 | 2 | 2 | 1 |
| 9 | 3 | 3 | 2 | 1 |
| 10 | 3 | 3 | 3 | 1 |

NetEng scales first — they have the most steady work (new node hookups + redundant link building).

## The Map & Tokens
- Every player has a colored token with their name on it.
- **Arrow keys** move your token along edges, one link at a time (~3s traversal, progress bar visible).
- **Only one token per link at a time.** If a link is in use, you're blocked — wait or route around.
- To act on a node, your token must be *at* that node.
- **NetEng can build a new link** between two adjacent nodes — relieves congestion, creates redundant paths, connects new spawns. This is the Mini Metro lever. (Cost & timing under Bandwidth.)

## Bandwidth (the only resource)
A single shared pool, visible to everyone. The whole team feeds it; NetEng spends it.

- **Starting pool:** 3.
- **Earned by every player:**
  - Completed task → **+1**
  - Resolved threat → **+2**
- **Spent by NetEng:**
  - Normal link build → **1 bandwidth, ~8s**
  - Emergency link build → **2 bandwidth, ~3s** (the panic button when a new node spawns next to an active threat)

Side effect we want: SysAdmin grinding through patches isn't just "doing my job," it's fueling NetEng's ability to keep the topology alive. Everyone's small work matters. Expect yelling like *"don't blow bandwidth, I'm two tasks from another one!"*

Deliberately **one resource only**. No money, no second currency — see Out of Scope.

## The Loop
Every ~10s an event fires.

**Tasks** (delivered to a player's panel, must be shouted):
> *"NetEng-2: assign VLAN 42 to gi0/3 on access-sw-2"*
> *"SysAdmin: patch CVE-2025-1138 on web-srv-3"*
> *"NOC: open a ticket for the BGP flap on edge-1"*

**Threats** (appear on the map with a countdown):
> *"Port scan from 1.2.3.4 → edge-1 — 45s to ACL"* (SecOps at edge-1)
> *"Ransomware on file-srv — spreads every 20s — isolate VLAN AND patch"* (SecOps + SysAdmin)
> *"BGP hijack — push route filter from BOTH edge routers simultaneously"* (two NetEngs, two nodes, in sync)

Multi-role / multi-position threats are the spicy ones. NOC's packet capture reveals which threats are real vs. noise.

## Escalation
- **Every 60s, a new node spawns** disconnected from the topology. NetEng has ~45s to connect it via a new link. Unconnected nodes become "shadow IT" and start auto-generating threats.
- Threat cadence accelerates each minute.
- Multi-step / multi-role threats appear more often after minute 3.

## Win / Lose
- **Win:** survive 8 minutes without losing the Customer DB.
- **Hard fail (any one of):**
  - Customer DB node compromised.
  - Alert queue overflows (>6 unaddressed threats simultaneously).
  - Topology fully partitioned from the internet edge.
- On loss, the screen shows: **"You failed the network."** Then a blameless postmortem — what got pwned, who was stuck on which link, what task sat untouched.

## Vibe Rules
- Tasks should *sound* absurd when shouted ("permit tcp any host 10.0.4.4 eq 443!"). Real network jargon is the joke.
- Rounds are 8–12 min. Lose fast, restart faster.
- Watching 10 colored dots bumble around routing-around-each-other is the visual comedy. Lean into the awkward movement.

## Out of Scope (v1)
- Saboteur / traitor mode (revisit after pure co-op is dialed in).
- In-game text chat (forces voice).
- Custom maps / map editor.
- Persistent stats / unlocks (party game, not a roguelike).

## Considered and Rejected
*(noted so future-us doesn't re-litigate)*

- **Spaceteam-style tool exchange.** Tools/items randomly distributed to players, traded mid-game. Rejected because role specialization + spatial positioning + link contention already manufacture the "I can't do this myself, you have to" energy. Adding a tool layer would be one too many things to track in a party game.
- **Money / second currency.** A budget layer for buying upgrades, abilities, etc. Rejected because two competing resources split attention from real-time chaos, and shopping/spending decisions are a strategy-game vibe, not a party-game vibe. Bandwidth is the only resource.
