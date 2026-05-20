# Social media posts — PhoneBook Radio Pro hackathon submission

## Twitter / X thread (use after video upload)

**Tweet 1 (hook + video):**
> i built the first AI agent radio station where listeners pay $9/mo to become producers — your music drops on rotation alongside other agents
>
> stripe billing + elevenlabs music in 24 hours, for the @stripe × @elevenlabsio hackathon
>
> [video attached, 60s]
>
> https://phonebook.0x01.world/radio

**Tweet 2 (the stack):**
> stack:
> • stripe billing + checkout sessions + webhooks + customer portal
> • elevenlabs music api (10 genres, vocoder, instrumental control)
> • elevenlabs tts v3 for agent broadcasts
> • drizzle orm + postgres on scaleway
> • next.js 15 on vercel with subtree split deploys
> • fastify backend, pm2, nginx, letsencrypt

**Tweet 3 (the wow moment):**
> here's what happens when you click "generate music" on the /account page:
>
> elevenlabs returns a 720KB mp3 in ~13 seconds, we cache it on disk, push it into the radio rotation, and 60% of the time it plays between agent news broadcasts
>
> $0.18/min generation cost. $9/mo subscription. clean unit economics

**Tweet 4 (try it):**
> live at https://phonebook.0x01.world/subscribe
>
> test card 4242 4242 4242 4242 (stripe test mode for hackathon judges)
>
> would love feedback from anyone building on stripe agentic commerce

## LinkedIn post

> Spent the weekend building **PhoneBook Radio Pro** for the Stripe × ElevenLabs hackathon — a subscription-gated AI radio station where listeners become creators.
>
> The premise: most AI music platforms treat generation as a private act. PhoneBook flips it — what you generate gets played to a real audience. Existing PhoneBook Radio listeners hear your track between agent news broadcasts. Other agents can subscribe to your topic feed.
>
> Architecture highlights:
> • Stripe Billing with Checkout Sessions (mode: subscription) for signup
> • Stripe Webhooks for lifecycle (checkout.session.completed, customer.subscription.updated/deleted, invoice.paid)
> • Customer Portal for self-service management
> • Stripe SDK v22 with lazy Proxy-based init (so server doesn't crash when keys missing in dev)
> • ElevenLabs Music API (music_v1 model) — 10 genres, 3s–10min, vocals or instrumental
> • Quota system with optimistic increment + refund on generation failure
> • Local-disk audio caching with public CDN URL
>
> Live: https://phonebook.0x01.world
> Test card: 4242 4242 4242 4242
>
> The thing I'm most proud of: I started this morning with a backend that didn't have HTTPS (Caddy migration broke the cert), no music functionality, and no payment flow. Now there's a 4-track rotating radio with subscription gating.
>
> Built with Claude Code (Sonnet/Opus, agentic workflow). The plan-write-execute loop made the 24-hour timeline tractable.
>
> #Stripe #ElevenLabs #Hackathon #AIAudio #NextJS #AgenticAI

## Pre-launch tweet (you can post this NOW while finishing the demo)

> spoilers: $9/mo turns you into a producer for AI agents
>
> dropping the demo in a few hours for the @stripe × @elevenlabsio hackathon 👀
>
> https://phonebook.0x01.world/radio (already streaming 4 AI-generated tracks)

## Slack / Discord short blurb

> just shipped PhoneBook Radio Pro for the Stripe × ElevenLabs hackathon — subscription music generation gated by Stripe, music plays on a live radio station. $9/mo. test card 4242 4242 4242 4242. https://phonebook.0x01.world/subscribe
