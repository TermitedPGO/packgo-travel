import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { identify as analyticsIdentify, reset as analyticsReset } from "@/_core/analytics";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,   // 5 minutes - don't refetch if data is fresh
    gcTime: 10 * 60 * 1000,     // 10 minutes - keep in cache
    refetchOnMount: false,       // don't refetch if data exists in cache
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(meQuery.data)
    );
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  // v2 Wave 1 Module 1.4 — PostHog identify/reset on auth transitions.
  // Tracks the previous user id so we only fire `identify()` once per
  // login (not on every render) and `reset()` once on logout.
  const previousUserIdRef = useRef<number | null>(null);
  useEffect(() => {
    const currentId = state.user?.id ?? null;
    const previousId = previousUserIdRef.current;
    if (currentId === previousId) return;
    if (currentId !== null && currentId !== previousId) {
      // Login (or user switch). Pass only id + role — never email / phone.
      analyticsIdentify(String(currentId), { role: state.user?.role });
    } else if (currentId === null && previousId !== null) {
      // Logout. Clear PostHog identity so the next session starts anonymous.
      analyticsReset();
    }
    previousUserIdRef.current = currentId;
  }, [state.user?.id, state.user?.role]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
