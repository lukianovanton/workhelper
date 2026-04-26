import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import './index.css'

// HashRouter, не BrowserRouter: в packaged-сборке renderer грузится
// через file:// и pathname — это абсолютный путь к index.html
// (file:///C:/.../out/renderer/index.html), который никогда не
// заматчит ни один наш Route. HashRouter использует location.hash
// (#/projects), который от схемы и файлового пути не зависит.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000
    }
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>
)
