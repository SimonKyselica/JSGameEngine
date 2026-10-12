import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './docs.css';
import { DocsApp } from './DocsApp';

const root = document.getElementById('root');
if (!root) {
  throw new Error('The page is missing its #root element');
}
createRoot(root).render(
  <StrictMode>
    <DocsApp />
  </StrictMode>,
);
