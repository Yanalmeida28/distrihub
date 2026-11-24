import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './components/partner/CadastrosMobile.css';
import './components/partner/PdvMobileReview.css';
import './components/partner/OpenOrdersMobile.css';
import './components/partner/RoutinesMobile.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
