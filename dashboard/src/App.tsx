import { useEffect } from 'react'
import { WifiOff } from 'lucide-react'
import { ContextBar } from './components/ContextBar'
import { DemoHotkey } from './components/DemoHotkey'
import { Header } from './components/Header'
import { useOps } from './lib/ops'
import { AnalysisView } from './views/AnalysisView'
import { CrewsView } from './views/CrewsView'
import { OperationsView } from './views/OperationsView'
import { SensorsView } from './views/SensorsView'

export function App() {
  const { view, online, loading } = useOps()

  // Lets page-level UI (toasts) keep clear of the operations rail.
  useEffect(() => {
    document.documentElement.dataset.view = view
  }, [view])

  return (
    <div className={`app app--${view}`}>
      <DemoHotkey />
      <Header />
      <ContextBar />
      {!online && !loading && (
        <div className="banner" role="alert">
          <WifiOff size={16} aria-hidden />
          <span>
            <strong>Can't reach the cloud API.</strong> Start it from the repository root with{' '}
            <code>uvicorn cloud.api.main:app --port 8000</code>. The dashboard reconnects on its own.
          </span>
        </div>
      )}
      <main className="app__main">
        {view === 'operations' && <OperationsView />}
        {view === 'crews' && <CrewsView />}
        {view === 'sensors' && <SensorsView />}
        {view === 'analysis' && <AnalysisView />}
      </main>
    </div>
  )
}
