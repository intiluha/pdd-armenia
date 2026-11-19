import { Language } from '../enums'
import { FavoriteStore } from '../services/FavoriteStore'
import { StatisticsStore } from '../services/StatisticsStore'
import { Question } from '../types'

export const cleanupOldStorageKeys = () => {
  try {
    const hasFavorite = localStorage.getItem('favorite') !== null

    let hasOldKeys = hasFavorite
    const keysToRemove: string[] = []

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('q-') && !key.startsWith('q2026-')) {
        keysToRemove.push(key)
        hasOldKeys = true
      }
    }

    if (!hasOldKeys) return

    if (hasFavorite) localStorage.removeItem('favorite')
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  } catch (e) {
    // ignore
  }
}

// Удаляет статистику и избранное по вопросам, которых больше нет в базе
export const cleanupRemovedQuestions = (questions: Question[]) => {
  try {
    const ids = new Set(questions.map(({ id }) => String(id)))
    const prefix = `${StatisticsStore.getLocalstorageQuestionKeyWithoutQuestionId(Language.Russian)}-`

    Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix) && !ids.has(key.slice(prefix.length)))
      .forEach((key) => localStorage.removeItem(key))

    FavoriteStore.getFavorites()
      .filter((id) => !ids.has(String(id)))
      .forEach((id) => FavoriteStore.removeQuestionIdFromFavorites(id))
  } catch (e) {
    // ignore
  }
}
