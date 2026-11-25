import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './components/partner/CadastrosMobile.css';
import './components/partner/PdvMobileReview.css';
import './components/partner/OpenOrdersMobile.css';
import './components/partner/RoutinesMobile.css';
import './components/partner/ManagementMobile.css';
import './components/partner/BlueGlassTheme.css';
import './components/partner/WhiteMobileTheme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
