import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { Providers } from './app/providers.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers />
  </React.StrictMode>,
);
