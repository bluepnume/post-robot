# post-robot

Cross-window messaging over `postMessage`: send a request to another window, iframe or popup and get a response; hand functions, promises and windows across and keep using them from the other side.

```sh
npm install post-robot
```

```ts
import { on, send } from 'post-robot';

// In the child
on('getUser', ({ data }) => fetchUser(data.id));

// In the parent
const { data: user } = await send(childFrame, 'getUser', { id: '123' });
```

ES modules, TypeScript types included, ES2019 syntax. For current browsers (Chrome, Firefox, Safari, Edge from 2024 on): the floor is the four APIs sandestin needs, `FinalizationRegistry`, `WeakRef`, `AbortSignal.any` and `crypto.randomUUID`, and post-robot adds nothing above it. A `dist/post-robot.min.js` bundle is included for pages that load it with a script tag, as `window.postRobot`.

## Sending and receiving

`send(window, name, data?, options?)` posts a request and resolves with `{ source, origin, data }` once the other side's handler has run. Before the first message to a window post-robot waits for it to say hello (every window running post-robot does, to its opener or parent), so a request is never fired into a frame that has not loaded yet. Every request is acknowledged on arrival and answered when its handler settles; no acknowledgement within two seconds (ten for a window already heard from) rejects with "no ack", a closed window rejects at once, and `options.timeout` bounds the wait for the response itself.

| Option | Does |
| --- | --- |
| `domain` | The origin the window must be at: a string, a RegExp, a list of either, or `*` (the default). A string is also what the message is posted to |
| `timeout` | Milliseconds to wait for the response; `-1`, the default, waits forever |
| `fireAndForget` | Post it and resolve immediately; no acknowledgement, no response |

`on(name, options?, handler)` registers the handler for a request name and returns `{ cancel }`. The handler gets `{ source, origin, data }` and whatever it returns, or resolves with, is the response; a throw or rejection is the error the sender's promise rejects with. Registering the same name twice for the same window and domain throws.

| Option | Does |
| --- | --- |
| `window` | Only accept the request from this window, or from any of these |
| `domain` | Only accept it from an origin matching this |
| `errorHandler` | Where a handler's error goes, instead of being rethrown |

`once(name, options?, handler?)` is `on` for a single request: it resolves with the event and stops listening, and has `.cancel()`.

## What crosses

Data crosses by value, through [sandestin](https://github.com/bluepnume/sandestin): objects, arrays, strings, numbers, booleans, `null`, `undefined`, dates, regular expressions, cycles, and errors with their name, message, code and stack. Anything else (a `Map`, a class instance) is passed through as plain data. Three things cross by reference:

- **Functions.** The other side gets a function that calls the original where it lives and resolves with its result. It has `.fireAndForget(...)` for a call that needs no reply. Inside the original, `this.source` and `this.origin` are the calling window and its origin. A function handed back to the window it came from is the original again, called directly.
- **Promises.** Native promises and [ZalgoPromises](https://github.com/bluepnume/zalgo-promise) both cross; the other side gets a promise that settles when the original does.
- **Windows.** A window crosses as a `ProxyWindow`: an object with `close`, `focus`, `isClosed`, `getType`, `setLocation`, `getName`, `setName` and `getInstanceID` that act on the real window where it lives, and that becomes the real window again when it turns out to be reachable from the receiving side. That is what lets a parent describe windows to a child before the child exists.

Every function and promise handed out is bound to the origin it was sent to; a call for it from a window that has since navigated elsewhere is refused.

Promises returned by `send`, `once` and the functions above are `ZalgoPromise`s: they settle synchronously when they can, which keeps a chain inside a user gesture and avoids microtask lag in a background window. `await` works on them.

## The rest of the API

| Export | Does |
| --- | --- |
| `setup()` | Start listening and say hello to the opener or parent. `on` and `send` run it; call it in a window that only needs to be reachable |
| `destroy()` | Stop listening and drop every pending request |
| `cleanUpWindow(win)` | Fail every request still waiting on a window that is going away |
| `markWindowKnown(win)` | Treat a window as one that will acknowledge, before it has sent anything |
| `awaitWindowHello(win, timeout?, name?)` | Resolves with `{ domain }` once the window has said hello |
| `serializeMessage(win, domain, value)` / `deserializeMessage(win, origin, text)` | Encode a value for a window the way a message would, to carry it another way (in a url, say) |
| `createProxyWindow(win?)` / `toProxyWindow(win)` | Make, or look up, the `ProxyWindow` for a window |
| `ZalgoPromise`, `ProxyWindow`, `GLOBAL_KEY`, `MAJOR_VERSION`, `MESSAGE_NAME`, `WILDCARD` | The pieces above, and the constants |

## Two copies on one page

All of post-robot's state hangs off one window property keyed by major version, `window.__post_robot_12__`, and every message is tagged with that key. Two copies of the same major on one page share one listener, one set of handlers and one hello table, so a page with two libraries built on post-robot does not double-handle or drop messages. Two copies of different majors ignore each other's messages.

## Changes in 12

Published as `post-robot` again (8 to 11 lived under `@krakenjs`). ES modules and TypeScript only. The serialization layer is sandestin. Gone, because no supported browser needs them: the Internet Explorer popup bridge (`bridge.*`, `openBridge`, `linkWindow`, `linkUrl`), the global-messaging fallback for IE11 and legacy Edge, the user-agent sniffing, the `.ie.js` builds and the `__POST_ROBOT__` build flags, the `mock://` domain test hooks, and the CommonJS entry point. Dependencies: `zalgo-promise` 3, `cross-domain-utils` 4 and `sandestin`; `belter`, `cross-domain-safe-weakmap` and `universal-serialize` are no longer used. Importing post-robot has no side effects: listeners start on the first `on` or `send`, or on `setup()`. The global key is now the major version rather than the exact version, so patch and minor releases on one page share a channel.

## License

Apache-2.0
