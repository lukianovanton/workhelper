const fs = require('fs')
const path = require('path')

const native = [
  'node-sass',
  'sass',
  'node-gyp',
  'bcrypt',
  'sharp',
  'canvas',
  'sqlite3',
  'better-sqlite3',
  'grpc',
  '@grpc/grpc-js',
  'node-pty',
  'serialport',
  'sodium-native',
  'iohook',
  'robotjs',
  'keytar',
  'fibers',
  're2'
]

const projectsRoot = process.argv[2] || 'C:\\Projects'
const projects = process.argv.slice(3)

for (const proj of projects) {
  const root = path.join(projectsRoot, proj)
  console.log('─── ' + proj + ' ───')
  const pkgPath = path.join(root, 'package.json')
  let hasPkg = false
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8')
    const p = JSON.parse(raw)
    hasPkg = true
    const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) }
    const found = Object.keys(deps).filter((d) => native.includes(d))
    console.log('  package.json: yes')
    console.log('    engines.node:', p.engines?.node || '—')
    console.log('    scripts.start:', p.scripts?.start || '—')
    console.log('    scripts.dev:', p.scripts?.dev || '—')
    if (found.length) {
      console.log(
        '    NATIVE DEPS: ' +
          found.map((d) => `${d}@${deps[d]}`).join(', ')
      )
    }
    // dep count
    console.log(
      '    deps:',
      Object.keys(p.dependencies || {}).length,
      'devDeps:',
      Object.keys(p.devDependencies || {}).length
    )
  } catch {
    /* ignore */
  }
  if (!hasPkg) console.log('  package.json: no')

  // Csproj at root
  let csprojs = []
  try {
    csprojs = fs.readdirSync(root).filter((f) => f.endsWith('.csproj'))
  } catch {
    /* ignore */
  }
  // One level deeper if needed
  if (csprojs.length === 0) {
    try {
      for (const sub of fs.readdirSync(root, { withFileTypes: true })) {
        if (
          sub.isDirectory() &&
          !sub.name.startsWith('.') &&
          sub.name !== 'node_modules'
        ) {
          try {
            for (const f of fs.readdirSync(path.join(root, sub.name))) {
              if (f.endsWith('.csproj')) {
                csprojs.push(sub.name + '/' + f)
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (csprojs.length) {
    console.log('  csproj:', csprojs.join(', '))
    for (const c of csprojs.slice(0, 2)) {
      try {
        const text = fs.readFileSync(path.join(root, c), 'utf8')
        const tf = text.match(
          /<TargetFrameworks?>([^<]+)<\/TargetFrameworks?>/
        )
        if (tf) console.log('    [' + c + ']', tf[1])
      } catch {
        /* ignore */
      }
    }
  }

  try {
    const gj = fs.readFileSync(path.join(root, 'global.json'), 'utf8')
    console.log('  global.json:', gj.replace(/\s+/g, ' ').slice(0, 100))
  } catch {
    /* ignore */
  }
  try {
    const nv = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim()
    console.log('  .nvmrc:', nv)
  } catch {
    /* ignore */
  }
  try {
    fs.statSync(path.join(root, 'Dockerfile'))
    console.log('  Dockerfile: yes')
  } catch {
    /* ignore */
  }
  try {
    fs.statSync(path.join(root, 'docker-compose.yml'))
    console.log('  docker-compose: yes')
  } catch {
    /* ignore */
  }
  try {
    fs.statSync(path.join(root, 'package-lock.json'))
    console.log('  package-lock: yes')
  } catch {
    /* ignore */
  }
  try {
    fs.statSync(path.join(root, 'yarn.lock'))
    console.log('  yarn.lock: yes')
  } catch {
    /* ignore */
  }
  try {
    fs.statSync(path.join(root, 'pnpm-lock.yaml'))
    console.log('  pnpm-lock: yes')
  } catch {
    /* ignore */
  }
}
