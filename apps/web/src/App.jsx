import { useState } from 'react'
import './App.css'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="app">
      <h1>GiftsAF</h1>
      <p className="tagline">A brand new React app.</p>
      <button onClick={() => setCount((c) => c + 1)}>
        count is {count}
      </button>
      <p className="hint">
        Edit <code>src/App.jsx</code> and save to test HMR.
      </p>
    </main>
  )
}
