import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyTheme, getLocal } from './local'

applyTheme(getLocal('theme', 'light'))

createRoot(document.getElementById('root')).render(<App />)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
