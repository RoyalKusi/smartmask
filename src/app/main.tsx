import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyPalette } from '../shared/ui/tokens';
import { App } from './App';
import { useUi } from './store';
import './styles.css';

// Apply tokens before first paint so there is no flash of unthemed content.
applyPalette(useUi.getState().theme);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
