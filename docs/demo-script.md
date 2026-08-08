# Pōneke Pulse — demo script

Judged demo, 16:30. **554 spoken words — 4:10 of speech, so it runs ~4:15 with clicks.**
Drop the two lines marked `[OPTIONAL]` and it lands at 4:00. Time it out loud once;
everyone reads faster on stage than they expect to.

Stage directions in `[SCREEN]`. Everything in **bold** is a line worth landing.

**Never say "real-time" or "live".** The header says `NOT LIVE · T+1 FEED` for the
whole demo. Claiming otherwise is the one thing a judge can catch instantly, and it
throws away the credibility the rest of the build is engineered for.

---

## 0:00 — 0:30 · The problem

`[SCREEN: title slide — "The day the city went quiet"]`

> When a storm moves through Wellington, or an area is told to evacuate — how does
> Council find out where people actually were?
>
> Today it waits for the phone to ring. Scattered reports, one place at a time, after
> the fact.
>
> **Wellington already has 128 cameras counting movement every hour. The city has a
> heartbeat. Nobody was listening to it.**

---

## 0:30 — 0:55 · What we built

`[SCREEN: slide 3 — baseline / actual / risk]`

> Pōneke Pulse learns what a normal hour looks like on every street — same weekday,
> same hour, from the trailing twelve weeks. Then it measures what actually happened
> against it, and shows you the gap.
>
> **What's on screen is never traffic volume. It's deviation — how differently the
> city is behaving from itself.**

---

## 0:55 — 1:50 · Week — the duty officer's brief

`[SCREEN: live app, Week tab, Tue 4 Aug, scrub to 18:00]`

> This is what the duty officer opens on. The solid line is what happened, the band
> behind it is what we expected.
>
> `[scrub the timeline]`
>
> Everything moves together — map, ranking, risk read.
>
> Tuesday, six in the evening. **Sixteen percent below forecast citywide — sixty-four
> of ninety-four scored streets down.**
>
> Every red street is a street behaving differently from how it behaves on an ordinary
> Tuesday. And this is the decision the whole tool rests on: **we measure the
> deviation. We never infer the cause.**

---

## 1:50 — 2:25 · Streets — from "something is off" to "these streets"

`[SCREEN: Streets tab]`

> Same hour, as a table. Every site, worst first, each with its own 24-hour trace
> against its own baseline. This is how you go from *something is off* to *it's these
> eleven streets*.
>
> `[point at the "not scored" count]`
>
> **A hundred and ten scored. Eleven not scored — and it says so.** A site we can't
> judge is never quietly counted as normal.

---

## 2:25 — 3:15 · Areas — the "so what"

`[SCREEN: Areas tab]`

> Here's the part that matters.
>
> A thirty percent drop on a back street is noise. The same drop inside a tsunami
> evacuation zone, during a warning, is a phone call.
>
> This crosses movement against hazard geography, and every period an area spent off
> forecast becomes an alert.
>
> `[point at the filters]`
>
> Filtered by what happened. **People left. People gathered. Or no stated cause — and
> that last one is the one you want to look at.**
>
> Because *more people than expected inside a hazard zone* is a completely different
> morning from *fewer, with no warning in force*.
>
> `[point at the coverage rail]`
>
> And this lists the hazard areas with **no camera inside them at all**. **Unwatched is
> not the same as quiet.**

---

## 3:15 — 3:45 · The proof — 23 October 2025

`[SCREEN: replay, 23 Oct]`

> Does it fire? Twenty-third of October last year. Red wind warning, gusts to 140 at
> Kaukau, every train in the region cancelled.
>
> **Forty-one percent below a normal Thursday.**
>
> You don't read a z-score. The solid line falls out of the bottom of its expected band
> — **and the gap is the emergency.**
>
> `[OPTIONAL — cut this to land at 4:00]`
> And the mode split is the diagnosis: pedestrians collapse but cars don't, and you
> know people stopped walking first. That's conditions on the street.

---

## 3:45 — 4:15 · Honest, and built to extend

`[SCREEN: back to Week, or the honesty slide]`

> **This is not live, and we won't pretend it is.** The feed publishes to yesterday —
> it's a next-morning tool. In an emergency, still call 111. It says so on every screen.
>
> Events, closures and weather come in as feeds, but **they never move the forecast.**
> They're there so a person can explain a deviation — not so the model can explain it
> away.
>
> **A tool that visibly declines to panic is worth more to an emergency manager than
> one that only fires correctly.**
>
> `[SCREEN: QR codes]`
>
> Deployed, open source, on screen now. Thank you.

---

## Delivery notes

**Pace.** ~135 words a minute. The clicking buys thinking time, so don't fill it with
talk. If you find yourself at 3:10 with everything said, you rushed — slow the Areas
section, which is the one that earns the marks.

**The three lines that carry the demo.** If you remember nothing else:
1. "What's on screen is never traffic volume. It's deviation."
2. "Unwatched is not the same as quiet."
3. "A tool that visibly declines to panic is worth more than one that only fires correctly."

**Cut first if you're over time** — in this order:
1. The mode-split lines at 3:15, already marked `[OPTIONAL]` (nice, not load-bearing)
2. The Streets tab entirely (Week + Areas alone tell the story)
3. The 23 Oct replay (painful, but Areas is the differentiator)

**Never cut** the honesty beat at 3:45. It's the strongest thing about the project and
it's what separates it from a dashboard.

**If the venue wifi dies**, the basemap goes grey and the data still renders. Say
"the basemap is a public tile service and we're offline — the data is all local"
and keep going. Don't debug it on stage.

---

## Numbers, current as of the build

Check these against the app before you present — the earlier deck has drifted.

| Claim | Current value |
|---|---|
| Camera sites | 128 (121 reporting) |
| Countlines | 398 |
| Road edges | **147** — the deck's 273 is out of date |
| Baseline window | trailing 84 days, up to 12 matched weekday-hours |
| Tue 4 Aug 18:00 | −16% citywide, 64 of 94 scored edges below |
| Streets tab | 110 scored, 11 not scored |
| Areas tab | 17 alerts, 9 hazard areas, 3 judgeable |
| 23 Oct 2025 | −41% citywide vs a normal Thursday |
| Causation feeds | 4 adapters, 2 connected |

---

## Adapting this for the video

The live demo and the video want different things.

**Record the screen separately from the voice.** Trying to narrate while driving the
app produces dead air on every click. Capture a clean screen pass first, then read the
script over it and cut the footage to the words.

**The video can be longer** — six to seven minutes without it dragging. The places
worth the extra time, in order: the 23 October replay (let the line fall out of the
band and hold on it), the mode-split diagnosis, and how a causation feed gets added.

**Open on the map, not on a title card.** The instrument is more arresting than any
slide, and the first five seconds decide whether the rest gets watched.

**Put the QR codes on screen for the last fifteen seconds**, not one second. People
need time to actually get their phone out.
