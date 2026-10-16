// T21: quick chat for one online session (host and guest share this): sends presets over the link with a rate limit,
// takes the other player's, and keeps the feed the HUD and the bubbles read. No free text, ever.
import { ChatFeed, EmoteLimiter, isEmoteId } from '../social';
import type { Link } from './peer';

export class QuickChat {
  readonly feed = new ChatFeed();
  /** Muted: the other player's messages are dropped (yours still show to you, and still go out). */
  muted = false;
  private readonly outgoing = new EmoteLimiter();
  private readonly incoming = new EmoteLimiter();

  constructor(private readonly me: 'host' | 'guest') {}

  /** Say message `id`: shown at once on this side and sent. False if it's not a message or you're sending too fast. */
  send(id: number, link: Link | null, now: number = performance.now()): boolean {
    if (!isEmoteId(id) || !link?.isOpen || !this.outgoing.allow(now)) return false;
    this.feed.push(this.me, id, now);
    link.send({ t: 'emote', id });
    return true;
  }

  /** The other player said `id` (already validated by the protocol): shown unless muted or sent too fast. */
  receive(id: number, now: number = performance.now()): void {
    if (!isEmoteId(id) || this.muted || !this.incoming.allow(now)) return;
    this.feed.push(this.me === 'host' ? 'guest' : 'host', id, now);
  }
}
