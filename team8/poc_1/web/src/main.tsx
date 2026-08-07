import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted. No CDN, no key.
import '@fontsource-variable/public-sans';
import '@fontsource-variable/newsreader';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

import './theme/base.css';
import './ui/ui.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
