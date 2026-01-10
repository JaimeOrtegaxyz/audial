setcpm(88)

// floating in a warm, dark ocean - weightless but aware of depth
// primary voice - the surface tension
$: note("d3 f3 a3 c4 d4").slow(8)
  .struct("1 0 1 0 0 1 0 1")
  .s("triangle")
  .lpf(perlin.range(600, 1200).slow(12))
  .lpq(8)
  .decay(1.2)
  .sustain(0.8)
  .detune(-0.02)
  .delay(0.375)
  .delayfeedback(0.35)
  .room(0.9)
  .size(10)
  .pan(0.3)
  .gain(0.6)

// secondary voice - the undertow
$: note("a2 d3 g3").slow(6)
  .s("sawtooth")
  .lpf(400)
  .crush(5)
  .shape(0.1)
  .room(0.85)
  .pan(0.7)
  .gain(0.5)

// tertiary voice - distant echoes
$: note("f4 a4 c5 a4").slow(10)
  .struct("1 0 0 1 0 0 0 1")
  .s("sine")
  .delay(0.5)
  .delayfeedback(0.4)
  .room(0.95)
  .gain(0.3)

// pulse - heartbeat in the deep
$: s("bd ~ ~ bd ~ ~ ~ ~")
  .slow(2)
  .lpf(200)
  .shape(0.4)
  .gain(1.0)

// texture - sand shifting
$: s("hh")
  .struct("1 0 1 0 0 0 1 0")
  .lpf(perlin.range(300, 600).slow(16))
  .room(0.7)
  .pan(perlin.range(0.4, 0.6).slow(14))
  .gain(0.15)