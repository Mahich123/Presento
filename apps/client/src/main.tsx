import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'

import { routeTree } from './routeTree.gen'
import { createRouter, RouterProvider } from '@tanstack/react-router'

const router = createRouter({
  routeTree,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

async function enableMocking() {
  if (import.meta.env.MODE !== 'development' || import.meta.env.VITE_USE_MOCK_API !== 'true') {
    return
  }

  const { worker } = await import('./mocks/browser')

  return worker.start({
    onUnhandledRequest: 'bypass',
  })
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
       <RouterProvider router={router} />
    </StrictMode>,
  )
})
