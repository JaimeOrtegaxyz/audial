# strings-and-rocks
created: 2026-01-10T04:21:16.761Z
prompt: Make the strings be a bit slower and make the chord progression longer, make the rocks be more sparse, make it all a bit slower in general. Adapt everything else u deem needs adapting.

```strudel
setcpm(85)

// Primary ascending melody - pure joy, slower and more sustained
$: note("g4 a4 c5 d5 g5 a5 c6 d6").slow(3)
  .s("sawtooth")
  .lpf(1200)
  .attack(0.2)
  .release(1.2)
  .room(0.7)
  .pan(0.4)
  .gain(0.8)

// Secondary harmony - warm support with extended progression
$: note("c4 d4 e4 g4 a4 c5 d5").slow(4)
  .s("triangle")
  .lpf(800)
  .attack(0.3)
  .release(1.4)
  .room(0.8)
  .pan(0.6)
  .gain(0.6)

// Tertiary voice - dancing counterpoint, slower flow
$: note("e4 f4 g4 a4 b4 c5 d5 e5").slow(3.5)
  .s("sine")
  .attack(0.1)
  .release(0.9)
  .room(0.6)
  .pan(0.2)
  .gain(0.5)

// Rocks falling - much more sparse and irregular
$: s("perc ~ ~ ~ ~ rim ~ ~ ~ ~ ~ perc ~ ~ ~")
  .slow(8)
  .gain(0.6)
  .room(3.5)
  .pan(0.7)

// Deeper rocks - very sparse bass percussion
$: s("~ ~ rim ~ rim ~ ~ ~ ~ perc ~ ~ ~ ~ rim ~")
  .slow(10)
  .lpf(400)
  .gain(0.7)
  .room(5.4)
  .pan(0.3)
```
