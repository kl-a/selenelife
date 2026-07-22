import './utils/migrate'; // must be first — runs before any store initializes
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import App from './App';
import { MobileApp } from './pages/MobileApp';
import { startTokenRefreshTimer } from './utils/tokenManager';

// OAuth popup callback: if this page loaded with ?code= and has a parent window,
// it's the Google redirect landing inside the auth popup — relay the code and close.
const oauthCode = new URLSearchParams(window.location.search).get('code');
if (oauthCode && window.opener) {
  window.opener.postMessage(
    { type: 'lifehex_oauth_code', code: oauthCode },
    window.location.origin
  );
  window.close();
} else {
  startTokenRefreshTimer();

  const base = import.meta.env.BASE_URL;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename={base}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/mobile" element={<MobileApp />} />
        </Routes>
      </BrowserRouter>
    </StrictMode>,
  );
}
