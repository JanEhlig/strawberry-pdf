import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const push = args.includes('--push')
const target = args.find((a) => !a.startsWith('--')) ?? process.env.PUBLIC_REPO

if (!target) {
  console.error('Aufruf: npm run release:public -- <besitzer/repo> [--push]')
  process.exit(1)
}

const run = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

const { version, productName } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = `v${version}`
const title = `${productName} ${version}`
const remote = /^[\w.-]+\/[\w.-]+$/.test(target) ? `https://github.com/${target}.git` : target

if (run('git', ['status', '--porcelain'], root)) console.warn('Hinweis: Es gibt nicht committete Änderungen. Veröffentlicht wird der aktuelle Stand der Dateien.')

const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], root).split('\n').filter((f) => f && existsSync(join(root, f)))
const dir = mkdtempSync(join(tmpdir(), 'strawberry-public-'))
run('git', ['clone', '--quiet', remote, dir])

if (run('git', ['tag', '--list', tag], dir)) {
  console.error(`${tag} ist im öffentlichen Repo schon veröffentlicht. Erst die Version in package.json erhöhen.`)
  process.exit(1)
}

for (const entry of readdirSync(dir)) if (entry !== '.git') rmSync(join(dir, entry), { recursive: true, force: true })
for (const file of files) {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  copyFileSync(join(root, file), join(dir, file))
}

run('git', ['add', '--all'], dir)
if (!run('git', ['status', '--porcelain'], dir)) {
  console.log('Keine Änderungen gegenüber dem letzten Release.')
  process.exit(0)
}
run('git', ['commit', '--quiet', '-m', title], dir)
run('git', ['tag', tag], dir)

if (!push) {
  console.log(`Probelauf: ${files.length} Dateien als „${title}“ vorbereitet in ${dir}`)
  console.log('Nichts veröffentlicht. Zum Veröffentlichen mit --push aufrufen.')
  process.exit(0)
}

run('git', ['push', '--quiet', 'origin', 'HEAD:refs/heads/main', tag], dir)

const installer = join(root, 'release', `${productName.replace(/ /g, '-')}-Setup-${version}.exe`)
const notesFile = join(root, 'release-notes', `${version}.md`)
const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : title
let hasGh = true
try {
  run('gh', ['--version'], root)
} catch {
  hasGh = false
}
if (!hasGh) {
  console.log(`${tag} ist hochgeladen. Jetzt die Release-Seite anlegen:`)
  console.log(`  1. https://github.com/${target}/releases/new?tag=${tag} öffnen`)
  console.log(`  2. Titel: ${title}`)
  console.log(`  3. Beschreibung aus ${notesFile} einfügen`)
  console.log(`  4. ${installer} in das Feld für Dateien ziehen und „Publish release“ klicken`)
  process.exit(0)
}
run('gh', ['release', 'create', tag, '--repo', target, '--title', title, '--notes', notes, ...(existsSync(installer) ? [installer] : [])], root)
console.log(`${title} veröffentlicht.`)
