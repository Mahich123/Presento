import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

const RootLayout = () => {
  const isOnline = useOnlineStatus()
  return (
    <div>
      {!isOnline && (
        <div style={{ background: 'red', color: 'white', padding: '1rem' }}>
          You are currently offline. Some features may not be available.
        </div>
      )}
      <Outlet />
    </div>
  )
}

export const Route = createRootRoute({ component: RootLayout })