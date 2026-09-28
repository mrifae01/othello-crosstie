import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { GameClientProvider } from './data/ClientContext';
import type { GameClient } from './data/GameClient';
import { createHttpClient } from './data/httpClient';
import { ToastProvider } from './components/Toasts';
import { LeaveGuardProvider } from './components/LeaveGuard';
import { AuthProvider } from './auth/AuthContext';
import { supabase } from './auth/supabase';
import './styles.css';

// Composition root: the only place that builds the GameClient. Requests carry the Supabase
// session's access token when signed in (supabase is null when accounts aren't configured).
const client: GameClient = createHttpClient(async () => (await supabase?.auth.getSession())?.data.session?.access_token);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameClientProvider client={client}>
      <AuthProvider supabase={supabase}>
        <ToastProvider>
          <LeaveGuardProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </LeaveGuardProvider>
        </ToastProvider>
      </AuthProvider>
    </GameClientProvider>
  </StrictMode>,
);
