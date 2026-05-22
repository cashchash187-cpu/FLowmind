import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  plan: string;
  planExpiresAt: string | null;
  isAdmin: boolean;
  passwordMustChange: boolean;
  googleSub: string | null;
  googleAvatar: string | null;
  emailLoginEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  authMethods?: { password: boolean; google: boolean; email: boolean };
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  updateUser: (user: Partial<AuthUser>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
    }),
    {
      name: "flowmind-auth",
    }
  )
);

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function getApiUrl(path: string) {
  return `${BASE}${path}`;
}

/** Read the fm_csrf cookie value (non-httpOnly, set by server on login) */
function getCsrfToken(): string | undefined {
  const match = document.cookie.match(/(?:^|;\s*)fm_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export async function apiFetch(path: string, init?: RequestInit) {
  const token = useAuthStore.getState().token;
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Bearer token for API clients / fallback
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // CSRF header for cookie-based mutations
    ...(isMutation ? { "x-fm-csrf": getCsrfToken() ?? "" } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(getApiUrl(path), {
    ...init,
    headers,
    credentials: "include", // always send cookies
  });
  return res;
}
