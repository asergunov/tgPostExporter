import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', () => {
  const notes = ref([{ before: '', after: '' }])
  const photoNote = ref('')
  const defaultNotes = ref('')
  const inputText = ref('')

  const response = fetch('http://localhost:8083/settings', {
    method: 'GET'
  })

  response
    .then((data) => data.json())
    .then(
      ({
        notes: storedNotes,
        photoNote: storedPhotoNote,
        defaultNotes: storedDefaultNotes
      }) => {
        notes.value = storedNotes
        photoNote.value = storedPhotoNote
        defaultNotes.value = storedDefaultNotes
      }
    )
  
  fetch('http://localhost:8083/input_text', {method: 'GET'})
    .then((data) => data.text())
    .then((text) => {
      inputText.value = text
    })

  return { inputText, notes, photoNote, defaultNotes }
})
