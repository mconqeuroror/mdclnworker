import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import './index.css';

// Top-level error boundary: catch errors so Vite does not show overlay/reload (endless refresh loop locally)
class RootErrorClass extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, background: '#111', color: '#fff', minHeight: '100vh' }}>
          <h1>Something went wrong</h1>
          <pre style={{ fontSize: 12, overflow: 'auto' }}>{this.state.error?.message}</pre>
          <button type="button" onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: '8px 16px' }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// StrictMode disabled in dev to avoid double-invoking effects (can trigger 401 → logout → redirect loop)
ReactDOM.createRoot(document.getElementById('root')).render(
  <RootErrorClass>
    <HelmetProvider>
      <App />
      <Analytics />
    </HelmetProvider>
  </RootErrorClass>
);
