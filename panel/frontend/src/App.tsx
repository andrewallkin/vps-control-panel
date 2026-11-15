import { ToastProvider } from './components/ui'
import { AppRoutes } from './routes/AppRoutes'

export default function App() {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  )
}
