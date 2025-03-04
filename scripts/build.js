const fs = require('fs-extra')
const _ = require('lodash')
const meta = require('../package.json')
const { default: axios } = require('axios')

const cache = new Map()

const fetchWithCache = async (url) => {
  if (cache.has(url)) {
    return cache.get(url)
  }

  try {
    const resp = await axios.get(url)
    cache.set(url, resp.data)
    return resp.data
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error.message)
    return null
  }
}

const generateQuran = async (lang = null, pretty = false) => {
  const filename = lang ? `quran_${lang}.json` : 'quran.json'

  console.log(`+ Generating ${filename}...`)

  // Load Quran data & translations from local files
  const [chapters, quran, trans] = await Promise.all([
    fs.readJson(
      `data/chapters/${
        lang === null || lang === 'transliteration' ? 'en' : lang
      }.json`
    ),
    fs.readJson('data/quran.json'),
    lang ? fs.readJson(`data/editions/${lang}.json`) : null,
  ])

  let data = []

  for (let chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
    const item = chapters[chapterIdx]

    console.log(`Fetching Tajweed for Chapter ${chapterIdx + 1}...`)

    let tajweeds = []
    try {
      const resp = await axios.get(
        `https://api.alquran.cloud/v1/surah/${
          chapterIdx + 1
        }/editions/quran-tajweed`
      )

      tajweeds = resp.data?.data[0]?.ayahs || []

      // Delay 500ms to avoid API rate limits
      await delay(500)
    } catch (error) {
      console.error(`Error fetching chapter ${chapterIdx + 1}:`, error.message)

      // If rate limit is exceeded, wait longer before retrying
      if (error.response?.data?.message.includes('API rate limit exceeded')) {
        console.log('Rate limit hit. Waiting 5 seconds before retrying...')
        await delay(5000)
        chapterIdx-- // Retry the same chapter
        continue
      }
    }

    // Build Chapter Data
    const chapter = {
      id: item.id,
      name: item.name,
      transliteration: item.transliteration,
      translation: item.translation,
      type: item.type,
      total_verses: item.total_verses,
      verses: quran[item.id].map((i, idx) => {
        const verse = {
          id: i.verse,
          text: i.text,
          tajweed: tajweeds[idx]?.text || null, // Assign Tajweed text if available
        }

        if (trans) {
          verse[
            lang === 'transliteration' ? 'transliteration' : 'translation'
          ] = trans[item.id][idx].text
        }

        return verse
      }),
    }

    if (lang === null) {
      delete chapter.translation
    }

    data.push(chapter)
  }

  // Save the generated JSON file
  await fs.outputJson(`dist/${filename}`, data, { spaces: pretty ? 2 : 0 })

  console.log(`✅ ${filename} generated successfully!`)
  return data
}

const generateByChapter = async (chapters, lang = null, pretty = false) => {
  await Promise.all(
    chapters.map((chapter) => {
      const filename = lang
        ? `${lang}/${chapter.id}.json`
        : `${chapter.id}.json`

      console.log(`+ Generating chapter: ${filename}...`)

      return fs.outputJson(`dist/chapters/${filename}`, chapter, {
        spaces: pretty ? 2 : 0,
      })
    })
  )

  const indexFilename = lang ? `${lang}/index.json` : 'index.json'

  const index = chapters.map(({ verses, ...chapter }) => {
    const filename = lang ? `${lang}/${chapter.id}.json` : `${chapter.id}.json`

    return {
      ...chapter,
      link: `https://cdn.jsdelivr.net/npm/quran-json@${meta.version}/dist/chapters/${filename}`,
    }
  })

  await fs.outputJson(`dist/chapters/${indexFilename}`, index, {
    spaces: pretty ? 2 : 0,
  })
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const generateByVerses = async (quran, transQurans, pretty = false) => {
  let id = 1

  const verses = _.flatten(
    quran.chapters.map((chapter, chapterIdx) => {
      return chapter.verses.map((verse, verseIdx) => {
        return {
          id: id++,
          number: verse.id,
          text: verse.text,
          translations: _.zipObject(
            transQurans.map((transQuran) => transQuran.lang),
            transQurans.map(
              (transQuran) =>
                transQuran.chapters[chapterIdx].verses[verseIdx].translation
            )
          ),
          transliteration: verse.transliteration,
          chapter: {
            id: chapter.id,
            name: chapter.name,
            transliteration: chapter.transliteration,
            translations: _.zipObject(
              transQurans.map((transQuran) => transQuran.lang),
              transQurans.map(
                (transQuran) => transQuran.chapters[chapterIdx].translation
              )
            ),
            type: chapter.type,
          },
        }
      })
    })
  )

  const chunkVerses = _.chunk(verses, 100)

  for (let i = 0; i < chunkVerses.length; i++) {
    await Promise.all(
      chunkVerses[i].map((verse) => {
        const filename = `${verse.id}.json`

        console.log(`+ Generating verse: ${filename}...`)

        return fs.outputJson(`dist/verses/${filename}`, verse, {
          spaces: pretty ? 2 : 0,
        })
      })
    )
  }
}

;(async () => {
  const args = process.argv.slice(2)

  const pretty = args.length > 0 && args[0] === '--pretty'

  await fs.emptyDir('dist')

  const langCodes = [null, 'en', 'ha_gumi', 'yoruba_mikail']

  const [transliterationChapters, ...chaptersList] = await Promise.all(
    ['transliteration', ...langCodes].map((lang) => generateQuran(lang, pretty))
  )

  const qurans = chaptersList.map((chapters, idx) => {
    return {
      lang: langCodes[idx],
      chapters: chapters.map((chapter, chapterIdx) => {
        return {
          ...chapter,
          verses: chapter.verses.map((verse, verseIdx) => {
            return {
              ...verse,
              transliteration:
                transliterationChapters[chapterIdx].verses[verseIdx]
                  .transliteration,
            }
          }),
        }
      }),
    }
  })

  await Promise.all(
    qurans.map((quran) => generateByChapter(quran.chapters, quran.lang, pretty))
  )

  await generateByVerses(qurans[0], qurans.slice(2), pretty)

  console.log('✓ Done')
})()
