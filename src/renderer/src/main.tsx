import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app'
import { ErrorBoundary } from './components/error-boundary'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'

void document.fonts?.load('16px "OpenMoji Color"').catch(() => {})

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

window.addEventListener('error', (event) => {
  console.error('[renderer error]', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer rejection]', event.reason)
})

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
