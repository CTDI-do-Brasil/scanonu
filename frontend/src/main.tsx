import React, { Component, ErrorInfo, ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in React component tree:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-800">Ops! Algo deu errado ao exibir a tela</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Ocorreu um erro inesperado. Nossa proteção evitou o travamento visual em tela branca.
            </p>
            {this.state.error && (
              <div className="w-full bg-red-50 border border-red-200 rounded-xl p-3 text-left overflow-auto max-h-32 text-[11px] font-mono text-red-800">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <button
              onClick={() => {
                localStorage.removeItem('scanonu_current_screen');
                window.location.reload();
              }}
              className="w-full bg-[#003865] hover:bg-[#004e8c] text-white font-bold py-3 px-4 rounded-xl text-xs transition-all shadow-md"
            >
              Reiniciar Aplicativo
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
