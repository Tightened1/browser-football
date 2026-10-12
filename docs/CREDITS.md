# Credits

## Sound

There are **no audio files** in the game. Every sound is synthesised in the browser at run time with the Web Audio API
(`src/audio/sound.ts`), so nothing is downloaded and there is nothing third-party to license.

| Sound | How it is made | Source | Licence |
|---|---|---|---|
| Kick (soft to hard) | Falling sine "thump" plus a burst of low-pass filtered noise; hard kicks add a high-pass click | Generated in code | Original work, part of this project |
| Post / crossbar hit | Three decaying sine / triangle tones plus a short noise click | Generated in code | Original work, part of this project |
| Net thud | Low-pass and band-pass filtered noise burst | Generated in code | Original work, part of this project |
| Whistle (kickoff, half time, full time) | Two close sine tones with a fast amplitude wobble | Generated in code | Original work, part of this project |
| Crowd ambience | Looped white noise through a band-pass filter, with a slow swell that follows how close the ball is to a goal | Generated in code | Original work, part of this project |
| Goal roar | Swept band-pass noise plus three wavering sawtooth "voices" | Generated in code | Original work, part of this project |
| Settings volume blip | A short rising sine | Generated in code | Original work, part of this project |

## Graphics

All graphics (pitch stripes, goal nets, players, ball, particles, confetti) are drawn with code. No images are used.

## Libraries

- [Phaser 3](https://phaser.io/) (MIT)
- [PeerJS](https://peerjs.com/) (MIT)
