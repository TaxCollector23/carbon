# Carbon, explained like you're 2

## The toy

Imagine you're building a toy car. To make it go, the car needs to talk to a **big toy factory** far away and ask for parts: "please give me a red wheel!" The factory sends the wheel and the car works.

The problem: the factory is slow, sometimes closed, and sometimes gives you a blue wheel by mistake. That makes practicing really hard.

## What Carbon does

Carbon builds you a **pretend toy factory** that sits right next to you. You show it a picture of what the real factory does (that's a "spec"), and Carbon builds a fake factory that acts *almost exactly like the real one*.

The pretend factory has a big brain:

- If you ask it to make a red wheel, it makes one and **remembers** it.
- If you later ask "hey, what wheels do I have?" — it says "one red wheel!" instead of nothing.
- It's not just a fake that repeats the same answer over and over. It really keeps track, like a real factory would.

## The magic buttons

Carbon has some magic buttons your toy car can use:

- **Save button (snapshot)** → freeze the pretend factory in time. Now you can practice from the exact same starting point every time. No surprises.
- **Rewind button (state journal)** → undo the last thing you did. Like a time machine.
- **Grumpy button (chaos preset)** → make the pretend factory be mean on purpose (be slow, say "no", pretend the internet is broken). Now you can practice what to do when things go wrong.
- **Cheat sheet button (AI ingest)** → paste any factory's picture in. Carbon guesses what the factory does and builds a fake one automatically.
- **Report card button (AI judge)** → a second, stricter helper checks the guess and tells you: "hey, this guess looks 90% right" or "this guess is wrong, don't trust it."

## Why grown-ups pay for it

Developers (people who build the toy car) pay Carbon because:

1. They can build and test their car **without the real factory being open**.
2. Every test starts in the **exact same place**, so bugs are easier to find.
3. Their tests **run 100 times faster** because they don't wait for the real factory over the internet.
4. They don't burn money on real factory usage during testing.

## How you actually use it (3 steps)

### 1. Install
```bash
npm install -g carbon-dev
```
That gives you a program called `carbon` on your computer.

### 2. Show it a picture of a factory
Grab any OpenAPI spec (a JSON file that describes an API — like the toy factory's blueprint). Let's use a pet store one that ships with Carbon:

```bash
carbon emulate --from ./petstore.openapi.json --port 5555
```

Now there's a **pretend pet store** running at `http://localhost:5555`.

### 3. Play with it

Make a pet:
```bash
curl -X POST http://localhost:5555/pets \
  -H 'content-type: application/json' \
  -d '{"name":"Fido","tag":"dog"}'
```
→ `{"name":"Fido","tag":"dog","id":"pet_ywt7pt27ahlpamduegbq"}`

Make another pet:
```bash
curl -X POST http://localhost:5555/pets \
  -H 'content-type: application/json' \
  -d '{"name":"Whiskers","tag":"cat"}'
```

Ask for the list:
```bash
curl http://localhost:5555/pets
```
→ `{"data":[{"id":"...","name":"Fido","tag":"dog"},{"id":"...","name":"Whiskers","tag":"cat"}]}`

**It remembered both pets.** That's the magic. It didn't return an empty list or a canned "example" pet — it returned the real pets you just made. Without a real pet store existing anywhere.

### Bonus — the time machine

Ask Carbon what mutations happened:
```bash
curl http://localhost:5555/__carbon/state/history
```
→ `{"entries":[{seq:1,op:"create",resource:"pet",...},{seq:2,op:"create",resource:"pet",...}]}`

Rewind to before Whiskers existed:
```bash
curl -X POST http://localhost:5555/__carbon/state/rewind \
  -H 'content-type: application/json' \
  -d '{"seq":1}'
```

Now:
```bash
curl http://localhost:5555/pets
```
→ Only Fido. Whiskers is gone. You just undid the past.

## The whole product in one sentence

> Carbon takes a picture of any API and builds you a pretend version of it that behaves like the real thing, so you can build and test your code fast, offline, and repeatably.

## Where each piece lives

- **`carbon` (CLI)** — the tool you run on your laptop. `init`, `ingest`, `emulate`, `snapshot`, `record`, `replay`, `doctor`, `quality`, `usage`, `activity`, `export`, `login`, `whoami`.
- **`@carbon/sdk`** — same thing but as a library your Node code can `import` and use in vitest / jest tests.
- **`apps/api`** — the cloud control plane. Stores your projects, snapshots, audit trail, AI quality reports, usage metering, org members, API keys, Stripe billing state.
- **`apps/dashboard`** — the web UI at localhost:3001 where a team looks at all of that.
- **`apps/web`** — the marketing site at localhost:1223.
- **`apps/workers`** — background jobs (ingest workers, retention purge, anomaly summarizer, drift detection).
- **`packages/parser`** — reads OpenAPI, AsyncAPI, GraphQL, protobuf, HAR, Postman, gRPC.
- **`packages/graph`** — turns parsed specs into a "behavior graph" (nodes = resources, edges = relationships).
- **`packages/runtime`** — the actual pretend-factory engine that responds to your HTTP calls.
- **`packages/state`** — the memory (snapshots, journal, fixtures, diff).
- **`packages/ai`** — infers resources and relationships from specs, judges its own guesses.

## Real proof it works (from this session)

Booted against real Postgres 16, running today:

```
STEP 1: INGEST an OpenAPI spec
→ irId: ir_xyjoy6mf7tgmvejfajda
→ graphId: grf_5dglr32onfsknq6czpba
→ endpoints: 5, resources: 1

STEP 2: Emulator, hit it, verify state
→ POST /pets creates Fido (real id minted)
→ POST /pets creates Whiskers (real id minted)
→ GET /pets returns both (real state persisted, not canned)

STEP 3: Journal has 2 mutations, both create ops
→ REWIND to seq=1 removes Whiskers
→ GET /pets now returns only Fido
```

That's Carbon.
