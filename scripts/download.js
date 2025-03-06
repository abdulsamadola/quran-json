const fs = require('fs-extra')
const axios = require('axios')
const _ = require('lodash')

const downloadChapterList = async (langCode) => {
  const file = `data/chapters/${langCode}.json`
  const exists = await fs.pathExists(file)

  if (exists) {
    return
  }

  console.log(`+ Downloading chapter list in [${langCode}]...`)

  const res = await axios.get('https://api.quran.com/api/v4/chapters', {
    params: {
      language: langCode,
    },
  })

  const chapters = res.data.chapters.map((chapter) => {
    return {
      id: chapter.id,
      name: chapter.name_arabic,
      transliteration: chapter.name_simple,
      translation: chapter.translated_name.name,
      type: chapter.revelation_place === 'makkah' ? 'meccan' : 'medinan',
      total_verses: chapter.verses_count,
    }
  })

  await fs.outputJson(file, chapters, { spaces: 2 })
}

const downloadEdition = async (edition, file) => {
  const exists = await fs.pathExists(file)

  if (exists) {
    return
  }

  console.log(`+ Downloading Quran edition [${edition}]...`)

  const res = await axios.get(
    `https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/${edition}.json`
  )

  const verses = _.groupBy(res.data.quran, 'chapter')

  await fs.outputJson(file, verses, { spaces: 2 })
}

;(async () => {
  const args = process.argv.slice(2)

  if (args.length > 0 && args[0] === '--clean') {
    await fs.emptyDir('data')
  }

  const langCodes = ['en', 'ha', 'yo']

  await Promise.all(langCodes.map((langCode) => downloadChapterList(langCode)))

  await Promise.all([
    // Quran Uthmani, Source: https://quranenc.com
    downloadEdition('ara-quranuthmanienc', 'data/quran.json'),
    // English Transliteration, Source: https://tanzil.net/trans/en.transliteration
    downloadEdition('ara-quran-la', 'data/editions/transliteration.json'),

    // English, Author: Umm Muhammad (Saheeh International), Source: https://tanzil.net/trans/en.sahih
    downloadEdition('eng-ummmuhammad', 'data/editions/en.json'),
    downloadEdition('hau-abubakarmahmoud', 'data/editions/ha_gumi.json'),
    downloadEdition('yor-shaykhaburahima', 'data/editions/yoruba_mikail.json'),
  ])

  console.log('✓ Done')
})()
