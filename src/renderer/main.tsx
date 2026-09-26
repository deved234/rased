import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-sans-arabic/400.css'
import '@fontsource/noto-sans-arabic/500.css'
import '@fontsource/noto-sans-arabic/700.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import { App } from './App.js'

const root = document.getElementById('root')
if (!root) throw new Error('no root element')
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
