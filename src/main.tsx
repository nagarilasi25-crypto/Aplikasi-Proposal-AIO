import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

registerSW({
  immediate: true,
  onOfflineReady() {
    // App shell and assets are cached for offline access
  },
});

createRoot(document.getElementById('root')!).render(<App />);
