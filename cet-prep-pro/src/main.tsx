import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App'

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error)
  document.body.innerHTML = `
    <div style="padding: 40px; text-align: center; font-family: sans-serif;">
      <h1 style="color: #dc2626;">Application Error</h1>
      <p style="color: #64748b; margin: 20px 0;">${event.message}</p>
      <pre style="background: #f1f5f9; padding: 20px; border-radius: 8px; text-align: left; overflow: auto;">${event.error?.stack || ''}</pre>
      <button onclick="location.reload()" style="padding: 12px 24px; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer; margin-top: 20px;">
        Reload Page
      </button>
    </div>
  `
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
})

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
