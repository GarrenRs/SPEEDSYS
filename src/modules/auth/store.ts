import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { User, UserRole } from '@/shared/api/types';

interface AuthState {
  user: User | null;
  role: UserRole | null;
  setSession: (payload: { user: User }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      role: null,
      setSession: ({ user }) => set({ user, role: user.role }),
      logout: () => set({ user: null, role: null }),
    }),
    { name: 'restaurant-auth' }
  )
);
