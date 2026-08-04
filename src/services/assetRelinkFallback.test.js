import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMovedAssetPathCandidates,
  getProjectRelativeAssetPath,
  getRecordedAbsolutePath,
  isAbsoluteRecordedPath,
  resolveMovedAssetPath,
} from './assetRelinkFallback.js'

test('getProjectRelativeAssetPath creates portable paths across platforms', () => {
  assert.equal(
    getProjectRelativeAssetPath(
      '/Users/jaime/Projects/My Film/assets/video/shot.mp4',
      '/Users/jaime/Projects/My Film'
    ),
    'assets/video/shot.mp4'
  )
  assert.equal(
    getProjectRelativeAssetPath(
      'C:\\Projects\\My Film\\assets\\video\\shot.mp4',
      'c:\\projects\\my film'
    ),
    'assets/video/shot.mp4'
  )
  assert.equal(
    getProjectRelativeAssetPath('/Users/jaime/Other/shot.mp4', '/Users/jaime/Projects/My Film'),
    ''
  )
})

test('isAbsoluteRecordedPath recognizes windows, UNC, and posix roots', () => {
  assert.equal(isAbsoluteRecordedPath('C:\\Users\\old\\clip.mp4'), true)
  assert.equal(isAbsoluteRecordedPath('c:/Users/old/clip.mp4'), true)
  assert.equal(isAbsoluteRecordedPath('\\\\server\\share\\clip.mp4'), true)
  assert.equal(isAbsoluteRecordedPath('/Users/old/clip.mp4'), true)
  assert.equal(isAbsoluteRecordedPath('assets/videos/clip.mp4'), false)
  assert.equal(isAbsoluteRecordedPath('./assets/clip.mp4'), false)
  assert.equal(isAbsoluteRecordedPath('C:no-separator.mp4'), false)
  assert.equal(isAbsoluteRecordedPath(''), false)
  assert.equal(isAbsoluteRecordedPath(null), false)
})

test('getRecordedAbsolutePath prefers absolutePath and skips URLs and relative paths', () => {
  assert.equal(
    getRecordedAbsolutePath({ absolutePath: 'D:\\old\\assets\\a.mp4', path: 'E:\\other\\a.mp4' }),
    'D:\\old\\assets\\a.mp4'
  )
  assert.equal(
    getRecordedAbsolutePath({ path: '/Users/old/project/assets/a.mp4' }),
    '/Users/old/project/assets/a.mp4'
  )
  assert.equal(
    getRecordedAbsolutePath({ absolutePath: 'file:///D:/old/a.mp4', settings: { sourcePath: 'D:\\old\\a.mp4' } }),
    'D:\\old\\a.mp4'
  )
  assert.equal(getRecordedAbsolutePath({ path: 'assets/videos/a.mp4' }), '')
  assert.equal(getRecordedAbsolutePath({ url: 'https://example.com/a.mp4' }), '')
  assert.equal(getRecordedAbsolutePath({}), '')
})

test('windows-to-windows move maps the assets suffix under the new project root', () => {
  const candidates = buildMovedAssetPathCandidates(
    { absolutePath: 'D:\\Old Machine\\PROJECTS\\My Project\\assets\\videos\\shot-001.mp4' },
    'C:\\Users\\papa\\Desktop\\PROJECTS\\My Project'
  )
  assert.deepEqual(candidates, [
    'C:\\Users\\papa\\Desktop\\PROJECTS\\My Project\\assets\\videos\\shot-001.mp4',
  ])
})

test('mac-to-windows move joins with the project root separator style', () => {
  const candidates = buildMovedAssetPathCandidates(
    { absolutePath: '/Users/old/Movies/My Project/assets/videos/shot.mp4' },
    'C:\\Users\\papa\\Desktop\\My Project'
  )
  assert.deepEqual(candidates, [
    'C:\\Users\\papa\\Desktop\\My Project\\assets\\videos\\shot.mp4',
  ])
})

test('forward-slash project roots produce forward-slash candidates', () => {
  const candidates = buildMovedAssetPathCandidates(
    { absolutePath: 'D:\\old\\proj\\assets\\audio\\song.wav' },
    'C:/Users/papa/proj'
  )
  assert.deepEqual(candidates, ['C:/Users/papa/proj/assets/audio/song.wav'])
})

test('multiple assets segments try the longest suffix first', () => {
  const candidates = buildMovedAssetPathCandidates(
    { absolutePath: '/old/assets/packs/assets/clip.mp4' },
    'C:/proj'
  )
  assert.deepEqual(candidates, [
    'C:/proj/assets/packs/assets/clip.mp4',
    'C:/proj/assets/clip.mp4',
  ])
})

test('relative recorded paths resolve directly against the project root', () => {
  const candidates = buildMovedAssetPathCandidates(
    { path: 'assets/videos/clip.mp4' },
    'C:\\Users\\papa\\proj\\'
  )
  assert.deepEqual(candidates, ['C:\\Users\\papa\\proj\\assets\\videos\\clip.mp4'])
})

test('identical recorded paths collapse to one candidate', () => {
  const candidates = buildMovedAssetPathCandidates(
    {
      absolutePath: 'D:\\old\\proj\\assets\\clip.mp4',
      path: 'D:/old/proj/assets/clip.mp4',
      settings: { sourcePath: 'D:\\old\\proj\\assets\\clip.mp4' },
    },
    'C:\\new\\proj'
  )
  assert.deepEqual(candidates, ['C:\\new\\proj\\assets\\clip.mp4'])
})

test('candidates equal to a recorded path are skipped', () => {
  const candidates = buildMovedAssetPathCandidates(
    { absolutePath: 'C:\\proj\\assets\\clip.mp4' },
    'C:\\proj'
  )
  assert.deepEqual(candidates, [])
})

test('assets segment match is case-insensitive but casing is preserved', () => {
  const candidates = buildMovedAssetPathCandidates(
    { absolutePath: 'D:\\old\\proj\\Assets\\Videos\\Clip.MP4' },
    'C:\\new\\proj'
  )
  assert.deepEqual(candidates, ['C:\\new\\proj\\Assets\\Videos\\Clip.MP4'])
})

test('absolute paths without an assets segment yield no candidates', () => {
  const candidates = buildMovedAssetPathCandidates(
    { absolutePath: 'D:\\old\\footage\\clip.mp4' },
    'C:\\new\\proj'
  )
  assert.deepEqual(candidates, [])
})

test('missing project path yields no candidates', () => {
  assert.deepEqual(
    buildMovedAssetPathCandidates({ absolutePath: 'D:\\old\\assets\\clip.mp4' }, ''),
    []
  )
})

test('resolveMovedAssetPath returns null when the recorded path still exists', async () => {
  const checked = []
  const result = await resolveMovedAssetPath(
    { absolutePath: 'C:\\proj\\assets\\clip.mp4' },
    'C:\\proj',
    async (p) => {
      checked.push(p)
      return true
    }
  )
  assert.equal(result, null)
  assert.deepEqual(checked, ['C:\\proj\\assets\\clip.mp4'])
})

test('resolveMovedAssetPath finds the moved file under the new project root', async () => {
  const alive = new Set(['C:\\new\\proj\\assets\\videos\\shot.mp4'])
  const result = await resolveMovedAssetPath(
    { absolutePath: 'D:\\old\\proj\\assets\\videos\\shot.mp4' },
    'C:\\new\\proj',
    async (p) => alive.has(p)
  )
  assert.deepEqual(result, {
    fromPath: 'D:\\old\\proj\\assets\\videos\\shot.mp4',
    toPath: 'C:\\new\\proj\\assets\\videos\\shot.mp4',
  })
})

test('resolveMovedAssetPath returns null when nothing matches', async () => {
  const result = await resolveMovedAssetPath(
    { absolutePath: 'D:\\old\\proj\\assets\\videos\\shot.mp4' },
    'C:\\new\\proj',
    async () => false
  )
  assert.equal(result, null)
})

test('resolveMovedAssetPath ignores assets with only relative paths', async () => {
  let called = 0
  const result = await resolveMovedAssetPath(
    { path: 'assets/videos/shot.mp4' },
    'C:\\new\\proj',
    async () => {
      called += 1
      return false
    }
  )
  assert.equal(result, null)
  assert.equal(called, 0)
})

test('resolveMovedAssetPath tolerates a missing exists function', async () => {
  const result = await resolveMovedAssetPath(
    { absolutePath: 'D:\\old\\assets\\shot.mp4' },
    'C:\\new\\proj',
    null
  )
  assert.equal(result, null)
})
