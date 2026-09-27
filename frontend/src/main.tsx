import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { GameClientProvider } from './data/ClientContext';
import type { GameClient } from './data/GameClient';
import { createHttpClient } from './data/httpClient';
import { createMockClient, type MockClient } from './data/mockClient';
import { MockDevBar } from './mocks/MockDevBar';
import { ToastProvider } from './components/Toasts';
import { LeaveGuardProvider } from './components/LeaveGuard';
import { AuthProvider } from './auth/AuthContext';
import { supabase } from './auth/supabase';
import './styles.css';

// Composition root: the only place that chooses a GameClient implementation.
// The real backend is the default. `?mock=1` switches this tab to in-memory mocks and
// sticks for the tab (so in-app navigation and refreshes stay mocked); `?mock=0` leaves.
const MOCK_KEY = 'othello:mock';
function mockMode(): boolean {
  const flag = new URLSearchParams(window.location.search).get('mock');
  try {
    if (flag === '1') sessionStorage.setItem(MOCK_KEY, '1');
    else if (flag === '0') sessionStorage.removeItem(MOCK_KEY);
    return sessionStorage.getItem(MOCK_KEY) === '1';
  } catch {
    return flag === '1';
  }
}

const mock: MockClient | null = mockMode() ? createMockClient() : null;
// Accounts are real-backend only; mock mode stays guest-only.
const auth = mock ? null : supabase;
const client: GameClient =
  mock ?? createHttpClient(async () => (await auth?.auth.getSession())?.data.session?.access_token);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameClientProvider client={client}>
      <AuthProvider supabase={auth}>
        <ToastProvider>
          <LeaveGuardProvider>
            <BrowserRouter>
              <App />
              {mock && <MockDevBar client={mock} />}
            </BrowserRouter>
          </LeaveGuardProvider>
        </ToastProvider>
      </AuthProvider>
    </GameClientProvider>
  </StrictMode>,
);
