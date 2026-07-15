'use strict'

/**
 * Cross-platform asset build (Windows / macOS / Linux).
 *
 * Replaces shell-only npm scripts that used mkdir -p, cp -R, rm -rf,
 * bash conditionals, and NODE_ENV=... prefixes.
 *
 * Usage:
 *   node scripts/build-assets.js           # full production build
 *   node scripts/build-assets.js sass
 *   node scripts/build-assets.js minify-css
 *   node scripts/build-assets.js minify-js
 *   node scripts/build-assets.js copy-static
 *   node scripts/build-assets.js sync-to-public
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')

function resolveBin(name) {
  const ext = process.platform === 'win32' ? '.cmd' : ''
  const local = path.join(root, 'node_modules', '.bin', name + ext)
  if (fs.existsSync(local)) return local
  return name + ext
}

function run(binName, args, opts = {}) {
  const bin = resolveBin(binName)
  const result = spawnSync(bin, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status == null ? 1 : result.status)
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
}

function copyDirContents(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return
  ensureDir(destDir)
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name)
    const to = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyDirContents(from, to)
    } else if (entry.isFile()) {
      copyFile(from, to)
    }
  }
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) {
    ensureDir(dir)
    return
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    fs.rmSync(full, { recursive: true, force: true })
  }
}

function compileSass() {
  ensureDir(path.join(root, 'build', 'css'))
  run('sass', [
    path.join('scss', 'main.scss'),
    path.join('build', 'css', 'style.css')
  ])
}

function minifyCss() {
  ensureDir(path.join(root, 'build', 'css'))
  run('cleancss', [
    '-o',
    path.join('build', 'css', 'style.min.css'),
    path.join('build', 'css', 'style.css')
  ])
}

function minifyJs() {
  ensureDir(path.join(root, 'build', 'js'))
  const src = path.join(root, 'public', 'js', 'global.js')
  const dest = path.join(root, 'build', 'js', 'global.min.js')

  let hasContent = false
  try {
    const stats = fs.statSync(src)
    hasContent = stats.isFile() && stats.size > 0
  } catch (_err) {
    hasContent = false
  }

  if (hasContent) {
    run('terser', [src, '-c', '-m', '-o', dest])
  } else {
    fs.writeFileSync(dest, '// This file is intentionally left empty\n', 'utf8')
  }
}

function copyStatic() {
  const build = path.join(root, 'build')
  ensureDir(path.join(build, 'img'))
  ensureDir(path.join(build, 'fonts'))
  ensureDir(path.join(build, 'css'))
  ensureDir(path.join(build, 'js'))

  copyDirContents(path.join(root, 'public', 'img'), path.join(build, 'img'))
  copyDirContents(path.join(root, 'public', 'fonts'), path.join(build, 'fonts'))

  const cssDir = path.join(root, 'public', 'css')
  if (fs.existsSync(cssDir)) {
    for (const name of fs.readdirSync(cssDir)) {
      if (!name.endsWith('.css')) continue
      copyFile(path.join(cssDir, name), path.join(build, 'css', name))
    }
  }

  const jsDir = path.join(root, 'public', 'js')
  if (fs.existsSync(jsDir)) {
    for (const name of fs.readdirSync(jsDir)) {
      if (!name.endsWith('.js')) continue
      copyFile(path.join(jsDir, name), path.join(build, 'js', name))
    }
  }
}

function syncToPublic() {
  const build = path.join(root, 'build')
  const pub = path.join(root, 'public')
  if (!fs.existsSync(build)) {
    throw new Error('build/ does not exist; run earlier build steps first')
  }
  emptyDir(pub)
  copyDirContents(build, pub)
  fs.rmSync(build, { recursive: true, force: true })
}

function fullBuild() {
  process.env.NODE_ENV = 'production'
  // Copy vendor/static assets first, then overwrite generated CSS/JS so
  // stale public/*.min.* files do not clobber freshly built outputs.
  copyStatic()
  compileSass()
  minifyCss()
  minifyJs()
  syncToPublic()
}

const step = process.argv[2] || 'all'

const steps = {
  all: fullBuild,
  sass: compileSass,
  'minify-css': minifyCss,
  'minify-js': minifyJs,
  'copy-static': copyStatic,
  'sync-to-public': syncToPublic
}

const fn = steps[step]
if (!fn) {
  console.error(
    `Unknown build step "${step}". Use one of: ${Object.keys(steps).join(', ')}`
  )
  process.exit(1)
}

fn()
