import test from 'node:test'
import assert from 'node:assert/strict'
import buildPremiereXml, { filePathToPremiereUri } from './premiereXmlExporter.js'

function countOccurrences(value, pattern) {
  return (String(value).match(pattern) || []).length
}

test('builds a Premiere-compatible XMEML v5 sequence with tracks, trims, and audio', () => {
  const xml = buildPremiereXml({
    projectName: 'Project & One',
    timelineName: 'Main <Edit>',
    timelineSettings: { width: 1920, height: 1080, fps: 24 },
    timeline: {
      duration: 3.5,
      tracks: [
        { id: 'video-top', type: 'video', name: 'V2' },
        { id: 'video-bottom', type: 'video', name: 'V1' },
        { id: 'audio-main', type: 'audio', name: 'A1' },
        { id: 'audio-muted', type: 'audio', name: 'Muted', muted: true },
      ],
      clips: [
        {
          id: 'video-clip',
          trackId: 'video-bottom',
          assetId: 'video-asset',
          type: 'video',
          name: 'Video & Clip',
          startTime: 1,
          duration: 2.5,
          sourceDuration: 10,
          trimStart: 3,
          sourceFps: 24,
        },
        {
          id: 'image-clip',
          trackId: 'video-top',
          assetId: 'image-asset',
          type: 'image',
          name: 'Still',
          startTime: 0,
          duration: 1,
        },
        {
          id: 'audio-clip',
          trackId: 'audio-main',
          assetId: 'audio-asset',
          type: 'audio',
          name: 'Song',
          startTime: 0,
          duration: 3.5,
          sourceDuration: 8,
          trimStart: 1,
        },
        {
          id: 'muted-audio',
          trackId: 'audio-muted',
          assetId: 'muted-asset',
          type: 'audio',
          name: 'Do not export',
          startTime: 0,
          duration: 3,
        },
      ],
    },
    assets: [
      {
        id: 'video-asset',
        name: 'source.mp4',
        type: 'video',
        absolutePath: 'C:\\Media Files\\source #1.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        fps: 24,
      },
      {
        id: 'image-asset',
        name: 'still.png',
        type: 'image',
        absolutePath: '/Volumes/Media/still.png',
        width: 2048,
        height: 1152,
      },
      {
        id: 'audio-asset',
        name: 'song.wav',
        type: 'audio',
        absolutePath: '/Volumes/Audio/song.wav',
        duration: 8,
        channels: 2,
        sampleRate: 48000,
      },
      {
        id: 'muted-asset',
        name: 'muted.wav',
        type: 'audio',
        absolutePath: '/Volumes/Audio/muted.wav',
        duration: 3,
      },
    ],
  })

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(xml, /<!DOCTYPE xmeml>/)
  assert.match(xml, /<xmeml version="5">/)
  assert.match(xml, /<name>Main &lt;Edit&gt;<\/name>/)
  assert.match(xml, /<description>Exported from Velorn project: Project &amp; One<\/description>/)
  assert.match(xml, /<duration>84<\/duration>/)
  assert.match(xml, /<timebase>24<\/timebase>\s+<ntsc>FALSE<\/ntsc>/)
  assert.match(xml, /<width>1920<\/width>\s+<height>1080<\/height>/)

  assert.match(
    xml,
    /<clipitem id="clipitem-video-clip">[\s\S]*?<duration>60<\/duration>[\s\S]*?<start>24<\/start>[\s\S]*?<end>84<\/end>[\s\S]*?<in>72<\/in>[\s\S]*?<out>132<\/out>/
  )
  assert.match(xml, /<clipitem id="clipitem-image-clip">[\s\S]*?<stillframe>TRUE<\/stillframe>/)
  assert.match(xml, /<clipitem id="clipitem-audio-clip">[\s\S]*?<sourcetrack>[\s\S]*?<mediatype>audio<\/mediatype>/)
  assert.doesNotMatch(xml, /Do not export/)
  assert.match(xml, /file:\/\/localhost\/C:\/Media%20Files\/source%20%231\.mp4/)

  const bottomTrackIndex = xml.indexOf('<clipitem id="clipitem-video-clip">')
  const topTrackIndex = xml.indexOf('<clipitem id="clipitem-image-clip">')
  assert.ok(bottomTrackIndex >= 0 && topTrackIndex > bottomTrackIndex)
})

test('writes NTSC rates and reuses file references for repeated assets', () => {
  const xml = buildPremiereXml({
    timelineSettings: { width: 1280, height: 720, fps: 23.976 },
    timeline: {
      duration: 4,
      tracks: [{ id: 'v1', type: 'video' }],
      clips: [
        {
          id: 'clip-a',
          trackId: 'v1',
          assetId: 'shared',
          type: 'video',
          startTime: 0,
          duration: 2,
          sourceDuration: 10,
          trimStart: 0,
          sourceFps: 23.976,
        },
        {
          id: 'clip-b',
          trackId: 'v1',
          assetId: 'shared',
          type: 'video',
          startTime: 2,
          duration: 2,
          sourceDuration: 10,
          trimStart: 2,
          sourceFps: 23.976,
        },
      ],
    },
    assets: [{
      id: 'shared',
      name: 'shared.mov',
      type: 'video',
      absolutePath: '/Volumes/Media/shared.mov',
      duration: 10,
      width: 1280,
      height: 720,
      fps: 23.976,
    }],
  })

  assert.match(xml, /<timebase>24<\/timebase>\s+<ntsc>TRUE<\/ntsc>/)
  assert.equal(countOccurrences(xml, /<file id="file-1-shared">/g), 1)
  assert.equal(countOccurrences(xml, /<file id="file-1-shared"\/>/g), 1)
  assert.equal(countOccurrences(xml, /<clipitem /g), 2)
})

test('encodes Windows, macOS, and UNC paths as local file URLs', () => {
  assert.equal(
    filePathToPremiereUri('C:\\Users\\Editor\\My Clip.mov'),
    'file://localhost/C:/Users/Editor/My%20Clip.mov'
  )
  assert.equal(
    filePathToPremiereUri('/Volumes/Media/My Clip.mov'),
    'file://localhost/Volumes/Media/My%20Clip.mov'
  )
  assert.equal(
    filePathToPremiereUri('\\\\server\\share\\My Clip.mov'),
    'file://server/share/My%20Clip.mov'
  )
})

test('exports only the audible audio track when another track is soloed', () => {
  const xml = buildPremiereXml({
    timelineSettings: { width: 1920, height: 1080, fps: 30 },
    timeline: {
      duration: 2,
      tracks: [
        { id: 'a1', type: 'audio', name: 'Music' },
        { id: 'a2', type: 'audio', name: 'Dialogue', solo: true },
      ],
      clips: [
        {
          id: 'music',
          trackId: 'a1',
          assetId: 'music-asset',
          type: 'audio',
          name: 'Muted by solo',
          startTime: 0,
          duration: 2,
        },
        {
          id: 'dialogue',
          trackId: 'a2',
          assetId: 'dialogue-asset',
          type: 'audio',
          name: 'Audible dialogue',
          startTime: 0,
          duration: 2,
        },
      ],
    },
    assets: [
      {
        id: 'music-asset',
        type: 'audio',
        absolutePath: 'C:\\Media\\music.wav',
        duration: 2,
      },
      {
        id: 'dialogue-asset',
        type: 'audio',
        absolutePath: 'C:\\Media\\dialogue.wav',
        duration: 2,
      },
    ],
  })

  assert.doesNotMatch(xml, /Muted by solo/)
  assert.match(xml, /Audible dialogue/)
  assert.equal(countOccurrences(xml, /<clipitem /g), 1)
})
