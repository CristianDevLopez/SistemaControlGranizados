import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './lib/store.tsx';
import { App } from './App.tsx';
import './styles.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error) {
    console.error('App error', error.message);
  }
  render() {
    return this.state.error ? (
      <main className="fatal-error">
        <h1>No se pudo mostrar esta pantalla</h1>
        <p>Los registros guardados se conservan en este equipo.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Volver a abrir
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AppProvider>
      <App />
    </AppProvider>
  </ErrorBoundary>,
);
