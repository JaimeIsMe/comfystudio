import assert from 'node:assert/strict'
import test from 'node:test'

import { extractVisualStyleNotes } from './musicVisualStyle.js'

// Issue #91: music/style metadata leaking into keyframe generation prompts.
// The reported vocabulary — rap, boom bap, vinyl scratches, BPM, male vocal,
// chorus — must never survive into an image prompt.

test('drops the exact vocabulary from issue #91', () => {
  assert.equal(
    extractVisualStyleNotes('rap, boom bap, vinyl scratches, 90 BPM, male vocal, chorus'),
    ''
  )
})

test('drops the auto-filled genre-tags line from a generated song', () => {
  // The LLM-brief fallback derives this from the audio asset's music tags.
  assert.equal(
    extractVisualStyleNotes('Song style / genre tags: Music epic cinematic orchestral, space documentary'),
    ''
  )
})

test('keeps purely visual style notes untouched', () => {
  const visual = 'Neon noir city at night, 35mm film grain, hard rim lighting, teal and orange grade.'
  assert.equal(extractVisualStyleNotes(visual), visual)
})

test('keeps the visual sentence and drops the music sentence', () => {
  assert.equal(
    extractVisualStyleNotes('Gritty 1990s documentary look, desaturated. Boom bap, 90 BPM, male vocal.'),
    'Gritty 1990s documentary look, desaturated.'
  )
})

test('segments split on newlines and semicolons too', () => {
  assert.equal(
    extractVisualStyleNotes('Handheld VHS camcorder look\n120 bpm trap beat; warm tungsten interiors'),
    'Handheld VHS camcorder look warm tungsten interiors'
  )
})

test('ambiguous visual words survive — deliberately not treated as music', () => {
  const looks = 'Smoky jazz club interior; brutalist metal staircase; country road at dusk; lo-fi grain.'
  assert.equal(extractVisualStyleNotes(looks), looks.replace(/;\s*/g, ' '))
})

test('"music video" as a look reference survives, bare "music" does not', () => {
  assert.equal(
    extractVisualStyleNotes('Shot like a 90s music video.'),
    'Shot like a 90s music video.'
  )
  assert.equal(extractVisualStyleNotes('Epic emotional music.'), '')
})

test('tolerates empty and junk input', () => {
  assert.equal(extractVisualStyleNotes(''), '')
  assert.equal(extractVisualStyleNotes(null), '')
  assert.equal(extractVisualStyleNotes(undefined), '')
  assert.equal(extractVisualStyleNotes('   '), '')
})
