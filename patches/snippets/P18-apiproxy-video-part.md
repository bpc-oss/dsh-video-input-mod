# P18 — apiproxy schema gate (manual snippet)

> **No pristine baseline retained** for `dsh-host-apiproxy/lib/index.js`, so this
> patch ships as a manual snippet instead of a unified diff. The change is small
> and anchored by unique zod literals.

## Target

`<install-root>/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`

## What to add

Find the `promptContentPartSchema` discriminated union (search for
`promptContentPartSchema = z$1.discriminatedUnion`). It lists `text`, `image`
(and after this patch, `video`). Add a third arm:

```js
z$1.object({
    type: z$1.literal("video"),
    mediaType: z$1.string(),
    url: z$1.string(),
    name: z$1.string().optional()
})
```

placed immediately after the `image` arm inside the union array. Nothing else
in the file changes — the session service, history projection, and durable
content blocks already treat unknown-ish content blocks as merge-extensible
(`contentBlockSchema` is a loose object keyed on `type`).

## Why it exists

`session.prompt` validates its `content` parts against this schema. Without the
`video` arm, any UI-attached or tool-produced video block is rejected at the
proxy boundary (bad-request) before it ever reaches the session log.

## Verification

Send a `session.prompt` whose `content` includes
`{type:"video", mediaType:"video/mp4", url:"data:video/mp4;base64,...", name:"x.mp4"}`
— the RPC must answer `{accepted: true}` and the session log must contain a
`user/message` event whose content carries the `video` block verbatim.
