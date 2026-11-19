// Разбирает XML, полученный из PDF дорожной полиции командой
//   pdftohtml -xml <N>.pdf out        (poppler-utils; запускать в отдельной папке для каждого N)
// и печатает в stdout JSON со всеми вопросами групп 1..10.
//
// Использование: node scripts/pdf-xml-to-questions.js <папка с подпапками 1..10, в каждой out.xml> > parsed.json
//
// Каждый вопрос: { gid, num, q, answers: [...], correct, image: 'out-<page>_<n>.jpg' | null }
// Скрипт падает с ошибкой, если структура PDF не сходится (нумерация, количество
// вопросов из заголовка, выделенный жирным ответ != «Ответ: N», картинка не на своём месте).

const fs = require('fs')
const path = require('path')

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node pdf-xml-to-questions.js <xml-dir>')
  process.exit(1)
}

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&')
    .replace(/ /g, ' ')

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1] : undefined
}

const problems = []
const all = []

for (let gid = 1; gid <= 10; gid++) {
  const xml = fs.readFileSync(path.join(dir, String(gid), 'out.xml'), 'utf-8')
  const fonts = {}
  const items = []
  let page = 0
  let declared = null

  for (const line of xml.split('\n')) {
    if (line.startsWith('<page ')) page = +attr(line, 'number')
    else if (line.includes('<fontspec ')) {
      fonts[attr(line, 'id')] = { size: +attr(line, 'size'), color: attr(line, 'color') }
    } else if (line.startsWith('<image ')) {
      items.push({ kind: 'image', page, top: +attr(line, 'top'), height: +attr(line, 'height'), src: attr(line, 'src') })
    } else if (line.startsWith('<text ')) {
      const m = line.match(/^<text ([^>]*)>(.*)<\/text>$/)
      if (!m) throw new Error(`gid ${gid}: unparsable text line: ${line}`)
      const font = fonts[attr(m[1], 'font')]
      const text = decode(m[2])
      const top = +attr(m[1], 'top')
      const left = +attr(m[1], 'left')
      const cm = text.match(/^(\d+) вопрос/)
      if (font.color === '#ffffff' && cm) declared = +cm[1]
      let kind = null
      if (font.size === 16 && font.color === '#0e5ca7') kind = 'qnum'
      else if (font.size === 16 && font.color === '#1a1a1a') kind = 'qtext'
      else if (font.size === 15) kind = 'answer'
      else if (font.size === 14 && font.color === '#0a6a3a') kind = 'key'
      if (!kind) continue // шапка, колонтитулы
      items.push({ kind, page, top, left, text, green: font.color === '#0a6a3a' })
    }
  }

  items.sort((a, b) => a.page - b.page || a.top - b.top || (a.left || 0) - (b.left || 0))

  const questions = []
  let q = null
  let last = null // последний текстовый элемент (для склейки строк)
  const where = () => `gid ${gid} q ${q ? q.num : '?'}`
  // элементы одной строки склеиваем как есть, разные строки — через пробел
  const join = (prev, it) => (prev === '' ? it.text : prev + (last && last.page === it.page && last.top === it.top ? '' : ' ') + it.text)

  for (const it of items) {
    if (it.kind === 'qnum') {
      const num = +it.text.replace('.', '')
      q = { gid: String(gid), num, q: '', answers: [], correct: null, bold: [], image: null, page: it.page }
      questions.push(q)
      last = null
      continue
    }
    if (!q) throw new Error(`gid ${gid}: content before first question: ${JSON.stringify(it)}`)

    if (it.kind === 'image') {
      if (q.image) problems.push(`${where()}: more than one image`)
      if (q.answers.length || q.correct !== null) problems.push(`${where()}: image after answers`)
      if (it.page !== q.page) problems.push(`${where()}: image on another page`)
      q.image = it.src
      continue
    }
    if (it.page !== q.page) problems.push(`${where()}: question spans pages`)

    if (it.kind === 'qtext') {
      if (q.answers.length) problems.push(`${where()}: question text after answers`)
      q.q = join(q.q, it)
    } else if (it.kind === 'key') {
      const m = it.text.match(/^Ответ: (\d+)$/)
      if (!m) problems.push(`${where()}: bad key "${it.text}"`)
      else q.correct = +m[1]
    } else if (it.kind === 'answer') {
      const m = it.left < 120 && it.text.match(/^(\d+)\.(?:\s+(.*))?$/)
      if (m) {
        if (+m[1] !== q.answers.length + 1) problems.push(`${where()}: answer numbering ${it.text}`)
        q.answers.push(m[2] || '')
        if (it.green) q.bold.push(q.answers.length)
      } else {
        if (!q.answers.length || it.left < 120) problems.push(`${where()}: stray answer text "${it.text}"`)
        else q.answers[q.answers.length - 1] = join(q.answers[q.answers.length - 1], it)
      }
    }
    last = it
  }

  if (declared !== questions.length) problems.push(`gid ${gid}: header says ${declared}, parsed ${questions.length}`)
  questions.forEach((x, i) => {
    const w = `gid ${gid} q ${x.num}`
    if (x.num !== i + 1) problems.push(`${w}: expected number ${i + 1}`)
    x.q = x.q.replace(/\s+/g, ' ').trim()
    x.answers = x.answers.map((a) => a.replace(/\s+/g, ' ').trim())
    if (!x.q) problems.push(`${w}: empty question`)
    if (x.answers.length < 2 || x.answers.length > 6) problems.push(`${w}: ${x.answers.length} answers`)
    if (x.answers.some((a) => !a)) problems.push(`${w}: empty answer`)
    if (!x.correct || x.correct > x.answers.length) problems.push(`${w}: bad correct ${x.correct}`)
    if (x.bold.length !== 1 || x.bold[0] !== x.correct) problems.push(`${w}: bold ${x.bold} vs key ${x.correct}`)
    delete x.bold
    delete x.page
  })
  all.push(...questions)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}

process.stdout.write(JSON.stringify(all, null, 1))
