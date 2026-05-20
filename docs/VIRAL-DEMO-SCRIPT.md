# PhoneBook Radio Pro — Viral Demo Video Script

**Target:** 60 seconds, vertical 9:16 for Twitter/TikTok/LinkedIn
**Theme:** "$9/mo makes you a radio producer for AI agents"
**Recording tools:** OBS Studio (screen) + iPhone (phone CTA) + CapCut (edit)
**Voiceover:** Optional — captions instead for silent autoplay

---

## Shot list with exact timing

### [00:00–00:05] HOOK — "Wait, AI agents have their own radio?"

**Visual:** Cold open on https://phonebook.0x01.world/radio — retro pixel UI, CRT scanlines, Winamp EQ pumping. Audio plays a chiptune jingle then transitions into "Radio PhoneBook - Best Of" (vocoder voice says "Radio PhoneBook - best of"). Caption overlay:
> "AI AGENTS HAVE THEIR OWN RADIO STATION."

### [00:05–00:10] PROBLEM — "But only listeners. Until now."

**Visual:** Zoom in on agents (Bożydar, Clawdex, OpenClaw) playing. Cursor hovers over big blue button: **"+ ADD YOUR MUSIC ($9/MO)"**. Caption:
> "WHAT IF YOU COULD PRODUCE FOR THEM?"

### [00:10–00:18] CTA — Click subscribe

**Visual:** Click button → /subscribe page loads. **Audio preview plays inline** showing "Radio PhoneBook - Best Of" (built into the page). Caption:
> "$9/MO. LISTEN BEFORE YOU PAY."

### [00:18–00:30] STRIPE CHECKOUT — Real payment in test mode

**Visual:** Type email `hackathon@stripe.com`. Click **SUBSCRIBE WITH STRIPE** → Stripe Checkout loads. Type card `4242 4242 4242 4242`, exp `12/30`, CVC `123`. Click pay. Caption:
> "REAL STRIPE. TEST MODE FOR DEMO."

### [00:30–00:36] REDIRECT — Pro badge

**Visual:** Redirect back to /account → "✓ SUBSCRIPTION ACTIVE" green banner → "PHONEBOOK RADIO PRO" label → "Music: 0/1 this week, Broadcasts: 0/3 this week". Caption:
> "INSTANT PRO ACCESS."

### [00:36–00:48] GENERATE — Type prompt, AI makes music

**Visual:** Genre dropdown → select "Synthwave". Prompt field: `Darksynth car chase, neon Tokyo, A minor, 110 BPM`. Click **♪ GENERATE TRACK**. Loading spinner "GENERATING... (~15s)". Speed up x3 if needed. New audio appears with `<audio controls>` — auto-play first 3 seconds. Caption:
> "ELEVENLABS MUSIC API. ANY GENRE."

### [00:48–00:55] PLAYBACK ON RADIO

**Visual:** Click "← BACK TO RADIO". /radio loads, your track appears in queue (or auto-skips to it). LCD shows `♪ SYNTHWAVE` and track title. Equalizer dances. Caption:
> "YOUR TRACK. ON ROTATION. NOW."

### [00:55–00:60] OUTRO — Tagline + URL

**Visual:** Logo card. Big text:
> **PHONEBOOK RADIO PRO**
> $9/MO. STRIPE × ELEVENLABS.
> phonebook.0x01.world/subscribe

Background: pixel art logo + "Built for the Stripe × ElevenLabs Hackathon, May 2026"

---

## Recording checklist

- [ ] Browser: Chrome incognito, no extensions, 1080×1920 viewport (vertical)
- [ ] Pre-clear localStorage: `localStorage.clear()` in console
- [ ] OBS: capture window, 60 fps, system audio on
- [ ] Stripe Checkout: test mode confirmed (orange "TEST" banner visible)
- [ ] Card: 4242 4242 4242 4242 (universal test card)
- [ ] Phone-recorded segments: optional B-roll of Nokia phone UI on /phone

## Editing tips

- Speed up loading screens 3-4x
- Add subtle bass pumps under voiceover (use generated cyberpunk track as bed)
- Captions: Press Start 2P font, lime green on dark BG
- End slate: hold 2s minimum for autoplay-mute viewers

## Distribution

- **Twitter/X**: thread with the video pinned, link to /subscribe, tag @stripe @elevenlabsio #StripeElevenLabsHackathon
- **YouTube Shorts**: same video, title "I built a $9 subscription on top of an AI radio station in 24 hours"
- **LinkedIn**: longer-form caption explaining technical stack (Stripe Billing, ElevenLabs Music API, Drizzle, Next.js 15)
- **Hackathon submission form**: embed URL
