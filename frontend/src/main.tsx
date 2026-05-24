import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import MeetingBar from './components/MeetingBar'
import './styles/globals.css'

// The always-on-top meeting bar loads this same bundle with ?view=bar and
// renders only the bar (no router, no auth gating).
const isBarView = new URLSearchParams(window.location.search).get('view') === 'bar'

ReactDOM.createRoot(document.getElementById('root')!).render(
  isBarView ? (
    <MeetingBar />
  ) : (
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
)
