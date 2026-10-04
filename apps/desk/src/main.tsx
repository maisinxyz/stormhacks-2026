import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './fonts.css'
import './styles.css'
import './voice.css'
import './f2.css'
import './design.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
