import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const configuredBase = process.env.VITE_BASE_PATH || '/';
const base = `/${configuredBase.replace(/^\/+|\/+$/g, '')}${configuredBase === '/' ? '' : '/'}`;

export default defineConfig({ plugins: [react()], base });
