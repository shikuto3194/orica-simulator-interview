import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { pushOwner, unsubscribeBrowserPush } from "./pushSubscription";
import { validateDisplayName } from "./input-validation";

/**
 * profiles テーブル (orika-react と共有) の最小スキーマ。
 * - display_name: 表示名
 * - avatar_id: アバター ID (apps/playground-web/src/avatars.ts の AVATARS)
 * - role: 'user' | 'admin' (orika-react が利用)
 */
export interface UserProfile {
  display_name: string;
  avatar_id: string | null;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /** 現在のセッションのアクセストークンを取得（API 認証用） */
  getAccessToken: () => Promise<string | null>;
  /** ページ終了時用。ネットワーク待ちなしで有効なトークンのみ返す。 */
  getCachedAccessToken: () => string | null;
  /** 現在のセッションを強制更新して新しいアクセストークンを取得 */
  refreshAccessToken: () => Promise<string | null>;
  /** profiles テーブルから最新値を再取得し state に反映 */
  refreshProfile: () => Promise<void>;
  /** 自分の編集可能な項目だけを保存し、更新行を全画面へ反映する。 */
  updateProfile: (
    changes: Partial<Pick<UserProfile, "display_name" | "avatar_id">>
  ) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** profiles から自分のレコードを取得。無ければ空 row を insert して再取得。 */
async function fetchOrCreateProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, avatar_id, role")
    .eq("user_id", userId)
    .single();

  if (data) {
    return {
      display_name: data.display_name ?? "",
      avatar_id: data.avatar_id ?? null,
      role: data.role ?? "user",
    };
  }

  // PGRST116 = "no rows returned" → 初回ログイン時に空 row を作る
  if (error && error.code === "PGRST116") {
    await supabase.from("profiles").insert({
      user_id: userId,
      display_name: "",
      role: "user",
    });
    return { display_name: "", avatar_id: null, role: "user" };
  }

  // それ以外のエラーは握り潰さず default を返す（UI 側は null フォールバック）
  return { display_name: "", avatar_id: null, role: "user" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const accessTokenRef = useRef<{
    token: string;
    expiresAtMs: number;
  } | null>(null);

  const loadProfile = useCallback(async (u: User | null) => {
    if (!u) {
      setProfile(null);
      return;
    }
    const p = await fetchOrCreateProfile(u.id);
    setProfile(p);
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      accessTokenRef.current = session?.access_token
        ? {
            token: session.access_token,
            expiresAtMs: (session.expires_at ?? 0) * 1000,
          }
        : null;
      const u = session?.user ?? null;
      setUser(u);
      await loadProfile(u);
      if (!cancelled) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      accessTokenRef.current = session?.access_token
        ? {
            token: session.access_token,
            expiresAtMs: (session.expires_at ?? 0) * 1000,
          }
        : null;
      const u = session?.user ?? null;
      setUser(u);
      void loadProfile(u);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await unsubscribeBrowserPush();
    await supabase.auth.signOut();
    accessTokenRef.current = null;
    setProfile(null);
  };

  useEffect(() => {
    if (!loading && pushOwner() && pushOwner() !== user?.id) {
      void unsubscribeBrowserPush().catch(() => {});
    }
  }, [loading, user?.id]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const cached = accessTokenRef.current;
      if (cached && cached.expiresAtMs - Date.now() > 5_000) {
        return cached.token;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      accessTokenRef.current = session?.access_token
        ? {
            token: session.access_token,
            expiresAtMs: (session.expires_at ?? 0) * 1000,
          }
        : null;
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  const getCachedAccessToken = useCallback(() => {
    const cached = accessTokenRef.current;
    return cached && cached.expiresAtMs > Date.now() ? cached.token : null;
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.refreshSession();
      if (error) return null;
      accessTokenRef.current = session?.access_token
        ? {
            token: session.access_token,
            expiresAtMs: (session.expires_at ?? 0) * 1000,
          }
        : null;
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(user);
  }, [loadProfile, user]);

  const updateProfile = async (
    changes: Partial<Pick<UserProfile, "display_name" | "avatar_id">>
  ) => {
    if (!user) throw new Error("ログインが必要です。");
    const editable: Partial<Pick<UserProfile, "display_name" | "avatar_id">> =
      {};
    if (changes.display_name !== undefined)
      editable.display_name = validateDisplayName(changes.display_name);
    if (changes.avatar_id !== undefined) editable.avatar_id = changes.avatar_id;
    const { data, error } = await supabase
      .from("profiles")
      .update(editable)
      .eq("user_id", user.id)
      .select("display_name, avatar_id, role")
      .single();
    if (error) throw new Error(error.message);
    // single() also rejects a zero-row update (for example, an RLS denial).
    setProfile(data);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signIn,
        signOut,
        getAccessToken,
        getCachedAccessToken,
        refreshAccessToken,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
