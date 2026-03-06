import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8122',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8122',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          if (normalizedId.includes('/node_modules/')) {
            if (
              normalizedId.includes('/react/') ||
              normalizedId.includes('/react-dom/') ||
              normalizedId.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (normalizedId.includes('/react-router/') || normalizedId.includes('/react-router-dom/')) {
              return 'vendor-router';
            }
            if (normalizedId.includes('/@tanstack/react-query/')) {
              return 'vendor-query';
            }
            if (normalizedId.includes('/lucide-react/')) {
              return 'vendor-icons';
            }
            if (normalizedId.includes('/zustand/')) {
              return 'vendor-state';
            }
            return 'vendor-misc';
          }

          if (normalizedId.includes('/src/modules/management/dashboard/') || normalizedId.includes('/src/modules/management/orders/') || normalizedId.includes('/src/modules/management/kitchen-monitor/')) {
            return 'app-mgr-core';
          }
          if (normalizedId.includes('/src/modules/management/products/') || normalizedId.includes('/src/modules/management/warehouse/') || normalizedId.includes('/src/modules/management/suppliers/')) {
            return 'app-mgr-catalog';
          }
          if (normalizedId.includes('/src/modules/management/tables/') || normalizedId.includes('/src/modules/management/delivery/') || normalizedId.includes('/src/modules/management/financial/') || normalizedId.includes('/src/modules/management/expenses/')) {
            return 'app-mgr-ops';
          }
          if (normalizedId.includes('/src/modules/management/reports/') || normalizedId.includes('/src/modules/management/users/') || normalizedId.includes('/src/modules/management/settings/') || normalizedId.includes('/src/modules/management/audit/')) {
            return 'app-mgr-admin';
          }
          if (normalizedId.includes('/src/modules/orders/public/')) {
            return 'app-public-order';
          }
          if (normalizedId.includes('/src/modules/auth/')) {
            return 'app-auth';
          }
          if (normalizedId.includes('/src/modules/kitchen/')) {
            return 'app-kitchen';
          }
          if (normalizedId.includes('/src/modules/delivery/')) {
            return 'app-delivery';
          }
          if (normalizedId.includes('/src/shared/api/')) {
            return 'app-api';
          }
          if (normalizedId.includes('/src/shared/ui/') || normalizedId.includes('/src/shared/hooks/') || normalizedId.includes('/src/shared/utils/')) {
            return 'app-shared';
          }
          if (normalizedId.includes('/src/app/layout/')) {
            return 'app-layouts';
          }
        },
      },
    },
  },
});
