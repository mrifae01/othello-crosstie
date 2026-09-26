import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { GameClientProvider } from './data/ClientContext';
import { createMockClient } from './data/mockClient';
import { MockDevBar } from './mocks/MockDevBar';
import { ToastProvider } from './components/Toasts';
import './styles.css';

// Composition root: the only place that chooses a GameClient implementation.
// The real HTTP/socket client lands in a later step; until then everything runs on mocks.
const client = createMockClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameClientProvider client={client}>
      <ToastProvider>
        <BrowserRouter>
          <App />
          <MockDevBar client={client} />
        </BrowserRouter>
      </ToastProvider>
    </GameClientProvider>
  </StrictMode>,
);
